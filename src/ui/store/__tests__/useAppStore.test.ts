import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../useAppStore";

describe("useAppStore task lifecycle", () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: {},
      activeSessionId: null,
      prompt: "",
      cwd: "",
      pendingStart: false,
      globalError: null,
      sessionsLoaded: false,
      showStartModal: false,
      showSettingsModal: false,
      historyRequested: new Set(),
      apiConfigChecked: false,
    });
  });

  it("should add a task from session.status and remove it from session.deleted", () => {
    const { handleServerEvent } = useAppStore.getState();

    handleServerEvent({
      type: "session.status",
      payload: {
        sessionId: "session-1",
        status: "running",
        title: "测试任务",
        cwd: "C:\\work",
      },
    });

    expect(useAppStore.getState().sessions["session-1"]).toMatchObject({
      id: "session-1",
      title: "测试任务",
      status: "running",
      cwd: "C:\\work",
    });

    handleServerEvent({
      type: "session.deleted",
      payload: { sessionId: "session-1" },
    });

    expect(useAppStore.getState().sessions["session-1"]).toBeUndefined();
    expect(useAppStore.getState().showStartModal).toBe(true);
  });
});
