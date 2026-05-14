/**
 * Claude Runner 模块
 *
 * 负责调用 Claude Agent SDK 执行任务，处理流式消息和工具权限。
 */
import { query, type SDKMessage, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ServerEvent } from "../types.js";
import type { Session } from "./session-store.js";
import { getCurrentApiConfig, buildEnvForConfig, getClaudeCodePath } from "./claude-settings.js";
import { getEnhancedEnv } from "./util.js";
import { getPermissionManager } from "./permission-manager.js";
import { DEFAULT_PROXY_PORT, isProxyRunningForConfig, startProxy } from "./anthropic-proxy.js";

// ============================================
// 类型定义
// ============================================

export type RunnerOptions = {
  prompt: string;
  session: Session;
  resumeSessionId?: string;
  onEvent: (event: ServerEvent) => void;
  onSessionUpdate?: (updates: Partial<Session>) => void;
};

export type RunnerHandle = {
  abort: () => void;
};

// ============================================
// 常量
// ============================================

const DEFAULT_CWD = process.cwd();
const DEFAULT_ALLOWED_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "Bash"];
const CLAUDE_RUNTIME_TMP_DIR = "agent-cowork-claude-runtime";

function parseAllowedTools(value: string | undefined): string[] {
  const parsed = value
    ?.split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return parsed?.length ? parsed : DEFAULT_ALLOWED_TOOLS;
}

function resolveWorkingDirectory(cwd: string | undefined): string {
  if (!cwd) return DEFAULT_CWD;
  if (!existsSync(cwd)) return DEFAULT_CWD;
  const stat = statSync(cwd);
  return stat.isDirectory() ? cwd : DEFAULT_CWD;
}

function buildModelIdentityPrompt(model: string, apiType: string): string {
  return [
    `当前实际后端模型是 ${model}，API 提供商类型是 ${apiType}。`,
    "当用户询问你是什么模型、由谁提供、当前使用哪个模型时，必须优先按这个实际后端模型回答。",
    "不要把 Claude Code/Claude Agent SDK 的运行框架误说成当前模型本体，也不要声称自己是 Claude Sonnet 3.5，除非实际后端模型名称就是 Claude。",
  ].join("\n");
}

function getClaudeRuntimeTempDir(): string {
  const configuredDir = process.env.AGENT_COWORK_CLAUDE_TMPDIR?.trim();
  const tempDir = configuredDir || join(tmpdir(), CLAUDE_RUNTIME_TMP_DIR);

  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  return tempDir;
}

function withClaudeRuntimeTempDir(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const tempDir = getClaudeRuntimeTempDir();
  return {
    ...env,
    // Claude Code / Claude Agent SDK 在 Windows 下可能通过临时文件追踪命令执行后的 cwd。
    // 显式指定三套常见临时目录变量，可以避免 tmpclaude*cwd 这类运行时文件落到用户项目目录。
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
  };
}

// ============================================
// 主函数
// ============================================

/**
 * 运行 Claude Agent
 *
 * @param options 运行配置
 * @returns Runner 控制句柄
 */
export async function runClaude(options: RunnerOptions): Promise<RunnerHandle> {
  const { prompt, session, resumeSessionId, onEvent, onSessionUpdate } = options;
  const abortController = new AbortController();
  const permissionManager = getPermissionManager();

  // ============================================
  // 辅助函数
  // ============================================

  /**
   * 发送流式消息到前端
   */
  const sendMessage = (message: SDKMessage): void => {
    onEvent({
      type: "stream.message",
      payload: { sessionId: session.id, message },
    });
  };

  /**
   * 发送权限请求到前端
   */
  const sendPermissionRequest = (toolUseId: string, toolName: string, input: unknown): void => {
    onEvent({
      type: "permission.request",
      payload: { sessionId: session.id, toolUseId, toolName, input },
    });
  };

  /**
   * 处理工具权限请求
   *
   * 根据 PermissionManager 的决策决定是否需要用户确认
   * 支持持久化权限请求以实现崩溃恢复
   */
  const handleToolPermission = async (
    toolName: string,
    input: unknown,
    signal: AbortSignal
  ): Promise<PermissionResult> => {
    // 获取权限决策
    const decision = permissionManager.shouldRequestPermission(toolName, input, session.id);

    // 记录日志（使用 console.warn 绕过 lint 警告）
    console.warn(`[Runner] Tool ${toolName}: ${decision.behavior} (${decision.reason})`);

    // 自动批准
    if (decision.behavior === "allow") {
      return { behavior: "allow", updatedInput: input as Record<string, unknown> | undefined };
    }

    // 自动拒绝
    if (decision.behavior === "deny") {
      return { behavior: "deny", message: `Tool ${toolName} is not allowed` };
    }

    // 需要用户确认
    const toolUseId = crypto.randomUUID();

    // 持久化权限请求（用于崩溃恢复）
    session.store.persistPendingPermission(session.id, {
      toolUseId,
      toolName,
      input,
    });

    // 发送权限请求到前端
    sendPermissionRequest(toolUseId, toolName, input);

    // 等待用户响应
    return new Promise<PermissionResult>((resolve) => {
      session.pendingPermissions.set(toolUseId, {
        toolUseId,
        toolName,
        input,
        resolve: (result) => {
          session.pendingPermissions.delete(toolUseId);
          // 权限请求完成，从数据库删除
          session.store.removePendingPermission(toolUseId);
          resolve(result as PermissionResult);
        },
      });

      // 处理中止信号
      signal.addEventListener("abort", () => {
        session.pendingPermissions.delete(toolUseId);
        session.store.removePendingPermission(toolUseId);
        resolve({ behavior: "deny", message: "Session aborted" });
      });
    });
  };

  // ============================================
  // 主执行逻辑
  // ============================================

  // 在后台执行
  (async () => {
    try {
      // 获取 API 配置
      const config = getCurrentApiConfig();

      if (!config) {
        onEvent({
          type: "session.status",
          payload: {
            sessionId: session.id,
            status: "error",
            title: session.title,
            cwd: session.cwd,
            error: "API configuration not found. Please configure API settings.",
          },
        });
        return;
      }

      const apiType = config.apiType || "nvidia";
      if (apiType === "nvidia") {
        const proxyConfig = {
          port: DEFAULT_PROXY_PORT,
          targetBaseURL: config.baseURL,
          targetAPIKey: config.apiKey,
          targetModel: config.model,
        };

        if (!isProxyRunningForConfig(proxyConfig)) {
          await startProxy(proxyConfig);
        }
      }

      // 构建环境变量
      const env = buildEnvForConfig(config);
      const mergedEnv = withClaudeRuntimeTempDir({
        ...getEnhancedEnv(),
        ...env,
      });
      const cwd = resolveWorkingDirectory(session.cwd);
      const allowedTools = parseAllowedTools(session.allowedTools);

      // 创建 Claude 查询
      const q = query({
        prompt,
        options: {
          cwd,
          additionalDirectories: [cwd],
          resume: resumeSessionId,
          abortController,
          env: mergedEnv,
          model: config.model,
          pathToClaudeCodeExecutable: getClaudeCodePath(),
          settingSources: ["user"],
          allowedTools,
          permissionMode: "bypassPermissions",
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: buildModelIdentityPrompt(config.model, apiType),
          },
          includePartialMessages: true,
          allowDangerouslySkipPermissions: true,
          // 使用 PermissionManager 处理工具权限
          canUseTool: async (toolName, input, { signal }) => {
            return handleToolPermission(toolName, input, signal);
          },
        },
      });

      // 处理流式消息
      for await (const message of q) {
        // 提取 Claude 会话 ID
        if (message.type === "system" && "subtype" in message && message.subtype === "init") {
          const sdkSessionId = message.session_id;
          if (sdkSessionId) {
            session.claudeSessionId = sdkSessionId;
            onSessionUpdate?.({ claudeSessionId: sdkSessionId });
          }
        }

        // 发送消息到前端
        sendMessage(message);

        // 更新会话状态
        if (message.type === "result") {
          const status = message.subtype === "success" ? "completed" : "error";
          onEvent({
            type: "session.status",
            payload: { sessionId: session.id, status, title: session.title },
          });
        }
      }

      // 正常完成
      if (session.status === "running") {
        onEvent({
          type: "session.status",
          payload: { sessionId: session.id, status: "completed", title: session.title },
        });
      }
    } catch (error) {
      // 处理中止错误
      if ((error as Error).name === "AbortError") {
        return;
      }

      // 其他错误
      onEvent({
        type: "session.status",
        payload: {
          sessionId: session.id,
          status: "error",
          title: session.title,
          error: String(error),
        },
      });
    }
  })();

  return {
    abort: () => abortController.abort(),
  };
}
