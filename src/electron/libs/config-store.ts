import { app } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import type { PermissionBehavior, PermissionConfig } from "../../shared/types.js";

export type ApiType = "nvidia" | "custom";

export type ApiConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: ApiType; // "anthropic" | "nvidia" | "custom"
};

const CONFIG_FILE_NAME = "api-config.json";
const PERMISSION_CONFIG_FILE_NAME = "permission-config.json";

/**
 * 获取配置存储路径
 *
 * Portable 模式说明：
 * - electron-builder 的 portable 目标会在临时目录运行
 * - 使用 PORTABLE_EXECUTABLE_DIR 环境变量获取原始 exe 位置
 * - 配置文件放在 exe 同级目录，实现真正的便携
 */
function getStorePath(fileName: string): string {
  // 检测 portable 模式：electron-builder 会设置此变量
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;

  if (portableDir) {
    console.warn("[config-store] Portable mode detected, exe dir:", portableDir);
    return join(portableDir, fileName);
  }

  // 标准模式：使用 userData
  try {
    const userDataPath = app.getPath("userData");
    console.warn("[config-store] Standard mode, userData path:", userDataPath);
    return join(userDataPath, fileName);
  } catch (error) {
    console.error("[config-store] Failed to get userData path:", error);
    // 最终回退：使用当前工作目录
    const fallbackPath = join(process.cwd(), fileName);
    console.warn("[config-store] Using fallback path:", fallbackPath);
    return fallbackPath;
  }
}

function getConfigPath(): string {
  return getStorePath(CONFIG_FILE_NAME);
}

function getPermissionConfigPath(): string {
  return getStorePath(PERMISSION_CONFIG_FILE_NAME);
}

function isPermissionBehavior(value: unknown): value is PermissionBehavior {
  return value === "allow" || value === "deny" || value === "ask-user";
}

function normalizePermissionConfig(value: unknown): PermissionConfig | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Partial<PermissionConfig>;
  const defaultMode = raw.defaultMode;
  if (defaultMode !== "smart" && defaultMode !== "ask-user" && defaultMode !== "auto-approve") {
    return null;
  }

  const toolOverrides: Record<string, PermissionBehavior> = {};
  if (raw.toolOverrides && typeof raw.toolOverrides === "object") {
    for (const [toolName, behavior] of Object.entries(raw.toolOverrides)) {
      if (toolName && isPermissionBehavior(behavior)) {
        toolOverrides[toolName] = behavior;
      }
    }
  }

  return {
    defaultMode,
    toolOverrides,
    forceConfirmDangerous: raw.forceConfirmDangerous !== false,
    enableLogging: raw.enableLogging !== false,
  };
}

export function loadApiConfig(): ApiConfig | null {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
      return null;
    }
    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as ApiConfig;
    // 验证配置格式
    if (config.apiKey && config.baseURL && config.model) {
      // 设置默认 apiType
      if (!config.apiType) {
        config.apiType = "nvidia";
      }
      return config;
    }
    return null;
  } catch (error) {
    console.error("[config-store] Failed to load API config:", error);
    return null;
  }
}

export function saveApiConfig(config: ApiConfig): void {
  try {
    const configPath = getConfigPath();
    const configDir = dirname(configPath);

    // 确保目录存在 make sure directory exists
    if (!existsSync(configDir)) {
      console.warn("[config-store] Creating config directory:", configDir);
      mkdirSync(configDir, { recursive: true });
    }

    // 验证配置 validate config
    if (!config.apiKey || !config.baseURL || !config.model) {
      throw new Error("Invalid config: apiKey, baseURL, and model are required");
    }

    // 设置默认 apiType set default apiType
    if (!config.apiType) {
      config.apiType = "nvidia";
    }

    // 保存配置 save config
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    console.warn("[config-store] API config saved successfully");
  } catch (error) {
    console.error("[config-store] Failed to save API config:", error);
    throw error;
  }
}

export function deleteApiConfig(): void {
  try {
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      unlinkSync(configPath);
      console.warn("[config-store] API config deleted");
    }
  } catch (error) {
    console.error("[config-store] Failed to delete API config:", error);
  }
}

export function loadPermissionConfig(): PermissionConfig | null {
  try {
    const configPath = getPermissionConfigPath();
    if (!existsSync(configPath)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    return normalizePermissionConfig(parsed);
  } catch (error) {
    console.error("[config-store] Failed to load permission config:", error);
    return null;
  }
}

export function savePermissionConfig(config: PermissionConfig): void {
  const normalized = normalizePermissionConfig(config);
  if (!normalized) {
    throw new Error("Invalid permission config");
  }

  const configPath = getPermissionConfigPath();
  const configDir = dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(normalized, null, 2), "utf8");
}

