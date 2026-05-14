import Database from "better-sqlite3";
import type { SessionStatus, StreamMessage } from "../types.js";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// ============================================
// 类型定义
// ============================================

/**
 * 待处理的权限请求（运行时状态）
 * resolve 回调仅在内存中存在
 */
export type PendingPermission = {
  toolUseId: string;
  toolName: string;
  input: unknown;
  resolve: (result: { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }) => void;
};

/**
 * 持久化的权限请求数据（不含 resolve 回调）
 */
export type StoredPendingPermission = {
  toolUseId: string;
  sessionId: string;
  toolName: string;
  input: string; // JSON 序列化
  createdAt: number;
};

/**
 * 运行时会话状态
 */
export type Session = {
  id: string;
  title: string;
  claudeSessionId?: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  pendingPermissions: Map<string, PendingPermission>;
  abortController?: AbortController;
  /** SessionStore 引用（用于权限持久化） */
  store: SessionStore;
};

/**
 * 持久化的会话数据
 */
export type StoredSession = {
  id: string;
  title: string;
  status: SessionStatus;
  cwd?: string;
  allowedTools?: string;
  lastPrompt?: string;
  claudeSessionId?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * 会话历史记录
 */
export type SessionHistory = {
  session: StoredSession;
  messages: StreamMessage[];
};

// ============================================
// SessionStore 类
// ============================================

/**
 * 会话存储管理器
 *
 * 设计原则：
 * - SQLite 为唯一数据源
 * - 内存 Map 仅作运行时缓存
 * - 所有写操作使用事务保护
 * - 支持崩溃恢复
 */
export class SessionStore {
  private sessions = new Map<string, Session>();
  private db: Database.Database;
  private transaction: Database.Transaction;

  constructor(dbPath: string) {
    // 确保数据库目录存在
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      try {
        mkdirSync(dbDir, { recursive: true });
        console.warn("[session-store] Created DB directory:", dbDir);
      } catch (err) {
        console.error("[session-store] Failed to create DB directory:", err);
        throw new Error(`Failed to create DB directory: ${String(err)}`);
      }
    }

    console.warn("[session-store] Opening database:", dbPath);
    try {
      this.db = new Database(dbPath);
    } catch (err) {
      console.error("[session-store] Failed to open database:", err);
      throw new Error(`Failed to open database: ${String(err)}`);
    }

    // 预编译事务函数
    this.transaction = this.db.transaction(() => {});
    this.initialize();
    this.loadSessions();
    this.recoverPendingPermissions();
  }

  createSession(options: { cwd?: string; allowedTools?: string; prompt?: string; title: string }): Session {
    const id = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      title: options.title,
      status: "idle",
      cwd: options.cwd,
      allowedTools: options.allowedTools,
      lastPrompt: options.prompt,
      pendingPermissions: new Map(),
      store: this // 添加 store 引用用于权限持久化
    };

    // 使用事务保护创建操作
    const createTransaction = this.db.transaction(() => {
      this.sessions.set(id, session);
      this.db
        .prepare(
          `insert into sessions
            (id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          session.title,
          session.claudeSessionId ?? null,
          session.status,
          session.cwd ?? null,
          session.allowedTools ?? null,
          session.lastPrompt ?? null,
          now,
          now
        );
    });

    createTransaction();
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(): StoredSession[] {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, created_at, updated_at
         from sessions
         order by updated_at desc`
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: row.status as SessionStatus,
      cwd: row.cwd ? String(row.cwd) : undefined,
      allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
      lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
      claudeSessionId: row.claude_session_id ? String(row.claude_session_id) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    }));
  }

  listRecentCwds(limit = 8): string[] {
    const rows = this.db
      .prepare(
        `select cwd, max(updated_at) as latest
         from sessions
         where cwd is not null and trim(cwd) != ''
         group by cwd
         order by latest desc
         limit ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.cwd));
  }

  getSessionHistory(id: string): SessionHistory | null {
    const sessionRow = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt, created_at, updated_at
         from sessions
         where id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!sessionRow) return null;

    const messages = (this.db
      .prepare(
        `select data from messages where session_id = ? order by created_at asc`
      )
      .all(id) as Array<Record<string, unknown>>)
      .map((row) => JSON.parse(String(row.data)) as StreamMessage);

    return {
      session: {
        id: String(sessionRow.id),
        title: String(sessionRow.title),
        status: sessionRow.status as SessionStatus,
        cwd: sessionRow.cwd ? String(sessionRow.cwd) : undefined,
        allowedTools: sessionRow.allowed_tools ? String(sessionRow.allowed_tools) : undefined,
        lastPrompt: sessionRow.last_prompt ? String(sessionRow.last_prompt) : undefined,
        claudeSessionId: sessionRow.claude_session_id ? String(sessionRow.claude_session_id) : undefined,
        createdAt: Number(sessionRow.created_at),
        updatedAt: Number(sessionRow.updated_at)
      },
      messages
    };
  }

  updateSession(id: string, updates: Partial<Session>): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    // 使用事务保护更新操作
    const updateTransaction = this.db.transaction(() => {
      Object.assign(session, updates);
      this.persistSession(id, updates);
    });

    updateTransaction();
    return session;
  }

  setAbortController(id: string, controller: AbortController | undefined): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.abortController = controller;
  }

  // ============================================
  // 权限请求持久化方法
  // ============================================

  /**
   * 持久化权限请求到数据库
   *
   * 用于崩溃恢复：如果应用在权限交互期间崩溃，
   * 重启后可以从数据库恢复这些请求
   */
  persistPendingPermission(sessionId: string, permission: Omit<PendingPermission, "resolve">): void {
    this.db
      .prepare(
        `insert or replace into pending_permissions
          (tool_use_id, session_id, tool_name, input, created_at)
         values (?, ?, ?, ?, ?)`
      )
      .run(permission.toolUseId, sessionId, permission.toolName, JSON.stringify(permission.input), Date.now());
  }

  /**
   * 从数据库删除权限请求
   */
  removePendingPermission(toolUseId: string): void {
    this.db.prepare(`delete from pending_permissions where tool_use_id = ?`).run(toolUseId);
  }

  /**
   * 获取会话的待处理权限请求
   */
  getStoredPendingPermissions(sessionId: string): StoredPendingPermission[] {
    const rows = this.db
      .prepare(
        `select tool_use_id, session_id, tool_name, input, created_at
         from pending_permissions
         where session_id = ?`
      )
      .all(sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      toolUseId: String(row.tool_use_id),
      sessionId: String(row.session_id),
      toolName: String(row.tool_name),
      input: String(row.input),
      createdAt: Number(row.created_at),
    }));
  }

  recordMessage(sessionId: string, message: StreamMessage): void {
    const id = ('uuid' in message && message.uuid) ? String(message.uuid) : crypto.randomUUID();
    this.db
      .prepare(
        `insert or ignore into messages (id, session_id, data, created_at) values (?, ?, ?, ?)`
      )
      .run(id, sessionId, JSON.stringify(message), Date.now());
  }

  deleteSession(id: string): boolean {
    const existing = this.sessions.get(id);

    // 使用事务保护删除操作（级联删除 pending_permissions）
    const deleteTransaction = this.db.transaction(() => {
      if (existing) {
        this.sessions.delete(id);
      }
      // 删除顺序：先删除依赖表，再删除主表
      this.db.prepare(`delete from pending_permissions where session_id = ?`).run(id);
      this.db.prepare(`delete from messages where session_id = ?`).run(id);
      this.db.prepare(`delete from sessions where id = ?`).run(id);
    });

    deleteTransaction();
    return Boolean(existing);
  }

  private persistSession(id: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const updatable = {
      claudeSessionId: "claude_session_id",
      status: "status",
      cwd: "cwd",
      allowedTools: "allowed_tools",
      lastPrompt: "last_prompt"
    } as const;

    for (const key of Object.keys(updates) as Array<keyof typeof updatable>) {
      const column = updatable[key];
      if (!column) continue;
      fields.push(`${column} = ?`);
      const value = updates[key];
      values.push(value === undefined ? null : (value as string));
    }

    if (fields.length === 0) return;
    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    this.db
      .prepare(`update sessions set ${fields.join(", ")} where id = ?`)
      .run(...values);
  }

  private initialize(): void {
    // 启用 WAL 模式提升并发性能
    this.db.exec(`pragma journal_mode = WAL;`);

    // 会话表
    this.db.exec(
      `create table if not exists sessions (
        id text primary key,
        title text,
        claude_session_id text,
        status text not null,
        cwd text,
        allowed_tools text,
        last_prompt text,
        created_at integer not null,
        updated_at integer not null
      )`
    );

    // 消息表
    this.db.exec(
      `create table if not exists messages (
        id text primary key,
        session_id text not null,
        data text not null,
        created_at integer not null,
        foreign key (session_id) references sessions(id)
      )`
    );

    // 权限请求表（用于崩溃恢复）
    this.db.exec(
      `create table if not exists pending_permissions (
        tool_use_id text primary key,
        session_id text not null,
        tool_name text not null,
        input text not null,
        created_at integer not null,
        foreign key (session_id) references sessions(id) on delete cascade
      )`
    );

    // 创建索引
    this.db.exec(`create index if not exists messages_session_id on messages(session_id)`);
    this.db.exec(`create index if not exists pending_permissions_session_id on pending_permissions(session_id)`);
  }

  private loadSessions(): void {
    const rows = this.db
      .prepare(
        `select id, title, claude_session_id, status, cwd, allowed_tools, last_prompt
         from sessions`
      )
      .all();
    for (const row of rows as Array<Record<string, unknown>>) {
      const session: Session = {
        id: String(row.id),
        title: String(row.title),
        claudeSessionId: row.claude_session_id ? String(row.claude_session_id) : undefined,
        status: row.status as SessionStatus,
        cwd: row.cwd ? String(row.cwd) : undefined,
        allowedTools: row.allowed_tools ? String(row.allowed_tools) : undefined,
        lastPrompt: row.last_prompt ? String(row.last_prompt) : undefined,
        pendingPermissions: new Map(),
        store: this // 添加 store 引用
      };
      this.sessions.set(session.id, session);
    }
  }

  /**
   * 从数据库恢复未处理的权限请求
   *
   * 崩溃恢复场景：应用重启后，尝试恢复中断的权限交互
   * 注意：resolve 回调无法恢复，需要重新触发权限请求
   */
  private recoverPendingPermissions(): void {
    const rows = this.db
      .prepare(
        `select tool_use_id, session_id, tool_name, input, created_at
         from pending_permissions`
      )
      .all() as Array<Record<string, unknown>>;

    for (const row of rows) {
      const sessionId = String(row.session_id);
      const session = this.sessions.get(sessionId);
      if (!session) {
        // 会话不存在，清理孤立数据
        this.db.prepare(`delete from pending_permissions where session_id = ?`).run(sessionId);
        continue;
      }

      // 记录日志，等待用户重新触发
      console.warn(
        `[SessionStore] Recovered pending permission: ${String(row.tool_use_id)} for tool ${String(row.tool_name)} in session ${sessionId}. ` +
          `This permission request needs to be re-triggered.`
      );
    }

    // 清理所有恢复的权限请求（因为没有 resolve 回调，无法完成）
    if (rows.length > 0) {
      this.db.exec(`delete from pending_permissions`);
      console.warn(`[SessionStore] Cleared ${rows.length} orphaned pending permissions`);
    }
  }

  close(): void {
    this.db.close();
  }
}
