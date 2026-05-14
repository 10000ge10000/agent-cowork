import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ServerEvent } from "../../types.js";
import type { Session } from "../session-store.js";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getCurrentApiConfig: vi.fn(),
  buildEnvForConfig: vi.fn(),
  getClaudeCodePath: vi.fn(),
  getEnhancedEnv: vi.fn(),
  shouldRequestPermission: vi.fn(),
  isProxyRunningForConfig: vi.fn(),
  startProxy: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mocks.query,
}));

vi.mock("../claude-settings.js", () => ({
  getCurrentApiConfig: mocks.getCurrentApiConfig,
  buildEnvForConfig: mocks.buildEnvForConfig,
  getClaudeCodePath: mocks.getClaudeCodePath,
}));

vi.mock("../util.js", () => ({
  getEnhancedEnv: mocks.getEnhancedEnv,
}));

vi.mock("../permission-manager.js", () => ({
  getPermissionManager: () => ({
    shouldRequestPermission: mocks.shouldRequestPermission,
  }),
}));

vi.mock("../anthropic-proxy.js", () => ({
  DEFAULT_PROXY_PORT: 18765,
  isProxyRunningForConfig: mocks.isProxyRunningForConfig,
  startProxy: mocks.startProxy,
}));

async function* createSuccessfulSdkStream() {
  yield {
    type: "system",
    subtype: "init",
    session_id: "sdk-session-id",
  };
  yield {
    type: "result",
    subtype: "success",
  };
}

function createSession(cwd: string, allowedTools?: string): Session {
  return {
    id: "session-id",
    title: "读写能力测试",
    status: "running",
    cwd,
    allowedTools,
    pendingPermissions: new Map(),
    store: {
      persistPendingPermission: vi.fn(),
      removePendingPermission: vi.fn(),
    },
  } as unknown as Session;
}

describe("runClaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.query.mockReturnValue(createSuccessfulSdkStream());
    mocks.getCurrentApiConfig.mockReturnValue({
      apiType: "nvidia",
      apiKey: "test-key",
      baseURL: "https://integrate.api.nvidia.com/v1",
      model: "minimaxai/minimax-m2.7",
    });
    mocks.buildEnvForConfig.mockReturnValue({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:18765",
    });
    mocks.getClaudeCodePath.mockReturnValue("claude-code");
    mocks.getEnhancedEnv.mockReturnValue({ PATH: "test-path" });
    mocks.isProxyRunningForConfig.mockReturnValue(true);
    mocks.shouldRequestPermission.mockReturnValue({
      behavior: "allow",
      reason: "test default",
    });
  });

  it("should grant Claude SDK read/write tools inside the selected project directory", async () => {
    const projectDir = join(tmpdir(), "agent-cowork-runner-rw-contract");
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    const { runClaude } = await import("../runner.js");
    const events: ServerEvent[] = [];
    const session = createSession(projectDir);

    await runClaude({
      prompt: "请在当前项目目录创建并读取一个测试文件",
      session,
      onEvent: (event) => events.push(event),
      onSessionUpdate: (updates) => Object.assign(session, updates),
    });

    await vi.waitFor(() => {
      expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    const queryOptions = mocks.query.mock.calls[0]?.[0]?.options;
    expect(queryOptions).toMatchObject({
      cwd: projectDir,
      additionalDirectories: [projectDir],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      model: "minimaxai/minimax-m2.7",
    });
    expect(queryOptions.env.TEMP).toBe(join(tmpdir(), "agent-cowork-claude-runtime"));
    expect(queryOptions.env.TMP).toBe(join(tmpdir(), "agent-cowork-claude-runtime"));
    expect(queryOptions.env.TMPDIR).toBe(join(tmpdir(), "agent-cowork-claude-runtime"));

    expect(queryOptions.allowedTools).toEqual([
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "Glob",
      "Grep",
      "LS",
      "Bash",
    ]);

    const writeDecision = await queryOptions.canUseTool(
      "Write",
      { file_path: join(projectDir, "agent-rw-smoke.txt"), content: "ok" },
      { signal: new AbortController().signal }
    ) as PermissionResult;
    expect(writeDecision).toMatchObject({ behavior: "allow" });
    expect(mocks.shouldRequestPermission).toHaveBeenCalledWith(
      "Write",
      { file_path: join(projectDir, "agent-rw-smoke.txt"), content: "ok" },
      session.id
    );

    const editDecision = await queryOptions.canUseTool(
      "Edit",
      { file_path: join(projectDir, "agent-rw-smoke.txt"), old_string: "ok", new_string: "ok\nappend-ok" },
      { signal: new AbortController().signal }
    ) as PermissionResult;
    expect(editDecision).toMatchObject({ behavior: "allow" });
    expect(mocks.shouldRequestPermission).toHaveBeenCalledWith(
      "Edit",
      { file_path: join(projectDir, "agent-rw-smoke.txt"), old_string: "ok", new_string: "ok\nappend-ok" },
      session.id
    );

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "session.status")).toBe(true);
    });
  });

  it("should not directly allow dangerous tools from allowedTools in smart mode", async () => {
    const projectDir = join(tmpdir(), "agent-cowork-runner-permission-contract");
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    mocks.shouldRequestPermission.mockReturnValue({
      behavior: "ask-user",
      reason: "dangerous tool requires confirmation",
    });

    const { runClaude } = await import("../runner.js");
    const events: ServerEvent[] = [];
    const session = createSession(projectDir);

    await runClaude({
      prompt: "请修改文件",
      session,
      onEvent: (event) => events.push(event),
      onSessionUpdate: (updates) => Object.assign(session, updates),
    });

    await vi.waitFor(() => {
      expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    const queryOptions = mocks.query.mock.calls[0]?.[0]?.options;

    for (const toolName of ["Bash", "Write", "Edit"]) {
      const controller = new AbortController();
      const decisionPromise = queryOptions.canUseTool(
        toolName,
        toolName === "Bash" ? { command: "rm -rf node_modules" } : { file_path: join(projectDir, "x.txt") },
        { signal: controller.signal }
      ) as Promise<PermissionResult>;

      await vi.waitFor(() => {
        expect(events.some((event) => event.type === "permission.request" && event.payload.toolName === toolName)).toBe(true);
      });
      controller.abort();

      await expect(decisionPromise).resolves.toMatchObject({ behavior: "deny" });
    }
  });
});
