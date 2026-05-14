import { BrowserWindow } from "electron";
import type { ClientEvent, ServerEvent } from "./types.js";
import { runClaude, type RunnerHandle } from "./libs/runner.js";
import { SessionStore } from "./libs/session-store.js";
import { app } from "electron";
import { join } from "path";

let sessions: SessionStore;
const runnerHandles = new Map<string, RunnerHandle>();

/**
 * 获取会话存储路径
 * Portable 模式下使用 exe 同级目录
 */
function getSessionDbPath(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    console.warn("[ipc-handlers] Portable mode, session DB dir:", portableDir);
    return join(portableDir, "sessions.db");
  }
  const userDataPath = app.getPath("userData");
  return join(userDataPath, "sessions.db");
}

function initializeSessions() {
  if (!sessions) {
    try {
      const DB_PATH = getSessionDbPath();
      console.warn("[ipc-handlers] DB path:", DB_PATH);
      sessions = new SessionStore(DB_PATH);
    } catch (error) {
      console.error("[ipc-handlers] Failed to initialize sessions:", error);
      throw error;
    }
  }
  return sessions;
}

function broadcast(event: ServerEvent) {
  const payload = JSON.stringify(event);
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("server-event", payload);
  }
}

function hasLiveSession(sessionId: string): boolean {
  if (!sessions) return false;
  return Boolean(sessions.getSession(sessionId));
}

function emit(event: ServerEvent) {
  // If a session was deleted, drop late events that would resurrect it in the UI.
  // (Session history lookups are DB-backed, so these late events commonly lead to "Unknown session".)
  if (
    (event.type === "session.status" ||
      event.type === "stream.message" ||
      event.type === "stream.user_prompt" ||
      event.type === "permission.request") &&
    !hasLiveSession(event.payload.sessionId)
  ) {
    return;
  }

  if (event.type === "session.status") {
    sessions.updateSession(event.payload.sessionId, { status: event.payload.status });
  }
  if (event.type === "stream.message") {
    sessions.recordMessage(event.payload.sessionId, event.payload.message);
  }
  if (event.type === "stream.user_prompt") {
    sessions.recordMessage(event.payload.sessionId, {
      type: "user_prompt",
      prompt: event.payload.prompt
    });
  }
  broadcast(event);
}

export function handleClientEvent(event: ClientEvent) {
  console.warn("[IPC Handlers] handleClientEvent called:", event.type);
  // Initialize sessions on first event
  const sessions = initializeSessions();
  console.warn("[IPC Handlers] Sessions initialized, ID:", sessions ? "ok" : "null");

  if (event.type === "session.list") {
    emit({
      type: "session.list",
      payload: { sessions: sessions.listSessions() }
    });
    return;
  }

  if (event.type === "session.history") {
    const history = sessions.getSessionHistory(event.payload.sessionId);
    if (!history) {
      // Session may have been deleted (or deleted concurrently). Treat as a sync event rather than an error toast.
      emit({ type: "session.deleted", payload: { sessionId: event.payload.sessionId } });
      return;
    }
    emit({
      type: "session.history",
      payload: {
        sessionId: history.session.id,
        status: history.session.status,
        messages: history.messages
      }
    });
    return;
  }

  if (event.type === "session.start") {
    console.warn("[IPC Handlers] Processing session.start event");
    console.warn("[IPC Handlers] Event payload:", JSON.stringify({
      title: event.payload.title,
      hasPrompt: !!event.payload.prompt,
      cwd: event.payload.cwd,
      allowedTools: event.payload.allowedTools
    }));

    try {
      const session = sessions.createSession({
        cwd: event.payload.cwd,
        title: event.payload.title,
        allowedTools: event.payload.allowedTools,
        prompt: event.payload.prompt
      });

      console.warn("[IPC Handlers] Session created:", session.id);

      sessions.updateSession(session.id, {
        status: "running",
        lastPrompt: event.payload.prompt
      });

      console.warn("[IPC Handlers] Emitting session.status: running");
      emit({
        type: "session.status",
        payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
      });

      console.warn("[IPC Handlers] Emitting stream.user_prompt");
      emit({
        type: "stream.user_prompt",
        payload: { sessionId: session.id, prompt: event.payload.prompt }
      });

      console.warn("[IPC Handlers] Starting runClaude...");
      runClaude({
        prompt: event.payload.prompt,
        session,
        resumeSessionId: session.claudeSessionId,
        onEvent: emit,
        onSessionUpdate: (updates) => {
          sessions.updateSession(session.id, updates);
        }
      })
        .then((handle) => {
          console.warn("[IPC Handlers] runClaude started successfully");
          runnerHandles.set(session.id, handle);
          sessions.setAbortController(session.id, undefined);
        })
        .catch((error) => {
          console.error("[IPC Handlers] runClaude failed:", error);
          sessions.updateSession(session.id, { status: "error" });
          emit({
            type: "session.status",
            payload: {
              sessionId: session.id,
              status: "error",
              title: session.title,
              cwd: session.cwd,
              error: String(error)
            }
          });
        });
    } catch (error) {
      console.error("[IPC Handlers] Failed to create session:", error);
      // 发送错误事件给前端
      emit({
        type: "runner.error",
        payload: { sessionId: "unknown", message: `创建会话失败: ${String(error)}` }
      });
    }

    return;
  }

  if (event.type === "session.continue") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) {
      emit({ type: "session.deleted", payload: { sessionId: event.payload.sessionId } });
      emit({
        type: "runner.error",
        payload: { sessionId: event.payload.sessionId, message: "Session no longer exists." }
      });
      return;
    }

    // 等待 claudeSessionId 的异步函数
    const waitForClaudeSessionId = async (maxWaitMs: number): Promise<string | null> => {
      if (session.claudeSessionId) return session.claudeSessionId;

      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        // 检查是否有更新
        const updatedSession = sessions.getSession(event.payload.sessionId);
        if (updatedSession?.claudeSessionId) {
          return updatedSession.claudeSessionId;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };

    // 射手函数处理恢复逻辑
    const continueSession = async () => {
      // 等待最多 5 秒获取 claudeSessionId
      const claudeSessionId = await waitForClaudeSessionId(5000);

      if (!claudeSessionId) {
        emit({
          type: "runner.error",
          payload: {
            sessionId: session.id,
            message: "Session is not ready for resume. Please wait for the initial response or start a new session."
          }
        });
        return;
      }

      sessions.updateSession(session.id, { status: "running", lastPrompt: event.payload.prompt });
      emit({
        type: "session.status",
        payload: { sessionId: session.id, status: "running", title: session.title, cwd: session.cwd }
      });

      emit({
        type: "stream.user_prompt",
        payload: { sessionId: session.id, prompt: event.payload.prompt }
      });

      runClaude({
        prompt: event.payload.prompt,
        session,
        resumeSessionId: claudeSessionId,
        onEvent: emit,
        onSessionUpdate: (updates) => {
          sessions.updateSession(session.id, updates);
        }
      })
        .then((handle) => {
          runnerHandles.set(session.id, handle);
        })
        .catch((error) => {
          sessions.updateSession(session.id, { status: "error" });
          emit({
            type: "session.status",
            payload: {
              sessionId: session.id,
              status: "error",
              title: session.title,
              cwd: session.cwd,
              error: String(error)
            }
          });
        });
    };

    continueSession();
    return;
  }

  if (event.type === "session.stop") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) return;

    const handle = runnerHandles.get(session.id);
    if (handle) {
      handle.abort();
      runnerHandles.delete(session.id);
    }

    sessions.updateSession(session.id, { status: "idle" });
    emit({
      type: "session.status",
      payload: { sessionId: session.id, status: "idle", title: session.title, cwd: session.cwd }
    });
    return;
  }

  if (event.type === "session.delete") {
    const sessionId = event.payload.sessionId;
    const handle = runnerHandles.get(sessionId);
    if (handle) {
      handle.abort();
      runnerHandles.delete(sessionId);
    }

    // Always try to delete and emit deleted event
    // Don't emit error if session doesn't exist - it may have already been deleted
    sessions.deleteSession(sessionId);
    emit({
      type: "session.deleted",
      payload: { sessionId }
    });
    return;
  }

  if (event.type === "permission.response") {
    const session = sessions.getSession(event.payload.sessionId);
    if (!session) return;

    const pending = session.pendingPermissions.get(event.payload.toolUseId);
    if (pending) {
      pending.resolve(event.payload.result);
    }
    return;
  }
}

export function cleanupAllSessions(): void {
  for (const [, handle] of runnerHandles) {
    handle.abort();
  }
  runnerHandles.clear();
  if (sessions) {
    sessions.close();
  }
}

export { sessions };
