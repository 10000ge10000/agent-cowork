/**
 * Electron Preload 脚本
 *
 * 安全地将主进程 API 暴露给渲染进程，使用类型安全的 IPC 包装器。
 */
import electron from "electron";
import type {
  ServerEvent,
  ClientEvent,
  ApiConfig,
  PermissionConfig,
  Statistics,
  StaticData,
  IpcInvokeMapping,
} from "../shared/types.js";

// ============================================
// 类型安全的 IPC 辅助函数
// ============================================

/**
 * 类型安全的 ipcRenderer.invoke
 */
function ipcInvoke<Key extends keyof IpcInvokeMapping>(
  key: Key,
  ...args: unknown[]
): Promise<IpcInvokeMapping[Key]> {
  return electron.ipcRenderer.invoke(key, ...args) as Promise<IpcInvokeMapping[Key]>;
}

/**
 * 类型安全的 ipcRenderer.on
 */
function ipcOn<Key extends "statistics">(
  key: Key,
  callback: (payload: Statistics) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: Statistics): void => {
    callback(payload);
  };
  electron.ipcRenderer.on(key, handler);
  return () => electron.ipcRenderer.removeListener(key, handler);
}

// ============================================
// 暴露 API 到渲染进程
// ============================================

electron.contextBridge.exposeInMainWorld("electron", {
  // -------------------------------------------
  // 系统统计
  // -------------------------------------------
  subscribeStatistics: (callback: (stats: Statistics) => void) => {
    return ipcOn("statistics", callback);
  },
  getStaticData: () => ipcInvoke("getStaticData"),

  // -------------------------------------------
  // Claude Agent IPC APIs（类型安全）
  // -------------------------------------------

  /**
   * 发送客户端事件到主进程
   */
  sendClientEvent: (event: ClientEvent): void => {
    electron.ipcRenderer.send("client-event", JSON.stringify(event));
  },

  /**
   * 订阅服务端事件
   * @returns 取消订阅函数
   */
  onServerEvent: (callback: (event: ServerEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: string): void => {
      try {
        const parsedEvent = JSON.parse(payload) as ServerEvent;
        callback(parsedEvent);
      } catch (error) {
        console.error("[Preload] Failed to parse server event:", error);
      }
    };
    electron.ipcRenderer.on("server-event", handler);
    return () => electron.ipcRenderer.removeListener("server-event", handler);
  },

  // -------------------------------------------
  // 会话管理
  // -------------------------------------------
  generateSessionTitle: (userInput: string | null): Promise<string> => {
    return ipcInvoke("generate-session-title", userInput);
  },
  getRecentCwds: (limit?: number): Promise<string[]> => {
    return ipcInvoke("get-recent-cwds", limit);
  },
  selectDirectory: (): Promise<string | null> => {
    return ipcInvoke("select-directory");
  },

  // -------------------------------------------
  // API 配置管理
  // -------------------------------------------
  getApiConfig: (): Promise<ApiConfig | null> => {
    return ipcInvoke("get-api-config");
  },
  saveApiConfig: (config: ApiConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcInvoke("save-api-config", config);
  },
  checkApiConfig: (): Promise<{ hasConfig: boolean; config: ApiConfig | null }> => {
    return ipcInvoke("check-api-config");
  },
  getPermissionConfig: (): Promise<PermissionConfig> => {
    return ipcInvoke("get-permission-config");
  },
  savePermissionConfig: (config: PermissionConfig): Promise<{ success: boolean; error?: string }> => {
    return ipcInvoke("save-permission-config", config);
  },

  // -------------------------------------------
  // 代理状态
  // -------------------------------------------
  getProxyStatus: (): Promise<{ running: boolean; config: { port: number; targetBaseURL: string; targetModel: string } | null }> => {
    return ipcInvoke("get-proxy-status");
  },

  // -------------------------------------------
  // API 连接测试
  // -------------------------------------------
  testApiConnection: (config: ApiConfig): Promise<{ success: boolean; message: string }> => {
    return ipcInvoke("test-api-connection", config);
  },
} satisfies Window["electron"]);

// 类型检查：确保暴露的 API 与 Window 接口匹配
type ExposedApi = typeof electron.contextBridge.exposeInMainWorld extends (
  key: string,
  api: infer T
) => void
  ? T
  : never;

// 编译时类型验证（如果不匹配会报错）
declare const _typeCheck: ExposedApi extends Window["electron"]
  ? Window["electron"] extends ExposedApi
    ? true
    : never
  : never;
