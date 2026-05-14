/**
 * 自动滚动 Hook
 *
 * 管理消息列表的自动滚动行为：
 * - 用户在底部时自动跟随新消息
 * - 用户向上滚动时停止自动滚动
 * - 提供"新消息"提示和回到底部按钮
 */
import { useCallback, useEffect, useRef, useState } from "react";

const SCROLL_THRESHOLD = 50;

export type AutoScrollOptions = {
  /** 依赖项变化时重置滚动状态 */
  resetDeps?: unknown[];
};

export type AutoScrollHandle = {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  shouldAutoScroll: boolean;
  hasNewMessages: boolean;
  handleScroll: () => void;
  scrollToBottom: () => void;
  enableAutoScroll: () => void;
  checkForNewMessages: (messageCount: number) => void;
  restoreScrollAfterLoad: () => void;
  prepareForHistoryLoad: () => void;
};

/**
 * 管理自动滚动的 Hook
 *
 * @param options 配置选项
 * @returns 自动滚动控制句柄
 */
export function useAutoScroll(options: AutoScrollOptions = {}): AutoScrollHandle {
  const { resetDeps = [] } = options;

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollHeightBeforeLoadRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const prevMessagesLengthRef = useRef(0);

  // State
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  // 处理滚动事件
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

    if (isAtBottom !== shouldAutoScroll) {
      setShouldAutoScroll(isAtBottom);
      if (isAtBottom) {
        setHasNewMessages(false);
      }
    }
  }, [shouldAutoScroll]);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // 启用自动滚动（发送消息时调用）
  const enableAutoScroll = useCallback(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
  }, []);

  // 重置滚动状态（会话切换时）
  useEffect(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    prevMessagesLengthRef.current = 0;
    // 延迟滚动到底部，等待 DOM 更新
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // 监听新消息，更新滚动状态
  const checkForNewMessages = useCallback(
    (messageCount: number) => {
      if (shouldAutoScroll) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else if (messageCount > prevMessagesLengthRef.current && prevMessagesLengthRef.current > 0) {
        setHasNewMessages(true);
      }
      prevMessagesLengthRef.current = messageCount;
    },
    [shouldAutoScroll]
  );

  // 处理历史加载后的滚动位置恢复
  const restoreScrollAfterLoad = useCallback(() => {
    if (shouldRestoreScrollRef.current) {
      const container = scrollContainerRef.current;
      if (container) {
        const newScrollHeight = container.scrollHeight;
        const scrollDiff = newScrollHeight - scrollHeightBeforeLoadRef.current;
        container.scrollTop += scrollDiff;
      }
      shouldRestoreScrollRef.current = false;
    }
  }, []);

  // 记录加载历史前的滚动位置
  const prepareForHistoryLoad = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      scrollHeightBeforeLoadRef.current = container.scrollHeight;
      shouldRestoreScrollRef.current = true;
    }
  }, []);

  return {
    scrollContainerRef,
    messagesEndRef,
    shouldAutoScroll,
    hasNewMessages,
    handleScroll,
    scrollToBottom,
    enableAutoScroll,
    checkForNewMessages,
    restoreScrollAfterLoad,
    prepareForHistoryLoad,
  };
}
