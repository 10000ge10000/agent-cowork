/**
 * Claude-Cowork 主应用组件
 *
 * 精简后的主组件，使用提取的 hooks 和组件：
 * - useAutoScroll: 自动滚动管理
 * - usePartialMessage: 部分消息处理
 * - MessageList: 消息列表组件
 * - PermissionHandler: 权限处理组件
 * - GlobalErrorHandler: 错误处理组件
 */
import { useCallback, useEffect } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ServerEvent } from "../shared/types";
import { useIPC } from "./hooks/useIPC";
import { useMessageWindow } from "./hooks/useMessageWindow";
import { useAppStore } from "./store/useAppStore";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { usePartialMessage } from "./hooks/usePartialMessage";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModal } from "./components/StartSessionModal";
import { SettingsModal } from "./components/SettingsModal";
import { PromptInput } from "./components/PromptInput";
import { usePromptActions } from "./hooks/usePromptActions";
import { MessageList } from "./components/MessageList";
import { PermissionHandler } from "./components/PermissionHandler";
import { GlobalErrorHandler } from "./components/GlobalErrorHandler";

function App() {
  // Store state
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showStartModal = useAppStore((s) => s.showStartModal);
  const setShowStartModal = useAppStore((s) => s.setShowStartModal);
  const showSettingsModal = useAppStore((s) => s.showSettingsModal);
  const setShowSettingsModal = useAppStore((s) => s.setShowSettingsModal);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const historyRequested = useAppStore((s) => s.historyRequested);
  const markHistoryRequested = useAppStore((s) => s.markHistoryRequested);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const cwd = useAppStore((s) => s.cwd);
  const setCwd = useAppStore((s) => s.setCwd);
  const pendingStart = useAppStore((s) => s.pendingStart);
  const apiConfigChecked = useAppStore((s) => s.apiConfigChecked);
  const setApiConfigChecked = useAppStore((s) => s.setApiConfigChecked);

  // Hooks
  const { partialMessage, showPartialMessage, handlePartialEvent } = usePartialMessage();
  const {
    scrollContainerRef,
    messagesEndRef,
    shouldAutoScroll,
    hasNewMessages,
    handleScroll,
    scrollToBottom,
    enableAutoScroll,
    checkForNewMessages,
    prepareForHistoryLoad,
    restoreScrollAfterLoad,
  } = useAutoScroll({ resetDeps: [activeSessionId] });

  // 合成事件处理器
  const onEvent = useCallback(
    (event: ServerEvent) => {
      handleServerEvent(event);
      handlePartialEvent(event, () => {
        if (shouldAutoScroll) {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
    },
    [handleServerEvent, handlePartialEvent, shouldAutoScroll, messagesEndRef]
  );

  const { connected, sendEvent } = useIPC(onEvent);
  const { handleStartFromModal } = usePromptActions(sendEvent);

  // 当前活跃会话
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSession?.messages ?? [];
  const permissionRequests = activeSession?.permissionRequests ?? [];
  const isRunning = activeSession?.status === "running";

  const {
    visibleMessages,
    hasMoreHistory,
    isLoadingHistory,
    loadMoreMessages,
    resetToLatest,
    totalMessages,
  } = useMessageWindow(messages, permissionRequests, activeSessionId);

  // 启动时检查 API 配置
  useEffect(() => {
    if (!apiConfigChecked) {
      window.electron
        .checkApiConfig()
        .then((result) => {
          setApiConfigChecked(true);
          if (!result.hasConfig) {
            setShowSettingsModal(true);
          }
        })
        .catch((err) => {
          console.error("Failed to check API config:", err);
          setApiConfigChecked(true);
        });
    }
  }, [apiConfigChecked, setApiConfigChecked, setShowSettingsModal]);

  // 连接成功后获取会话列表
  useEffect(() => {
    console.warn("[App] connected changed:", connected);
    if (connected) {
      console.warn("[App] Sending session.list event");
      sendEvent({ type: "session.list" });
    }
  }, [connected, sendEvent]);

  // 会话切换时加载历史
  useEffect(() => {
    if (!activeSessionId || !connected) return;
    const session = sessions[activeSessionId];
    if (session && !session.hydrated && !historyRequested.has(activeSessionId)) {
      markHistoryRequested(activeSessionId);
      sendEvent({ type: "session.history", payload: { sessionId: activeSessionId } });
    }
  }, [activeSessionId, connected, sessions, historyRequested, markHistoryRequested, sendEvent]);

  // 监听新消息
  useEffect(() => {
    checkForNewMessages(messages.length);
  }, [messages.length, checkForNewMessages]);

  // 恢复滚动位置（历史加载后）
  useEffect(() => {
    restoreScrollAfterLoad();
  }, [visibleMessages, isLoadingHistory, restoreScrollAfterLoad]);

  // 处理函数
  const handleNewSession = useCallback(() => {
    console.warn("[App] handleNewSession called");
    useAppStore.getState().setActiveSessionId(null);
    setShowStartModal(true);
    console.warn("[App] showStartModal set to true");
  }, [setShowStartModal]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      sendEvent({ type: "session.delete", payload: { sessionId } });
    },
    [sendEvent]
  );

  const handlePermissionResult = useCallback(
    (toolUseId: string, result: PermissionResult) => {
      if (!activeSessionId) return;
      sendEvent({ type: "permission.response", payload: { sessionId: activeSessionId, toolUseId, result } });
      resolvePermissionRequest(activeSessionId, toolUseId);
    },
    [activeSessionId, sendEvent, resolvePermissionRequest]
  );

  const handleSendMessage = useCallback(() => {
    enableAutoScroll();
    resetToLatest();
  }, [enableAutoScroll, resetToLatest]);

  const handleLoadMore = useCallback(() => {
    prepareForHistoryLoad();
    loadMoreMessages();
  }, [prepareForHistoryLoad, loadMoreMessages]);

  // 继续中断的会话
  const handleContinueSession = useCallback(
    (sessionId: string) => {
      // 设置活跃会话并打开输入弹窗
      useAppStore.getState().setActiveSessionId(sessionId);
    },
    []
  );

  return (
    <div className="flex h-screen bg-surface">
      <Sidebar
        connected={connected}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onContinueSession={handleContinueSession}
      />

      <main className="flex flex-1 flex-col ml-[280px] bg-surface-cream">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-center h-12 border-b border-ink-900/10 bg-surface-cream select-none"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <span className="text-sm font-medium text-ink-700">{activeSession?.title || "Agent Cowork"}</span>
        </div>

        {/* 消息列表 */}
        <MessageList
          messages={visibleMessages}
          permissionRequests={permissionRequests}
          isRunning={isRunning}
          hasMoreHistory={hasMoreHistory}
          isLoadingHistory={isLoadingHistory}
          totalMessages={totalMessages}
          partialMessage={partialMessage}
          showPartialMessage={showPartialMessage}
          shouldAutoScroll={shouldAutoScroll}
          hasNewMessages={hasNewMessages}
          onLoadMore={handleLoadMore}
          onScroll={handleScroll}
          scrollToBottom={scrollToBottom}
          onPermissionResult={handlePermissionResult}
          scrollContainerRef={scrollContainerRef}
          messagesEndRef={messagesEndRef}
          activeSessionId={activeSessionId}
        />

        {/* 输入框 */}
        <PromptInput sendEvent={sendEvent} onSendMessage={handleSendMessage} disabled={visibleMessages.length === 0} />

        {/* 权限处理 */}
        <PermissionHandler
          permissionRequests={permissionRequests}
          sessionId={activeSessionId}
          onPermissionResult={handlePermissionResult}
        />
      </main>

      {/* 开始会话弹窗 */}
      {showStartModal && (
        <StartSessionModal
          cwd={cwd}
          prompt={prompt}
          pendingStart={pendingStart}
          onCwdChange={setCwd}
          onPromptChange={setPrompt}
          onStart={handleStartFromModal}
          onClose={() => setShowStartModal(false)}
        />
      )}

      {/* 设置弹窗 */}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}

      {/* 全局错误处理 */}
      <GlobalErrorHandler error={globalError} onDismiss={() => setGlobalError(null)} />
    </div>
  );
}

export default App;
