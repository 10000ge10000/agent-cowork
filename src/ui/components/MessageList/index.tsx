/**
 * MessageList 组件
 *
 * 显示消息列表，支持：
 * - 无限滚动加载历史
 * - 新消息提示
 * - 部分消息实时显示
 * - CSS 虚拟化优化（content-visibility: auto）
 */
import { useEffect, useRef, memo } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { StreamMessage } from "../../types";
import type { PermissionRequest } from "../../store/useAppStore";
import { MessageCard } from "../EventCard";
import MDContent from "../../render/markdown";

export type MessageListProps = {
  messages: Array<{ message: StreamMessage; originalIndex: number }>;
  permissionRequests: PermissionRequest[];
  isRunning: boolean;
  hasMoreHistory: boolean;
  isLoadingHistory: boolean;
  totalMessages: number;
  partialMessage: string;
  showPartialMessage: boolean;
  shouldAutoScroll: boolean;
  hasNewMessages: boolean;
  onLoadMore: () => void;
  onScroll: () => void;
  scrollToBottom: () => void;
  onPermissionResult: (toolUseId: string, result: PermissionResult) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  activeSessionId: string | null;
};

/**
 * 消息列表骨架加载动画
 */
function SkeletonLoader() {
  return (
    <div className="mt-3 flex flex-col gap-2 px-1">
      {[2, 12, 12, 12, 4].map((width, idx) => (
        <div
          key={idx}
          className={`relative h-3 w-${width}/12 overflow-hidden rounded-full bg-ink-900/10`}
        >
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
        </div>
      ))}
    </div>
  );
}

/**
 * 新消息提示按钮
 */
function NewMessagesButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-28 left-1/2 ml-[140px] z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg transition-all hover:bg-accent-hover hover:scale-105 animate-bounce-subtle"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
      <span>新消息</span>
    </button>
  );
}

/**
 * 历史加载指示器
 */
function LoadingIndicator() {
  return (
    <div className="flex items-center justify-center py-4 mb-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span>加载中...</span>
      </div>
    </div>
  );
}

/**
 * 对话开始标记
 */
function ConversationStart() {
  return (
    <div className="flex items-center justify-center py-4 mb-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <div className="h-px w-12 bg-ink-900/10" />
        <span>对话开始</span>
        <div className="h-px w-12 bg-ink-900/10" />
      </div>
    </div>
  );
}

/**
 * 空消息提示
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-lg font-medium text-ink-700">暂无消息</div>
      <p className="mt-2 text-sm text-muted">开始与 AI 助手对话</p>
    </div>
  );
}

/**
 * 优化的消息卡片项（使用 memo 减少不必要的重渲染）
 */
const MessageCardItem = memo(function MessageCardItem({
  item,
  idx,
  total,
  isRunning,
  permissionRequest,
  onPermissionResult,
}: {
  item: { message: StreamMessage; originalIndex: number };
  idx: number;
  total: number;
  isRunning: boolean;
  permissionRequest: PermissionRequest | undefined;
  onPermissionResult: ((toolUseId: string, result: PermissionResult) => void) | undefined;
  activeSessionId: string | null;
}) {
  const isLast = idx === total - 1;
  return (
    <div style={{ contentVisibility: "auto", containIntrinsicSize: "0 200px" }}>
      <MessageCard
        message={item.message}
        isLast={isLast}
        isRunning={isRunning}
        permissionRequest={permissionRequest}
        onPermissionResult={onPermissionResult}
      />
    </div>
  );
});

export function MessageList({
  messages,
  permissionRequests,
  isRunning,
  hasMoreHistory,
  isLoadingHistory,
  totalMessages,
  partialMessage,
  showPartialMessage,
  shouldAutoScroll,
  hasNewMessages,
  onLoadMore,
  onScroll,
  scrollToBottom,
  onPermissionResult,
  scrollContainerRef,
  messagesEndRef,
  activeSessionId,
}: MessageListProps) {
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // 设置 IntersectionObserver 监听顶部元素
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && hasMoreHistory && !isLoadingHistory) {
          onLoadMore();
        }
      },
      {
        root: container,
        rootMargin: "100px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreHistory, isLoadingHistory, onLoadMore, scrollContainerRef]);

  return (
    <>
      <div
        ref={scrollContainerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-8 pb-40 pt-6"
      >
        <div className="mx-auto max-w-3xl">
          <div ref={topSentinelRef} className="h-1" />

          {!hasMoreHistory && totalMessages > 0 && <ConversationStart />}

          {isLoadingHistory && <LoadingIndicator />}

          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((item, idx) => (
              <MessageCardItem
                key={`${activeSessionId}-msg-${item.originalIndex}`}
                item={item}
                idx={idx}
                total={messages.length}
                isRunning={isRunning}
                permissionRequest={permissionRequests[0]}
                onPermissionResult={onPermissionResult}
                activeSessionId={activeSessionId}
              />
            ))
          )}

          {/* 部分消息实时显示 */}
          <div className="partial-message">
            <MDContent text={partialMessage} />
            {showPartialMessage && <SkeletonLoader />}
          </div>

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 新消息提示 */}
      {hasNewMessages && !shouldAutoScroll && <NewMessagesButton onClick={scrollToBottom} />}
    </>
  );
}
