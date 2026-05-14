# Claude-Cowork 架构说明

本文档详细介绍 Claude-Cowork 的系统架构、核心模块设计和数据流。

## 目录

- [系统概览](#系统概览)
- [技术栈](#技术栈)
- [进程架构](#进程架构)
- [核心模块](#核心模块)
- [数据流](#数据流)
- [状态管理](#状态管理)
- [持久化层](#持久化层)
- [IPC 协议](#ipc-协议)
- [安全设计](#安全设计)

## 系统概览

Claude-Cowork 是一个 Electron 桌面应用，为 Claude Code 提供 GUI 界面：

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude-Cowork                          │
├─────────────────────────────────────────────────────────────┤
│  Renderer Process (React)                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Sidebar   │  │ MessageList │  │   PromptInput       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                          │                                   │
│                    Zustand Store                            │
│                          │                                   │
│                    IPC Bridge                              │
├─────────────────────────────────────────────────────────────┤
│  Main Process (Electron)                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │IPC Handlers │  │   Runner    │  │  SessionStore      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                          │                                   │
│               Claude Agent SDK                             │
│                          │                                   │
│                    SQLite (WAL)                            │
└─────────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Electron | 39 | 桌面应用框架 |
| UI | React | 19 | 组件化 UI |
| 样式 | Tailwind CSS | 4 | 原子化 CSS |
| 状态 | Zustand | 5 | 轻量状态管理 |
| 数据库 | better-sqlite3 | 12 | 同步 SQLite |
| SDK | @anthropic-ai/claude-agent-sdk | 0.2.6 | Claude Agent |
| 测试 | Vitest | 4 | 单元测试 |
| 构建 | Vite | 7 | 开发服务器 + 构建 |

## 进程架构

Electron 采用多进程架构：

### 主进程 (Main Process)

- **入口**: `src/electron/main.ts`
- **职责**:
  - 创建 BrowserWindow
  - 处理 IPC 消息
  - 调用 Claude Agent SDK
  - 管理会话生命周期
  - SQLite 数据库操作

### 渲染进程 (Renderer Process)

- **入口**: `src/ui/main.tsx`
- **职责**:
  - React 组件渲染
  - 用户交互处理
  - 状态管理
  - IPC 消息发送/接收

### IPC 通信

通过 `contextBridge` 暴露安全的 IPC 接口：

```typescript
// preload.ts
contextBridge.exposeInMainWorld("electron", {
  sendEvent: (event: ClientEvent) => ipcRenderer.send("client-event", event),
  onServerEvent: (callback: (event: ServerEvent) => void) => {
    ipcRenderer.on("server-event", (_, payload) => callback(JSON.parse(payload)));
  },
  checkApiConfig: () => ipcRenderer.invoke("check-api-config"),
});
```

## 核心模块

### 1. SessionStore（会话存储）

**位置**: `src/electron/libs/session-store.ts`

**职责**:
- 会话 CRUD 操作
- 消息持久化
- 权限请求管理
- SQLite 数据库封装

**数据模型**:

```typescript
type Session = {
  id: string;
  claudeSessionId?: string;
  cwd: string;
  title: string;
  status: "idle" | "running" | "completed" | "error";
  allowedTools?: string[];
  lastPrompt?: string;
  messages: StreamMessage[];
  pendingPermissions: Map<string, PendingPermission>;
  createdAt: number;
  updatedAt?: number;
};
```

**事务保护**:

所有写操作使用 SQLite 事务：

```typescript
const createTransaction = this.db.transaction(() => {
  const insert = this.db.prepare(`
    INSERT INTO sessions (id, cwd, title, status, allowed_tools, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insert.run(session.id, session.cwd, session.title, ...);
});
createTransaction();
```

### 2. Runner（Claude SDK 封装）

**位置**: `src/electron/libs/runner.ts`

**职责**:
- 调用 Claude Agent SDK
- 处理流式事件
- 工具权限请求
- 进程生命周期管理

**事件处理**:

```typescript
runClaude({
  prompt,
  session,
  resumeSessionId,
  onEvent: (event) => {
    // 广播到渲染进程
    broadcast(event);
  },
  onSessionUpdate: (updates) => {
    // 更新数据库
    sessions.updateSession(session.id, updates);
  },
});
```

### 3. PermissionManager（权限管理）

**位置**: `src/electron/libs/permission-manager.ts`

**职责**:
- 工具权限策略配置
- 权限决策（允许/询问用户/拒绝）
- 危险工具检测

**配置结构**:

```typescript
type PermissionConfig = {
  defaultMode: "smart" | "ask-user" | "auto-approve";
  toolOverrides: Record<string, PermissionBehavior>;
  forceConfirmDangerous: boolean;
  enableLogging: boolean;
};
```

### 4. Zustand Store（前端状态）

**位置**: `src/ui/store/useAppStore.ts`

**状态结构**:

```typescript
type AppState = {
  sessions: Record<string, SessionState>;
  activeSessionId: string | null;
  prompt: string;
  cwd: string;
  showStartModal: boolean;
  showSettingsModal: boolean;
  globalError: string | null;
  // Actions
  handleServerEvent: (event: ServerEvent) => void;
  setActiveSessionId: (id: string | null) => void;
  setPrompt: (prompt: string) => void;
  // ...
};
```

## 数据流

### 1. 创建会话流程

```
用户输入 Prompt
      │
      ▼
PromptInput 组件
      │ IPC: session.start
      ▼
IPC Handler
      │
      ├──► SessionStore.createSession()
      │         │
      │         ▼
      │    SQLite INSERT
      │
      ├──► Runner.runClaude()
      │         │
      │         ▼
      │    Claude Agent SDK
      │         │
      │         ▼
      │    流式事件 → onEvent()
      │
      └──► 广播 session.status
                │
                ▼
           渲染进程更新
```

### 2. 消息流式显示

```
Claude SDK stream.message
         │
         ▼
onEvent({ type: "stream.message", payload })
         │
         ├──► SessionStore.recordMessage()
         │          │
         │          ▼
         │     SQLite INSERT INTO messages
         │
         └──► broadcast(event)
                   │
                   ▼
              渲染进程接收
                   │
                   ▼
              Zustand Store 更新
                   │
                   ▼
              MessageList 重渲染
```

### 3. 权限请求流程

```
Claude SDK 请求工具权限
         │
         ▼
PermissionManager.shouldRequestPermission()
         │
         ├──► 危险工具 && forceConfirmDangerous
         │          │
         │          ▼
         │     持久化权限请求
         │          │
         │          ▼
         │     broadcast(permission.request)
         │          │
         │          ▼
         │     渲染进程显示弹窗
         │          │
         │          ▼
         │     用户选择
         │          │
         │          ▼
         │     IPC: permission.response
         │          │
         │          ▼
         │     resolve(permissionResult)
         │
         └──► 自动批准（如 Read、Glob）
```

## 状态管理

### Zustand Store 设计原则

1. **单一数据源**: 所有会话状态集中在 `sessions` 对象
2. **不可变更新**: 使用 immer 式更新
3. **选择性订阅**: 组件只订阅需要的字段

```typescript
// 组件只订阅 activeSessionId
const activeSessionId = useAppStore((s) => s.activeSessionId);

// 不会因其他状态变化重渲染
const sessions = useAppStore((s) => s.sessions); // ❌ 不推荐
const activeSession = useAppStore((s) => s.sessions[s.activeSessionId]); // ✅ 推荐
```

### 状态同步策略

```
SQLite (主进程) ←──── IPC ────→ Zustand (渲染进程)
     │                              │
     │                              │
     ▼                              ▼
  持久化                        UI 渲染
```

- **主进程**: SQLite 是数据的唯一真实来源
- **渲染进程**: Zustand 作为 UI 状态缓存
- **同步**: IPC 事件驱动状态更新

## 持久化层

### SQLite 表结构

```sql
-- 会话表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  claude_session_id TEXT,
  cwd TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'idle',
  allowed_tools TEXT,  -- JSON array
  last_prompt TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- 消息表
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message TEXT NOT NULL,  -- JSON
  created_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 权限请求表
CREATE TABLE pending_permissions (
  tool_use_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input TEXT,  -- JSON
  created_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 索引
CREATE INDEX idx_messages_session ON messages(session_id, created_at DESC);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

### WAL 模式

启用 Write-Ahead Logging 提升并发性能：

```typescript
this.db.pragma("journal_mode = WAL");
this.db.pragma("synchronous = NORMAL");
```

### 崩溃恢复

应用启动时恢复未处理的权限请求：

```typescript
// session-store.ts
recoverPendingPermissions(): StoredPendingPermission[] {
  const rows = this.db.prepare(`
    SELECT * FROM pending_permissions
    WHERE created_at > ?
  `).all(Date.now() - 3600000);  // 1小时内
  return rows;
}
```

## IPC 协议

### 客户端事件（Client → Main）

```typescript
type ClientEvent =
  | { type: "session.list" }
  | { type: "session.start"; payload: { cwd: string; prompt: string; title?: string; allowedTools?: string[] } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string } }
  | { type: "session.stop"; payload: { sessionId: string } }
  | { type: "session.delete"; payload: { sessionId: string } }
  | { type: "session.history"; payload: { sessionId: string } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: PermissionResult } };
```

### 服务端事件（Main → Client）

```typescript
type ServerEvent =
  | { type: "session.list"; payload: { sessions: SessionMeta[] } }
  | { type: "session.status"; payload: { sessionId: string; status: string; title?: string; cwd?: string; error?: string } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "session.history"; payload: { sessionId: string; status: string; messages: StreamMessage[] } }
  | { type: "stream.message"; payload: { sessionId: string; message: StreamMessage } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string } }
  | { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown } }
  | { type: "runner.error"; payload: { sessionId: string; message: string } };
```

## 安全设计

### 1. contextBridge 隔离

所有 IPC 通信通过预定义的 API，避免直接暴露 Node.js API：

```typescript
// preload.ts
contextBridge.exposeInMainWorld("electron", {
  // 仅暴露必要的 API
  sendEvent: (event) => ipcRenderer.send("client-event", event),
  onServerEvent: (callback) => ipcRenderer.on("server-event", callback),
});
```

### 2. 权限策略

```typescript
// 工具风险分级
const TOOL_RISK_LEVELS = {
  high: ["Bash", "Write", "Edit"],      // 危险
  medium: ["Task", "Agent"],            // 中等
  low: ["Read", "Glob", "Grep"],        // 安全
};
```

### 3. 路径限制

Bash 工具限制在会话工作目录内：

```typescript
// runner.ts
if (toolName === "Bash") {
  const command = input.command as string;
  // 验证命令不包含危险操作
  if (command.includes("rm -rf") && !command.includes(cwd)) {
    return { behavior: "deny", reason: "Cannot delete outside work directory" };
  }
}
```

### 4. 敏感信息保护

- API Key 当前存储在应用本地配置文件和应用专用 Claude SDK settings 文件中；暂未接入系统 Keychain 或 electron-safe-storage
- 不在日志中记录敏感信息
- 会话数据本地存储，不上传云端

---

## 扩展阅读

- [IPC 协议详解](./IPC.md)（计划中）
- [开发指南](./DEVELOPMENT.md)（计划中）
- [Claude Agent SDK 文档](https://docs.anthropic.com/en/docs/claude-code)
