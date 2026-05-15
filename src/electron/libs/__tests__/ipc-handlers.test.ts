import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn(() => "C:\\agent-cowork-test"),
  },
}));

vi.mock("../runner.js", () => ({
  runClaude: vi.fn(),
}));

vi.mock("../session-store.js", () => ({
  SessionStore: class MockSessionStore {},
}));

import { resolveResumeSessionIdForContinue } from "../../ipc-handlers.js";

describe("resolveResumeSessionIdForContinue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should reuse the existing Claude SDK session id when it is available", async () => {
    await expect(
      resolveResumeSessionIdForContinue(
        { id: "local-session-id", status: "completed", claudeSessionId: "sdk-session-id" },
        vi.fn()
      )
    ).resolves.toBe("sdk-session-id");
  });

  it("should start a fresh SDK run for historical sessions without a Claude SDK session id", async () => {
    const getLatestSession = vi.fn();

    await expect(
      resolveResumeSessionIdForContinue(
        { id: "local-session-id", status: "completed" },
        getLatestSession
      )
    ).resolves.toBeUndefined();

    expect(getLatestSession).not.toHaveBeenCalled();
  });

  it("should wait for a running session to publish its Claude SDK session id", async () => {
    vi.useFakeTimers();
    const getLatestSession = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ claudeSessionId: "late-sdk-session-id" });

    const resumeSessionId = resolveResumeSessionIdForContinue(
      { id: "local-session-id", status: "running" },
      getLatestSession,
      500
    );

    await vi.advanceTimersByTimeAsync(100);

    await expect(resumeSessionId).resolves.toBe("late-sdk-session-id");
  });
});
