/**
 * PermissionManager 权限系统测试
 *
 * 测试权限策略的核心功能：
 * - 默认行为决策
 * - 危险工具强制确认
 * - 自动批准条件
 * - 工具覆盖配置
 * - 日志记录
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PermissionManager,
  resetPermissionManager,
  BUILTIN_TOOL_POLICIES,
} from "../permission-manager.js";

// ============================================
// 测试初始化
// ============================================

describe("PermissionManager", () => {
  let manager: PermissionManager;

  beforeEach(() => {
    resetPermissionManager();
    manager = new PermissionManager();
  });

  afterEach(() => {
    resetPermissionManager();
  });

  // ============================================
  // 基础功能测试
  // ============================================

  describe("基础功能", () => {
    it("should initialize with default config", () => {
      const config = manager.getConfig();
      expect(config.defaultMode).toBe("smart");
      expect(config.forceConfirmDangerous).toBe(true);
      expect(config.enableLogging).toBe(true);
    });

    it("should have built-in policies registered", () => {
      const bashPolicy = manager.getToolPolicy("Bash");
      expect(bashPolicy).toBeDefined();
      expect(bashPolicy?.riskLevel).toBe("dangerous");

      const readPolicy = manager.getToolPolicy("Read");
      expect(readPolicy).toBeDefined();
      expect(readPolicy?.riskLevel).toBe("safe");
    });

    it("should return dangerous tools list", () => {
      const dangerousTools = manager.getDangerousTools();
      expect(dangerousTools).toContain("Bash");
      expect(dangerousTools).toContain("Write");
    });
  });

  // ============================================
  // 权限决策测试
  // ============================================

  describe("shouldRequestPermission", () => {
    const sessionId = "test-session-id";

    it("should ask user for dangerous tools by default", () => {
      const result = manager.shouldRequestPermission("Bash", { command: "rm -rf /" }, sessionId);
      expect(result.behavior).toBe("ask-user");
      expect(result.reason).toContain("dangerous");
    });

    it("should allow safe tools by default", () => {
      const result = manager.shouldRequestPermission("Read", { file_path: "/test/file.txt" }, sessionId);
      expect(result.behavior).toBe("allow");
    });

    it("should ask user for AskUserQuestion tool", () => {
      const result = manager.shouldRequestPermission("AskUserQuestion", { questions: [] }, sessionId);
      expect(result.behavior).toBe("ask-user");
    });

    it("should auto-approve read-only bash commands", () => {
      const result = manager.shouldRequestPermission("Bash", { command: "ls -la" }, sessionId);
      expect(result.behavior).toBe("allow");
      expect(result.reason).toContain("auto-approve");
    });

    it("should ask user for write bash commands", () => {
      const result = manager.shouldRequestPermission("Bash", { command: "rm -rf node_modules" }, sessionId);
      expect(result.behavior).toBe("ask-user");
    });

    it("should ask user for unknown tools in smart mode", () => {
      const result = manager.shouldRequestPermission("UnknownTool", {}, sessionId);
      expect(result.behavior).toBe("ask-user");
      expect(result.reason).toContain("unknown");
    });
  });

  // ============================================
  // 配置覆盖测试
  // ============================================

  describe("配置覆盖", () => {
    const sessionId = "test-session-id";

    it("should respect tool override config", () => {
      manager.updateConfig({
        toolOverrides: {
          Read: "ask-user",
        },
      });

      const result = manager.shouldRequestPermission("Read", { file_path: "/test" }, sessionId);
      expect(result.behavior).toBe("ask-user");
      expect(result.reason).toContain("override");
    });

    it("should auto-approve all in auto-approve mode", () => {
      manager.updateConfig({
        defaultMode: "auto-approve",
        forceConfirmDangerous: false,
      });

      const result = manager.shouldRequestPermission("Bash", { command: "rm -rf" }, sessionId);
      expect(result.behavior).toBe("allow");
    });

    it("should ask user for all in ask-user mode", () => {
      manager.updateConfig({
        defaultMode: "ask-user",
        forceConfirmDangerous: false,
      });

      const result = manager.shouldRequestPermission("Read", { file_path: "/test" }, sessionId);
      expect(result.behavior).toBe("ask-user");
    });
  });

  // ============================================
  // 日志记录测试
  // ============================================

  describe("日志记录", () => {
    const sessionId = "test-session-id";

    it("should log permission decisions", () => {
      manager.shouldRequestPermission("Bash", { command: "ls" }, sessionId);
      manager.shouldRequestPermission("Read", { file_path: "/test" }, sessionId);

      const logs = manager.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it("should filter logs by session", () => {
      manager.shouldRequestPermission("Bash", {}, "session-1");
      manager.shouldRequestPermission("Read", {}, "session-2");

      const logs1 = manager.getLogs("session-1");
      const logs2 = manager.getLogs("session-2");

      expect(logs1.every((l) => l.sessionId === "session-1")).toBe(true);
      expect(logs2.every((l) => l.sessionId === "session-2")).toBe(true);
    });

    it("should clear logs", () => {
      manager.shouldRequestPermission("Bash", {}, sessionId);
      manager.shouldRequestPermission("Read", {}, sessionId);

      manager.clearLogs();
      expect(manager.getLogs().length).toBe(0);
    });

    it("should not log when logging disabled", () => {
      manager.updateConfig({ enableLogging: false });

      manager.shouldRequestPermission("Bash", {}, sessionId);
      manager.shouldRequestPermission("Read", {}, sessionId);

      expect(manager.getLogs().length).toBe(0);
    });
  });

  // ============================================
  // 风险等级测试
  // ============================================

  describe("风险等级", () => {
    it("should return correct risk levels", () => {
      expect(manager.getToolRiskLevel("Bash")).toBe("dangerous");
      expect(manager.getToolRiskLevel("Write")).toBe("dangerous");
      expect(manager.getToolRiskLevel("Edit")).toBe("moderate");
      expect(manager.getToolRiskLevel("Read")).toBe("safe");
      expect(manager.getToolRiskLevel("Glob")).toBe("safe");
    });

    it("should return moderate for unknown tools", () => {
      expect(manager.getToolRiskLevel("UnknownTool")).toBe("moderate");
    });
  });

  // ============================================
  // 自定义策略测试
  // ============================================

  describe("自定义策略", () => {
    it("should register custom policy", () => {
      manager.registerPolicy({
        toolName: "CustomTool",
        defaultBehavior: "deny",
        riskLevel: "dangerous",
        description: "Custom dangerous tool",
      });

      const policy = manager.getToolPolicy("CustomTool");
      expect(policy).toBeDefined();
      expect(policy?.defaultBehavior).toBe("deny");
    });

    it("should use custom policy in decision", () => {
      manager.registerPolicy({
        toolName: "CustomTool",
        defaultBehavior: "deny",
        riskLevel: "dangerous",
        description: "Custom tool",
      });

      const result = manager.shouldRequestPermission("CustomTool", {}, "session-1");
      expect(result.behavior).toBe("ask-user"); // dangerous tools force ask-user
    });
  });

  // ============================================
  // 高级自动批准条件测试
  // ============================================

  describe("自动批准条件", () => {
    it("should auto-approve specific git commands", () => {
      const result = manager.shouldRequestPermission("Bash", { command: "git status" }, "s1");
      expect(result.behavior).toBe("allow");

      const result2 = manager.shouldRequestPermission("Bash", { command: "git log --oneline" }, "s1");
      expect(result2.behavior).toBe("allow");
    });

    it("should not auto-approve write git commands", () => {
      const result = manager.shouldRequestPermission("Bash", { command: "git push" }, "s1");
      expect(result.behavior).toBe("ask-user");

      const result2 = manager.shouldRequestPermission("Bash", { command: "git commit -m test" }, "s1");
      expect(result2.behavior).toBe("ask-user");
    });
  });
});

// ============================================
// 内置策略验证测试
// ============================================

describe("BUILTIN_TOOL_POLICIES", () => {
  it("should have all expected policies", () => {
    const toolNames = BUILTIN_TOOL_POLICIES.map((p) => p.toolName);
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Write");
    expect(toolNames).toContain("Edit");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Glob");
    expect(toolNames).toContain("Grep");
    expect(toolNames).toContain("AskUserQuestion");
  });

  it("should have consistent risk levels", () => {
    for (const policy of BUILTIN_TOOL_POLICIES) {
      expect(["safe", "moderate", "dangerous"]).toContain(policy.riskLevel);
    }
  });
});
