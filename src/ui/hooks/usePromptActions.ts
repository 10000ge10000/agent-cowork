import { useCallback } from "react";
import type { ClientEvent } from "../types";
import { useAppStore } from "../store/useAppStore";

const DEFAULT_ALLOWED_TOOLS = "Read,Write,Edit,MultiEdit,Glob,Grep,LS,Bash";

export function usePromptActions(sendEvent: (event: ClientEvent) => void) {
  const prompt = useAppStore((state) => state.prompt);
  const cwd = useAppStore((state) => state.cwd);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const setPrompt = useAppStore((state) => state.setPrompt);
  const setPendingStart = useAppStore((state) => state.setPendingStart);
  const setGlobalError = useAppStore((state) => state.setGlobalError);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const isRunning = activeSession?.status === "running";

  const handleSend = useCallback(async () => {
    console.warn("[DEBUG] handleSend called, prompt:", `${prompt.substring(0, 50)}...`);
    if (!prompt.trim()) return;

    if (!activeSessionId) {
      setPendingStart(true);
      // 新会话标题必须本地生成，避免每次正式会话前额外消耗一次慢速模型请求。
      const trimmedPrompt = prompt.trim();
      const title = trimmedPrompt.slice(0, 20) + (trimmedPrompt.length > 20 ? "..." : "");
      console.warn("[DEBUG] Sending session.start event:", { title, prompt: `${prompt.substring(0, 50)}...`, cwd });
      sendEvent({
        type: "session.start",
        payload: { title, prompt, cwd: cwd.trim() || undefined, allowedTools: DEFAULT_ALLOWED_TOOLS }
      });
      // 兜底：如果 15 秒内没有收到 session.status 事件，重置 pendingStart。
      setTimeout(() => {
        setPendingStart(false);
      }, 15000);
    } else {
      if (activeSession?.status === "running") {
        setGlobalError("会话正在运行中，请等待完成。");
        return;
      }
      try {
        setPendingStart(true);
        sendEvent({ type: "session.continue", payload: { sessionId: activeSessionId, prompt } });
        // 注意：pendingStart 会在收到 session.status 事件后重置。
        setTimeout(() => {
          setPendingStart(false);
        }, 10000);
      } catch (_error) {
        setPendingStart(false);
        setGlobalError("发送消息失败，请重试。");
      }
    }
    setPrompt("");
  }, [activeSession, activeSessionId, cwd, prompt, sendEvent, setGlobalError, setPendingStart, setPrompt]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    sendEvent({ type: "session.stop", payload: { sessionId: activeSessionId } });
  }, [activeSessionId, sendEvent]);

  const handleStartFromModal = useCallback(() => {
    console.warn("[DEBUG] handleStartFromModal called, cwd:", cwd);
    if (!cwd.trim()) {
      console.warn("[DEBUG] cwd is empty, showing error");
      setGlobalError("工作目录为必填项。");
      return;
    }
    console.warn("[DEBUG] cwd is valid, calling handleSend");
    handleSend();
  }, [cwd, handleSend, setGlobalError]);

  return { prompt, setPrompt, isRunning, handleSend, handleStop, handleStartFromModal };
}
