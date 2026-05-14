/**
 * 部分消息处理 Hook
 *
 * 处理流式消息的部分内容：
 * - content_block_start: 开始新内容块
 * - content_block_delta: 累积内容
 * - content_block_stop: 停止累积
 */
import { useCallback, useRef, useState } from "react";
import type { ServerEvent } from "../types";

/**
 * 从流事件中提取部分消息内容
 */
function extractPartialContent(eventMessage: {
  delta?: { type?: string; [key: string]: unknown };
}): string {
  try {
    if (!eventMessage.delta?.type) return "";
    const realType = eventMessage.delta.type.split("_")[0] ?? "";
    if (!realType) return "";
    return String(eventMessage.delta[realType] ?? "");
  } catch {
    return "";
  }
}

export type PartialMessageHandle = {
  partialMessage: string;
  showPartialMessage: boolean;
  handlePartialEvent: (event: ServerEvent, onDelta?: () => void) => void;
  resetPartialMessage: () => void;
};

/**
 * 管理部分消息的 Hook
 *
 * @returns 部分消息状态和处理方法
 */
export function usePartialMessage(): PartialMessageHandle {
  const partialMessageRef = useRef("");
  const [partialMessage, setPartialMessage] = useState("");
  const [showPartialMessage, setShowPartialMessage] = useState(false);

  // 处理部分消息事件
  const handlePartialEvent = useCallback(
    (event: ServerEvent, onDelta?: () => void) => {
      if (event.type !== "stream.message" || event.payload.message.type !== "stream_event") return;

      const message = event.payload.message as {
        event?: { type?: string };
        delta?: { type?: string; [key: string]: unknown };
      };

      if (!message.event?.type) return;

      // 开始新的内容块
      if (message.event.type === "content_block_start") {
        partialMessageRef.current = "";
        setPartialMessage(partialMessageRef.current);
        setShowPartialMessage(true);
      }

      // 累积内容
      if (message.event.type === "content_block_delta") {
        const content = extractPartialContent(message);
        if (content) {
          partialMessageRef.current += content;
          setPartialMessage(partialMessageRef.current);
          onDelta?.();
        }
      }

      // 停止累积
      if (message.event.type === "content_block_stop") {
        setShowPartialMessage(false);
        // 延迟清理，让 UI 有时间显示最后内容
        setTimeout(() => {
          partialMessageRef.current = "";
          setPartialMessage("");
        }, 500);
      }
    },
    []
  );

  // 重置部分消息状态
  const resetPartialMessage = useCallback(() => {
    partialMessageRef.current = "";
    setPartialMessage("");
    setShowPartialMessage(false);
  }, []);

  return {
    partialMessage,
    showPartialMessage,
    handlePartialEvent,
    resetPartialMessage,
  };
}
