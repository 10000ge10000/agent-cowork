/**
 * 全局类型定义
 *
 * 定义渲染进程中 window.electron 的接口类型。
 */
import type {
  Statistics,
  StaticData,
  UnsubscribeFunction,
  ApiConfig,
  PermissionConfig,
  ClientEvent,
  ServerEvent,
} from "./src/shared/index";

declare global {
  interface Window {
    electron: {
      // 系统统计相关
      subscribeStatistics: (callback: (statistics: Statistics) => void) => UnsubscribeFunction;
      getStaticData: () => Promise<StaticData>;

      // Claude Agent IPC APIs（类型安全）
      sendClientEvent: (event: ClientEvent) => void;
      onServerEvent: (callback: (event: ServerEvent) => void) => UnsubscribeFunction;

      // 会话管理
      generateSessionTitle: (userInput: string | null) => Promise<string>;
      getRecentCwds: (limit?: number) => Promise<string[]>;
      selectDirectory: () => Promise<string | null>;

      // API 配置管理
      getApiConfig: () => Promise<ApiConfig | null>;
      saveApiConfig: (config: ApiConfig) => Promise<{ success: boolean; error?: string }>;
      checkApiConfig: () => Promise<{ hasConfig: boolean; config: ApiConfig | null }>;
      getPermissionConfig: () => Promise<PermissionConfig>;
      savePermissionConfig: (config: PermissionConfig) => Promise<{ success: boolean; error?: string }>;

      // 代理状态
      getProxyStatus: () => Promise<{ running: boolean; config: { port: number; targetBaseURL: string; targetModel: string } | null }>;

      // API 连接测试
      testApiConnection: (config: ApiConfig) => Promise<{ success: boolean; message: string }>;
    };
  }
}

export {};
