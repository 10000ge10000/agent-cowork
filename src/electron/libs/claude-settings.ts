import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadApiConfig, saveApiConfig, type ApiConfig, type ApiType } from "./config-store.js";
import { app } from "electron";
import { DEFAULT_PROXY_PORT } from "./anthropic-proxy.js";

// Get Claude Code CLI path
export function getClaudeCodePath(): string {
  if (app.isPackaged) {
    // For packaged apps, the SDK needs the explicit path to the CLI
    // The path should point to the unpackaged asar.unpacked directory
    return join(
      process.resourcesPath,
      'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    );
  }
  // In development, use node_modules CLI
  return join(app.getAppPath(), 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js');
}

function getAppClaudeConfigDir(): string {
  return join(app.getPath("userData"), "claude-sdk-config");
}

function getClaudeBaseURL(config: ApiConfig): string {
  const apiType = config.apiType || "nvidia";
  if (apiType === "nvidia") {
    return `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;
  }

  let baseURL = config.baseURL.replace(/\/+$/, "");
  if (baseURL.endsWith("/v1/messages")) {
    baseURL = baseURL.slice(0, -12);
  } else if (baseURL.endsWith("/v1")) {
    baseURL = baseURL.slice(0, -3);
  }
  return baseURL;
}

function ensureAppClaudeConfig(config: ApiConfig): string {
  const configDir = getAppClaudeConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Claude Code 会读取默认模型族；这里全部写成当前 App 配置的模型，隔离用户全局 ~/.claude* 配置。
  const settings = {
    env: {
      ANTHROPIC_API_KEY: config.apiKey,
      ANTHROPIC_AUTH_TOKEN: config.apiKey,
      ANTHROPIC_BASE_URL: getClaudeBaseURL(config),
      ANTHROPIC_MODEL: config.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: config.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
    },
    model: config.model,
    bypassPermissions: true,
  };

  writeFileSync(join(configDir, "settings.json"), JSON.stringify(settings, null, 2), "utf8");
  return configDir;
}

// 获取当前有效的配置（优先界面配置，回退到文件配置）
export function getCurrentApiConfig(): ApiConfig | null {
  const uiConfig = loadApiConfig();
  if (uiConfig) {
    console.warn("[claude-settings] Using UI config:", {
      baseURL: uiConfig.baseURL,
      model: uiConfig.model,
      apiType: uiConfig.apiType
    });
    return uiConfig;
  }

  // 回退到 ~/.claude/settings.json
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const raw = readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> };
    if (parsed.env) {
      const authToken = parsed.env.ANTHROPIC_AUTH_TOKEN;
      const baseURL = parsed.env.ANTHROPIC_BASE_URL;
      const model = parsed.env.ANTHROPIC_MODEL;

      if (authToken && baseURL && model) {
        console.warn("[claude-settings] Using file config from ~/.claude/settings.json");
        const config: ApiConfig = {
          apiKey: String(authToken),
          baseURL: String(baseURL),
          model: String(model),
          apiType: "custom" // 回退配置视为自定义类型
        };
        // 持久化到 api-config.json
        try {
          saveApiConfig(config);
          console.warn("[claude-settings] Persisted config to api-config.json");
        } catch (e) {
          console.error("[claude-settings] Failed to persist config:", e);
        }
        return config;
      }
    }
  } catch {
    // Ignore missing or invalid settings file.
  }

  console.warn("[claude-settings] No config found");
  return null;
}

/**
 * 构建环境变量用于 Claude Agent SDK
 *
 * NVIDIA API 说明：
 * - NVIDIA NIM 使用 OpenAI 兼容格式 (/chat/completions)
 * - Claude SDK 需要 Anthropic 格式 (/v1/messages)
 * - 通过内置代理转换请求格式
 * - 代理地址: http://127.0.0.1:18765
 *
 * 自定义 API 说明：
 * - 需要用户自己提供 Anthropic 兼容的端点
 * - 直接使用用户提供的 ANTHROPIC_BASE_URL
 */
export function buildEnvForConfig(config: ApiConfig): Record<string, string> {
  const baseEnv = { ...process.env } as Record<string, string>;
  const apiType = config.apiType || "nvidia";
  const claudeConfigDir = ensureAppClaudeConfig(config);

  // 设置认证令牌
  baseEnv.ANTHROPIC_API_KEY = config.apiKey;
  baseEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  baseEnv.CLAUDE_CONFIG_DIR = claudeConfigDir;

  if (apiType === "nvidia") {
    // NVIDIA API 必须通过本地代理转换协议，禁止回退直连 NVIDIA。
    // 直连会让 Claude SDK 的 Anthropic 请求打到 OpenAI 兼容端点，容易触发 invalid model / invalid request。
    baseEnv.ANTHROPIC_BASE_URL = getClaudeBaseURL(config);
    console.warn("[claude-settings] Using local proxy for NVIDIA API");
  } else {
    baseEnv.ANTHROPIC_BASE_URL = getClaudeBaseURL(config);
  }

  // Claude Code 内部可能根据 haiku/sonnet/opus 三个默认槽位选择模型；全部固定到 App 当前模型。
  baseEnv.ANTHROPIC_MODEL = config.model;
  baseEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.model;
  baseEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
  baseEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = config.model;

  // 记录配置（调试用）
  console.warn("[claude-settings] Built env for API:", {
    apiType,
    baseURL: baseEnv.ANTHROPIC_BASE_URL,
    model: baseEnv.ANTHROPIC_MODEL,
    targetModel: config.model,
    claudeConfigDir,
    hasApiKey: !!baseEnv.ANTHROPIC_AUTH_TOKEN
  });

  return baseEnv;
}

/**
 * 获取 API 类型显示名称
 */
export function getApiTypeDisplayName(apiType: ApiType): string {
  switch (apiType) {
    case "nvidia":
      return "NVIDIA";
    case "custom":
      return "自定义";
    default:
      return "未知";
  }
}
