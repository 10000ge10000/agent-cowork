import { closeSync, mkdtempSync, openSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testUserDataDir = mkdtempSync(join(tmpdir(), "agent-cowork-claude-settings-"));

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(() => testUserDataDir),
    getAppPath: vi.fn(() => testUserDataDir),
  },
}));

describe("buildEnvForConfig", () => {
  const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

  beforeEach(() => {
    delete process.env.ELECTRON_RUN_AS_NODE;
  });

  afterEach(() => {
    if (originalElectronRunAsNode === undefined) {
      delete process.env.ELECTRON_RUN_AS_NODE;
    } else {
      process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
    }
  });

  afterEach(() => {
    rmSync(join(testUserDataDir, "claude-sdk-config"), { recursive: true, force: true });
  });

  it("should force Electron child processes spawned by Claude SDK to run as Node", async () => {
    const { buildEnvForConfig } = await import("../claude-settings.js");

    const env = buildEnvForConfig({
      apiType: "nvidia",
      apiKey: "test-key",
      baseURL: "https://integrate.api.nvidia.com/v1",
      model: "minimaxai/minimax-m2.7",
    });

    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(testUserDataDir, "claude-sdk-config"));
  });

  it("should normalize unsupported NVIDIA models before Agent runtime uses them", async () => {
    const { normalizeApiConfigForAgent } = await import("../claude-settings.js");

    const config = normalizeApiConfigForAgent({
      apiType: "nvidia",
      apiKey: "test-key",
      baseURL: "https://integrate.api.nvidia.com/v1",
      model: "qwen/qwen3-next-80b-a3b-instruct",
    });

    expect(config.model).toBe("minimaxai/minimax-m2.7");
  });

  it("should pass Git Bash path to Claude Code when Windows can resolve it", async () => {
    const gitDir = mkdtempSync(join(tmpdir(), "agent-cowork-git-bash-"));
    const bashPath = join(gitDir, "bash.exe");
    closeSync(openSync(bashPath, "w"));
    const originalGitBashPath = process.env.CLAUDE_CODE_GIT_BASH_PATH;
    process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath;

    try {
      const { buildEnvForConfig } = await import("../claude-settings.js");

      const env = buildEnvForConfig({
        apiType: "nvidia",
        apiKey: "test-key",
        baseURL: "https://integrate.api.nvidia.com/v1",
        model: "minimaxai/minimax-m2.7",
      });

      if (process.platform === "win32") {
        expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe(bashPath);
      } else {
        expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBeUndefined();
      }
    } finally {
      if (originalGitBashPath === undefined) {
        delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
      } else {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = originalGitBashPath;
      }
      rmSync(gitDir, { recursive: true, force: true });
    }
  });
});
