/**
 * 权限管理系统
 *
 * 提供可配置的工具权限策略，支持：
 * - 危险操作确认（Bash, Write, Edit 等）
 * - 自动批准条件判断
 * - 权限日志记录
 * - 策略持久化
 */
import type { PermissionBehavior, PermissionConfig } from "../../shared/types.js";

export type { PermissionBehavior, PermissionConfig } from "../../shared/types.js";

// ============================================
// 类型定义
// ============================================

/**
 * 工具风险等级
 */
export type ToolRiskLevel = "safe" | "moderate" | "dangerous";

/**
 * 单个工具的权限策略
 */
export type ToolPolicy = {
  /** 工具名称 */
  toolName: string;
  /** 默认行为 */
  defaultBehavior: PermissionBehavior;
  /** 风险等级 */
  riskLevel: ToolRiskLevel;
  /** 自动批准条件（返回 true 则自动批准） */
  autoApproveCondition?: (input: unknown) => boolean;
  /** 描述信息 */
  description?: string;
};

/**
 * 权限日志条目
 */
export type PermissionLogEntry = {
  timestamp: number;
  sessionId: string;
  toolName: string;
  input: unknown;
  decision: PermissionBehavior;
  reason: string;
};

// ============================================
// 默认配置
// ============================================

/**
 * 默认权限配置
 */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  defaultMode: "smart",
  toolOverrides: {},
  forceConfirmDangerous: true,
  enableLogging: true,
};

/**
 * 内置工具策略定义
 */
export const BUILTIN_TOOL_POLICIES: ToolPolicy[] = [
  // === 危险工具 ===
  {
    toolName: "Bash",
    defaultBehavior: "ask-user",
    riskLevel: "dangerous",
    description: "执行 shell 命令，可能修改系统",
    autoApproveCondition: (input) => {
      // 只读命令自动批准
      const command = (input as { command?: string })?.command ?? "";
      const readOnlyCommands = ["ls", "cat", "echo", "pwd", "which", "git status", "git log", "git diff"];
      return readOnlyCommands.some((cmd) => command.trim().startsWith(cmd));
    },
  },
  {
    toolName: "Write",
    defaultBehavior: "ask-user",
    riskLevel: "dangerous",
    description: "写入文件，可能覆盖现有内容",
  },
  {
    toolName: "Edit",
    defaultBehavior: "ask-user",
    riskLevel: "moderate",
    description: "编辑文件内容",
  },
  {
    toolName: "NotebookEdit",
    defaultBehavior: "ask-user",
    riskLevel: "moderate",
    description: "编辑 Jupyter Notebook",
  },

  // === 中等风险工具 ===
  {
    toolName: "Task",
    defaultBehavior: "ask-user",
    riskLevel: "moderate",
    description: "启动子任务代理",
  },
  {
    toolName: "Agent",
    defaultBehavior: "ask-user",
    riskLevel: "moderate",
    description: "启动代理执行任务",
  },

  // === 安全工具 ===
  {
    toolName: "Read",
    defaultBehavior: "allow",
    riskLevel: "safe",
    description: "读取文件内容",
  },
  {
    toolName: "Glob",
    defaultBehavior: "allow",
    riskLevel: "safe",
    description: "搜索文件模式",
  },
  {
    toolName: "Grep",
    defaultBehavior: "allow",
    riskLevel: "safe",
    description: "搜索文件内容",
  },
  {
    toolName: "WebFetch",
    defaultBehavior: "allow",
    riskLevel: "safe",
    description: "获取网页内容",
  },
  {
    toolName: "WebSearch",
    defaultBehavior: "allow",
    riskLevel: "safe",
    description: "搜索网页",
  },

  // === 需要交互的工具 ===
  {
    toolName: "AskUserQuestion",
    defaultBehavior: "ask-user",
    riskLevel: "safe",
    description: "向用户提问（必须交互）",
  },
];

// ============================================
// PermissionManager 类
// ============================================

/**
 * 权限管理器
 *
 * 管理工具调用的权限策略，决定是否需要用户确认。
 */
export class PermissionManager {
  private config: PermissionConfig;
  private policies: Map<string, ToolPolicy>;
  private logs: PermissionLogEntry[] = [];
  private maxLogEntries = 1000;

  constructor(config: Partial<PermissionConfig> = {}) {
    this.config = { ...DEFAULT_PERMISSION_CONFIG, ...config };
    this.policies = new Map();

    // 注册内置策略
    for (const policy of BUILTIN_TOOL_POLICIES) {
      this.registerPolicy(policy);
    }
  }

  /**
   * 注册工具策略
   */
  registerPolicy(policy: ToolPolicy): void {
    this.policies.set(policy.toolName, policy);
  }

  /**
   * 更新权限配置
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /**
   * 判断工具是否需要请求用户权限
   *
   * @param toolName 工具名称
   * @param input 工具输入参数
   * @param sessionId 会话 ID
   * @returns 权限决策结果
   */
  shouldRequestPermission(
    toolName: string,
    input: unknown,
    sessionId: string
  ): { behavior: PermissionBehavior; reason: string } {
    const policy = this.policies.get(toolName);

    // 1. 检查工具覆盖配置
    if (this.config.toolOverrides[toolName]) {
      const overrideBehavior = this.config.toolOverrides[toolName];
      return this.logAndReturn(sessionId, toolName, input, overrideBehavior, "tool override config");
    }

    // 2. 检查自动批准条件（优先于危险工具检查）
    if (policy?.autoApproveCondition) {
      try {
        if (policy.autoApproveCondition(input)) {
          return this.logAndReturn(sessionId, toolName, input, "allow", "auto-approve condition matched");
        }
      } catch (error) {
        console.warn(`[PermissionManager] Auto-approve condition error for ${toolName}:`, error);
      }
    }

    // 3. 检查危险工具强制确认
    if (this.config.forceConfirmDangerous && policy?.riskLevel === "dangerous") {
      return this.logAndReturn(sessionId, toolName, input, "ask-user", "dangerous tool requires confirmation");
    }

    // 4. 根据默认模式决定
    switch (this.config.defaultMode) {
      case "auto-approve":
        return this.logAndReturn(sessionId, toolName, input, "allow", "auto-approve mode");

      case "ask-user":
        return this.logAndReturn(sessionId, toolName, input, "ask-user", "ask-user mode");

      case "smart":
        // Smart 模式：根据策略风险等级决定
        if (policy) {
          return this.logAndReturn(sessionId, toolName, input, policy.defaultBehavior, "smart mode based on policy");
        }
        // 未知工具默认需要确认
        return this.logAndReturn(sessionId, toolName, input, "ask-user", "smart mode: unknown tool");

      default:
        return this.logAndReturn(sessionId, toolName, input, "ask-user", "fallback decision");
    }
  }

  /**
   * 获取工具的风险等级
   */
  getToolRiskLevel(toolName: string): ToolRiskLevel {
    return this.policies.get(toolName)?.riskLevel ?? "moderate";
  }

  /**
   * 获取工具的策略
   */
  getToolPolicy(toolName: string): ToolPolicy | undefined {
    return this.policies.get(toolName);
  }

  /**
   * 获取所有危险工具列表
   */
  getDangerousTools(): string[] {
    return Array.from(this.policies.values())
      .filter((p) => p.riskLevel === "dangerous")
      .map((p) => p.toolName);
  }

  /**
   * 获取权限日志
   */
  getLogs(sessionId?: string): PermissionLogEntry[] {
    if (sessionId) {
      return this.logs.filter((log) => log.sessionId === sessionId);
    }
    return [...this.logs];
  }

  /**
   * 清除日志
   */
  clearLogs(): void {
    this.logs = [];
  }

  // ============================================
  // 私有方法
  // ============================================

  private logAndReturn(
    sessionId: string,
    toolName: string,
    input: unknown,
    behavior: PermissionBehavior,
    reason: string
  ): { behavior: PermissionBehavior; reason: string } {
    if (this.config.enableLogging) {
      const entry: PermissionLogEntry = {
        timestamp: Date.now(),
        sessionId,
        toolName,
        input,
        decision: behavior,
        reason,
      };
      this.logs.push(entry);

      // 限制日志大小
      if (this.logs.length > this.maxLogEntries) {
        this.logs = this.logs.slice(-this.maxLogEntries);
      }
    }

    return { behavior, reason };
  }
}

// ============================================
// 全局单例
// ============================================

let permissionManagerInstance: PermissionManager | null = null;

/**
 * 获取权限管理器单例
 */
export function getPermissionManager(): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager();
  }
  return permissionManagerInstance;
}

/**
 * 重置权限管理器（用于测试）
 */
export function resetPermissionManager(): void {
  permissionManagerInstance = null;
}
