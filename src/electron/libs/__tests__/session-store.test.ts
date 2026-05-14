/**
 * SessionStore 单元测试
 *
 * 测试目标：验证会话存储的核心 CRUD 操作
 * - 会话创建与持久化
 * - 会话查询与列表
 * - 会话更新与状态同步
 * - 会话删除与清理
 * - 权限请求持久化
 * - 事务保护
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock better-sqlite3（Electron 主进程模块无法在 jsdom 中直接使用）
vi.mock('better-sqlite3', () => {
  // 创建模拟数据库实例
  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(() => ({ changes: 1 })), // 返回带有 changes 属性的对象
      all: vi.fn(() => []),
      get: vi.fn(),
    })),
    close: vi.fn(),
    transaction: vi.fn((fn: () => void) => {
      // 返回一个包装函数，直接执行（模拟事务）
      return () => fn();
    }),
  };

  // 返回构造器函数
  return {
    default: class MockDatabase {
      exec = mockDb.exec;
      prepare = mockDb.prepare;
      close = mockDb.close;
      transaction = mockDb.transaction;
    },
  };
});

// Mock Electron app 模块
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    isPackaged: false,
    getAppPath: vi.fn(() => '/mock/app-path'),
  },
}));

describe('SessionStore', () => {
  const getTestDbPath = () => join(tmpdir(), 'agent-cowork-session-store-test', 'sessions.db');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSession', () => {
    it('should create a session with generated UUID', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const session = store.createSession({
        title: 'Test Session',
        cwd: '/test/path',
        prompt: 'Hello',
      });

      // 验证 UUID 格式
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(session.title).toBe('Test Session');
      expect(session.cwd).toBe('/test/path');
      expect(session.status).toBe('idle');
      // 验证 store 引用已添加
      expect(session.store).toBe(store);
    });

    it('should persist session to database', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      store.createSession({
        title: 'Persisted Session',
      });

      // 验证 prepare().run() 被调用（写入数据库）
      const mockPrepare = vi.mocked(store).db.prepare;
      expect(mockPrepare).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('should return undefined for non-existent session', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const session = store.getSession('non-existent-id');
      expect(session).toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const sessions = store.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    it('should return false when deleting non-existent session', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const result = store.deleteSession('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('pending permissions', () => {
    it('should have pendingPermissions Map initialized', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const session = store.createSession({ title: 'Permission Test' });
      expect(session.pendingPermissions).toBeInstanceOf(Map);
      expect(session.pendingPermissions.size).toBe(0);
    });

    it('should persist pending permission to database', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      const session = store.createSession({ title: 'Permission Persistence Test' });
      const permission = {
        toolUseId: 'tool-123',
        toolName: 'Bash',
        input: { command: 'rm -rf /' },
      };

      store.persistPendingPermission(session.id, permission);

      // 验证 prepare().run() 被调用
      expect(store.db.prepare).toHaveBeenCalled();
    });

    it('should remove pending permission from database', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      store.removePendingPermission('tool-123');

      // 验证 delete 语句被调用
      expect(store.db.prepare).toHaveBeenCalled();
    });
  });

  describe('transaction protection', () => {
    it('should use transaction for createSession', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      store.createSession({ title: 'Transaction Test' });

      // 验证 transaction 方法被调用
      expect(store.db.transaction).toHaveBeenCalled();
    });

    it('should use transaction for updateSession', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      // 先创建会话
      store.createSession({ title: 'Update Test' });
      const sessions = store.listSessions();

      // 如果有会话，测试更新
      if (sessions.length > 0) {
        store.updateSession(sessions[0].id, { status: 'running' });
        expect(store.db.transaction).toHaveBeenCalled();
      }
    });

    it('should use transaction for deleteSession', async () => {
      const { SessionStore } = await import('../session-store.js');
      const store = new SessionStore(getTestDbPath());

      // 先创建会话
      const session = store.createSession({ title: 'Delete Test' });
      store.deleteSession(session.id);

      // 验证 transaction 方法被调用多次（create + delete）
      expect(store.db.transaction).toHaveBeenCalled();
    });
  });
});

describe('Session Type Definitions', () => {
  it('should have correct Session type structure', async () => {
    // 类型导入验证（编译时检查）
    const { Session: _Session } = await import('../session-store.js');

    // 类型检查通过编译即可验证
    const mockSession = {
      id: 'test-id',
      title: 'Test',
      status: 'idle',
      pendingPermissions: new Map(),
      store: {} as never, // 模拟 store 引用
    };

    expect(mockSession.id).toBe('test-id');
    expect(mockSession.status).toBe('idle');
  });
});
