import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockElectron = vi.hoisted(() => ({
  userDataPath: `${process.env.TEMP || process.env.TMP || "."}\\agent-cowork-config-store-test`,
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mockElectron.userDataPath),
  },
}));

describe("config-store permission config", () => {
  beforeEach(() => {
    mockElectron.userDataPath = join(tmpdir(), `agent-cowork-config-store-test-${Date.now()}`);
    if (existsSync(mockElectron.userDataPath)) {
      rmSync(mockElectron.userDataPath, { recursive: true, force: true });
    }
    mkdirSync(mockElectron.userDataPath, { recursive: true });
  });

  it("should persist and reload permission config from main-process storage", async () => {
    const { loadPermissionConfig, savePermissionConfig } = await import("../config-store.js");

    savePermissionConfig({
      defaultMode: "ask-user",
      toolOverrides: {
        Read: "ask-user",
        Bash: "deny",
      },
      forceConfirmDangerous: false,
      enableLogging: false,
    });

    expect(loadPermissionConfig()).toEqual({
      defaultMode: "ask-user",
      toolOverrides: {
        Read: "ask-user",
        Bash: "deny",
      },
      forceConfirmDangerous: false,
      enableLogging: false,
    });
  });
});
