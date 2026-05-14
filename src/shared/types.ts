/**
 * Claude-Cowork 共享类型定义
 *
 * 此模块统一前后端 IPC 通信的类型定义，消除重复。
 * 所有涉及 IPC 的类型都应从此模块导入。
 */
import type { SDKMessage, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// ============================================
// 基础类型定义
// ============================================

/**
 * 用户提示消息（用于 UI 显示）
 */
export type UserPromptMessage = {
  type: "user_prompt";
  prompt: string;
};

/**
 * 流式消息类型（SDK 消息 + 用户提示）
 */
export type StreamMessage = SDKMessage | UserPromptMessage;

/**
 * 会话状态
 */
export type SessionStatus = "idle" | "running" | "completed" | "error";

/**
 * 会话基本信息（列表展示用）
 */
export type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  claudeSessionId?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * API 提供商类型
 */
export type ApiType = "nvidia" | "custom";

/**
 * API 配置类型
 */
export type ApiConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: ApiType;
};

/**
 * 工具权限行为。
 */
export type PermissionBehavior = "allow" | "deny" | "ask-user";

/**
 * 全局权限配置。
 *
 * 这份配置必须由主进程持久化并在 Runner 中生效，不能只停留在渲染进程 localStorage。
 */
export type PermissionConfig = {
  defaultMode: "auto-approve" | "ask-user" | "smart";
  toolOverrides: Record<string, PermissionBehavior>;
  forceConfirmDangerous: boolean;
  enableLogging: boolean;
};

// ============================================
// IPC 事件类型定义
// ============================================

/**
 * 服务端 -> 客户端事件
 */
export type ServerEvent =
  | { type: "stream.message"; payload: { sessionId: string; message: StreamMessage } }
  | { type: "stream.user_prompt"; payload: { sessionId: string; prompt: string } }
  | { type: "session.status"; payload: { sessionId: string; status: SessionStatus; title?: string; cwd?: string; error?: string } }
  | { type: "session.list"; payload: { sessions: SessionInfo[] } }
  | { type: "session.history"; payload: { sessionId: string; status: SessionStatus; messages: StreamMessage[] } }
  | { type: "session.deleted"; payload: { sessionId: string } }
  | { type: "permission.request"; payload: { sessionId: string; toolUseId: string; toolName: string; input: unknown } }
  | { type: "runner.error"; payload: { sessionId?: string; message: string } };

/**
 * 客户端 -> 服务端事件
 */
export type ClientEvent =
  | { type: "session.start"; payload: { title: string; prompt: string; cwd?: string; allowedTools?: string } }
  | { type: "session.continue"; payload: { sessionId: string; prompt: string } }
  | { type: "session.stop"; payload: { sessionId: string } }
  | { type: "session.delete"; payload: { sessionId: string } }
  | { type: "session.list" }
  | { type: "session.history"; payload: { sessionId: string } }
  | { type: "permission.response"; payload: { sessionId: string; toolUseId: string; result: PermissionResult } };

// ============================================
// 系统统计类型
// ============================================

/**
 * 系统统计数据
 */
export type Statistics = {
  cpuUsage: number;
  ramUsage: number;
  storageData: number;
};

/**
 * 静态系统数据
 */
export type StaticData = {
  totalStorage: number;
  cpuModel: string;
  totalMemoryGB: number;
};

/**
 * 取消订阅函数
 */
export type UnsubscribeFunction = () => void;

// ============================================
// IPC 通道映射
// ============================================

/**
 * IPC invoke 通道与返回值类型映射
 */
export type IpcInvokeMapping = {
  "getStaticData": StaticData;
  "generate-session-title": string;
  "get-recent-cwds": string[];
  "select-directory": string | null;
  "get-api-config": ApiConfig | null;
  "save-api-config": { success: boolean; error?: string };
  "check-api-config": { hasConfig: boolean; config: ApiConfig | null };
  "get-permission-config": PermissionConfig;
  "save-permission-config": { success: boolean; error?: string };
  "get-proxy-status": { running: boolean; config: { port: number; targetBaseURL: string; targetModel: string } | null };
  "test-api-connection": { success: boolean; message: string };
};

/**
 * IPC on 通道与回调参数类型映射
 */
export type IpcOnMapping = {
  "statistics": Statistics;
  "server-event": string; // JSON 序列化的 ServerEvent
};

// ============================================
// 类型守卫函数
// ============================================

/**
 * 检查是否为用户提示消息
 */
export function isUserPromptMessage(msg: StreamMessage): msg is UserPromptMessage {
  return msg.type === "user_prompt";
}

/**
 * 检查是否为 SDK 消息
 */
export function isSDKMessage(msg: StreamMessage): msg is SDKMessage {
  return msg.type !== "user_prompt";
}

/**
 * 检查会话是否处于活跃状态
 */
export function isActiveSession(status: SessionStatus): boolean {
  return status === "running" || status === "idle";
}
