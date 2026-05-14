import { useEffect, useRef, useState } from "react";
import type {
  PermissionResult,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage
} from "@anthropic-ai/claude-agent-sdk";
import type { StreamMessage } from "../types";
import type { PermissionRequest } from "../store/useAppStore";
import MDContent from "../render/markdown";
import { DecisionPanel } from "./DecisionPanel";

type MessageContent = SDKAssistantMessage["message"]["content"][number];
type ToolResultContent = SDKUserMessage["message"]["content"][number];
type ToolStatus = "pending" | "success" | "error";
const toolStatusMap = new Map<string, ToolStatus>();
const toolStatusListeners = new Set<() => void>();
const MAX_VISIBLE_LINES = 3;

type AskUserQuestionInput = {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
};

const getAskUserQuestionSignature = (input?: AskUserQuestionInput | null) => {
  if (!input?.questions?.length) return "";
  return input.questions.map((question) => {
    const options = (question.options ?? []).map((o) => `${o.label}|${o.description ?? ""}`).join(",");
    return `${question.question}|${question.header ?? ""}|${question.multiSelect ? "1" : "0"}|${options}`;
  }).join("||");
};

const setToolStatus = (toolUseId: string | undefined, status: ToolStatus) => {
  if (!toolUseId) return;
  toolStatusMap.set(toolUseId, status);
  toolStatusListeners.forEach((listener) => listener());
};

const useToolStatus = (toolUseId: string | undefined) => {
  const [status, setStatus] = useState<ToolStatus | undefined>(() =>
    toolUseId ? toolStatusMap.get(toolUseId) : undefined
  );
  useEffect(() => {
    if (!toolUseId) return;
    const handleUpdate = () => setStatus(toolStatusMap.get(toolUseId));
    toolStatusListeners.add(handleUpdate);
    return () => { toolStatusListeners.delete(handleUpdate); };
  }, [toolUseId]);
  return status;
};

const StatusDot = ({ variant = "accent", isActive = false, isVisible = true }: {
  variant?: "accent" | "success" | "error"; isActive?: boolean; isVisible?: boolean;
}) => {
  if (!isVisible) return null;
  const colorClass = variant === "success" ? "bg-success" : variant === "error" ? "bg-error" : "bg-accent";
  return (
    <span className="relative flex h-2 w-2">
      {isActive && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colorClass} opacity-75`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colorClass}`} />
    </span>
  );
};

const SessionResult = ({ message }: { message: SDKResultMessage }) => {
  const formatMinutes = (ms: number | undefined) => typeof ms !== "number" ? "-" : `${(ms / 60000).toFixed(2)} min`;
  const formatUsd = (usd: number | undefined) => typeof usd !== "number" ? "-" : usd.toFixed(2);
  const formatMillions = (tokens: number | undefined) => typeof tokens !== "number" ? "-" : `${(tokens / 1_000_000).toFixed(4)} M`;

  return (
    <div className="flex flex-col gap-2 mt-4">
      <div className="header text-accent">会话结果</div>
      <div className="flex flex-col rounded-xl px-4 py-3 border border-ink-900/10 bg-surface-secondary space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="font-normal">耗时</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">{formatMinutes(message.duration_ms)}</span>
          <span className="font-normal">API</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">{formatMinutes(message.duration_api_ms)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="font-normal">用量</span>
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-accent text-[13px]">费用 ${formatUsd(message.total_cost_usd)}</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">输入 {formatMillions(message.usage?.input_tokens)}</span>
          <span className="inline-flex items-center rounded-full bg-surface-tertiary px-2.5 py-0.5 text-ink-700 text-[13px]">输出 {formatMillions(message.usage?.output_tokens)}</span>
        </div>
      </div>
    </div>
  );
};

function isMarkdown(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const patterns: RegExp[] = [/^#{1,6}\s+/m, /```[\s\S]*?```/];
  return patterns.some((pattern) => pattern.test(text));
}

function extractTagContent(input: string, tag: string): string | null {
  const match = input.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1] ?? null;
}

const ToolResult = ({ messageContent }: { messageContent: ToolResultContent }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const isFirstRender = useRef(true);

  // 提前计算所有值（hooks 必须在条件判断之前调用）
  const toolUseId = messageContent.type === "tool_result" ? messageContent.tool_use_id : "";
  const isError = messageContent.type === "tool_result" && messageContent.is_error;
  const status: ToolStatus = isError ? "error" : "success";

  // 计算 lines 内容
  let lines: string[] = [];
  if (messageContent.type === "tool_result") {
    if (messageContent.is_error) {
      lines = [extractTagContent(String(messageContent.content), "tool_use_error") || String(messageContent.content)];
    } else {
      try {
        if (Array.isArray(messageContent.content)) {
          lines = messageContent.content.map((item: { text?: string }) => item.text || "").join("\n").split("\n");
        } else {
          lines = String(messageContent.content).split("\n");
        }
      } catch {
        lines = [JSON.stringify(messageContent, null, 2)];
      }
    }
  }

  const isMarkdownContent = isMarkdown(lines.join("\n"));
  const hasMoreLines = lines.length > MAX_VISIBLE_LINES;
  const visibleContent = hasMoreLines && !isExpanded ? lines.slice(0, MAX_VISIBLE_LINES).join("\n") : lines.join("\n");

  // Hooks 必须在条件判断之前调用
  useEffect(() => {
    if (toolUseId) setToolStatus(toolUseId, status);
  }, [toolUseId, status]);
  useEffect(() => {
    if (!hasMoreLines || isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [hasMoreLines, isExpanded]);

  // 条件判断在 hooks 之后
  if (messageContent.type !== "tool_result") return null;

  return (
    <div className="flex flex-col mt-4">
      <div className="header text-accent">输出</div>
      <div className="mt-2 rounded-xl bg-surface-tertiary p-3">
        <pre className={`text-sm whitespace-pre-wrap break-words font-mono ${isError ? "text-red-500" : "text-ink-700"}`}>
          {isMarkdownContent ? <MDContent text={visibleContent} /> : visibleContent}
        </pre>
        {hasMoreLines && (
          <button onClick={() => setIsExpanded(!isExpanded)} className="mt-2 text-sm text-accent hover:text-accent-hover transition-colors flex items-center gap-1">
            <span>{isExpanded ? "▲" : "▼"}</span>
            <span>{isExpanded ? "收起" : `展开剩余 ${lines.length - MAX_VISIBLE_LINES} 行`}</span>
          </button>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

const AssistantBlockCard = ({ title, text, showIndicator = false }: { title: string; text: string; showIndicator?: boolean }) => (
  <div className="flex flex-col mt-4">
    <div className="header text-accent flex items-center gap-2">
      <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
      {title}
    </div>
    <MDContent text={text} />
  </div>
);

const ToolUseCard = ({ messageContent, showIndicator = false }: { messageContent: MessageContent; showIndicator?: boolean }) => {
  // Hooks 必须在条件判断之前调用
  const toolId = messageContent.type === "tool_use" ? messageContent.id : undefined;
  const toolStatus = useToolStatus(toolId);
  const statusVariant = toolStatus === "error" ? "error" : "success";
  const isPending = !toolStatus || toolStatus === "pending";
  const shouldShowDot = toolStatus === "success" || toolStatus === "error" || showIndicator;

  useEffect(() => {
    if (toolId && !toolStatusMap.has(toolId)) setToolStatus(toolId, "pending");
  }, [toolId]);

  // 条件判断在 hooks 之后
  if (messageContent.type !== "tool_use") return null;

  const getToolInfo = (): string | null => {
    const input = messageContent.input as Record<string, unknown>;
    switch (messageContent.name) {
      case "Bash":
        return (input?.command as string) || null;
      case "Read":
      case "Write":
      case "Edit":
        return (input?.file_path as string) || null;
      case "Glob":
      case "Grep":
        return (input?.pattern as string) || null;
      case "Task":
        return (input?.description as string) || null;
      case "WebFetch":
        return (input?.url as string) || null;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[1rem] bg-surface-tertiary px-3 py-2 mt-4 overflow-hidden">
      <div className="flex flex-row items-center gap-2 min-w-0">
        <StatusDot variant={statusVariant} isActive={isPending && showIndicator} isVisible={shouldShowDot} />
        <div className="flex flex-row items-center gap-2 tool-use-item min-w-0 flex-1">
          <span className="inline-flex items-center rounded-md text-accent py-0.5 text-sm font-medium shrink-0">{messageContent.name}</span>
          <span className="text-sm text-muted truncate">{getToolInfo()}</span>
        </div>
      </div>
    </div>
  );
};

const AskUserQuestionCard = ({
  messageContent,
  permissionRequest,
  onPermissionResult
}: {
  messageContent: MessageContent;
  permissionRequest?: PermissionRequest;
  onPermissionResult?: (toolUseId: string, result: PermissionResult) => void;
}) => {
  if (messageContent.type !== "tool_use") return null;

  const input = messageContent.input as AskUserQuestionInput | null;
  const questions = input?.questions ?? [];
  const currentSignature = getAskUserQuestionSignature(input);
  const requestSignature = getAskUserQuestionSignature(permissionRequest?.input as AskUserQuestionInput | undefined);
  const isActiveRequest = permissionRequest && currentSignature === requestSignature;

  if (isActiveRequest && onPermissionResult) {
    return (
      <div className="mt-4">
        <DecisionPanel
          request={permissionRequest}
          onSubmit={(result) => onPermissionResult(permissionRequest.toolUseId, result)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[1rem] bg-surface-tertiary px-3 py-2 mt-4">
      <div className="flex flex-row items-center gap-2">
        <StatusDot variant="success" isActive={false} isVisible={true} />
        <span className="inline-flex items-center rounded-md text-accent py-0.5 text-sm font-medium">AskUserQuestion</span>
      </div>
      {questions.map((q, idx) => (
        <div key={idx} className="text-sm text-ink-700 ml-4">{q.question}</div>
      ))}
    </div>
  );
};

const SystemInfoCard = ({ message, showIndicator = false }: { message: SDKMessage; showIndicator?: boolean }) => {
  if (message.type !== "system" || !("subtype" in message) || message.subtype !== "init") return null;

  const systemMsg = message as { session_id?: string; model?: string; permissionMode?: string; cwd?: string };

  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="header text-accent flex items-center gap-2">
        <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
        System Init
      </div>
      <div className="flex flex-col rounded-xl px-4 py-2 border border-ink-900/10 bg-surface-secondary space-y-1">
        <div className="text-[14px]">
          <span className="mr-4 font-normal">会话 ID</span>
          <span className="font-light">{systemMsg.session_id || "-"}</span>
        </div>
        <div className="text-[14px]">
          <span className="mr-4 font-normal">模型名称</span>
          <span className="font-light">{systemMsg.model || "-"}</span>
        </div>
        <div className="text-[14px]">
          <span className="mr-4 font-normal">权限模式</span>
          <span className="font-light">{systemMsg.permissionMode || "-"}</span>
        </div>
        <div className="text-[14px]">
          <span className="mr-4 font-normal">工作目录</span>
          <span className="font-light">{systemMsg.cwd || "-"}</span>
        </div>
      </div>
    </div>
  );
};

const UserMessageCard = ({ message, showIndicator = false }: { message: { type: "user_prompt"; prompt: string }; showIndicator?: boolean }) => (
  <div className="flex flex-col mt-4">
    <div className="header text-accent flex items-center gap-2">
      <StatusDot variant="success" isActive={showIndicator} isVisible={showIndicator} />
      用户
    </div>
    <MDContent text={message.prompt} />
  </div>
);

export function MessageCard({
  message,
  isLast = false,
  isRunning = false,
  permissionRequest,
  onPermissionResult
}: {
  message: StreamMessage;
  isLast?: boolean;
  isRunning?: boolean;
  permissionRequest?: PermissionRequest;
  onPermissionResult?: (toolUseId: string, result: PermissionResult) => void;
}) {
  const showIndicator = isLast && isRunning;

  if (message.type === "user_prompt") {
    return <UserMessageCard message={message} showIndicator={showIndicator} />;
  }

  const sdkMessage = message as SDKMessage;

  if (sdkMessage.type === "system") {
    return <SystemInfoCard message={sdkMessage} showIndicator={showIndicator} />;
  }

  if (sdkMessage.type === "result") {
    if (sdkMessage.subtype === "success") {
      return <SessionResult message={sdkMessage} />;
    }
    return (
      <div className="flex flex-col gap-2 mt-4">
        <div className="header text-error">会话错误</div>
        <div className="rounded-xl bg-error-light p-3">
          <pre className="text-sm text-error whitespace-pre-wrap">{JSON.stringify(sdkMessage, null, 2)}</pre>
        </div>
      </div>
    );
  }

  if (sdkMessage.type === "assistant") {
    const contents = sdkMessage.message.content;
    return (
      <>
        {contents.map((content: MessageContent, idx: number) => {
          const isLastContent = idx === contents.length - 1;
          if (content.type === "thinking") {
            return <AssistantBlockCard key={idx} title="思考" text={content.thinking} showIndicator={isLastContent && showIndicator} />;
          }
          if (content.type === "text") {
            return <AssistantBlockCard key={idx} title="助手" text={content.text} showIndicator={isLastContent && showIndicator} />;
          }
          if (content.type === "tool_use") {
            if (content.name === "AskUserQuestion") {
              return <AskUserQuestionCard key={idx} messageContent={content} permissionRequest={permissionRequest} onPermissionResult={onPermissionResult} />;
            }
            return <ToolUseCard key={idx} messageContent={content} showIndicator={isLastContent && showIndicator} />;
          }
          return null;
        })}
      </>
    );
  }

  if (sdkMessage.type === "user") {
    const contents = sdkMessage.message.content;
    return (
      <>
        {contents.map((content: ToolResultContent, idx: number) => {
          if (content.type === "tool_result") {
            return <ToolResult key={idx} messageContent={content} />;
          }
          return null;
        })}
      </>
    );
  }

  return null;
}

export { MessageCard as EventCard };
