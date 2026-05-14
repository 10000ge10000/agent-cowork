/**
 * 权限处理组件
 *
 * 管理权限请求的显示和响应：
 * - 权限请求弹窗显示
 * - 用户授权/拒绝操作
 * - 发送结果到后端
 */
import { useCallback, useEffect, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest } from "../../store/useAppStore";

export type PermissionHandlerProps = {
  permissionRequests: PermissionRequest[];
  sessionId: string | null;
  onPermissionResult: (toolUseId: string, result: PermissionResult) => void;
};

/**
 * 权限请求通知弹窗
 */
function PermissionNotification({
  request,
  onResponse,
}: {
  request: PermissionRequest;
  onResponse: (result: PermissionResult) => void;
}) {
  const [reasonInput, setReasonInput] = useState("");

  const handleAllow = useCallback(() => {
    onResponse({ behavior: "allow", updatedInput: request.input as Record<string, unknown> });
  }, [onResponse, request.input]);

  const handleDeny = useCallback(() => {
    onResponse({ behavior: "deny", message: reasonInput || "用户拒绝授权" });
  }, [onResponse, reasonInput]);

  // 自动聚焦到输入框
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>("[data-permission-reason]");
    if (input) {
      input.focus();
    }
  }, []);

  // 工具名称汉化
  const toolNameMap: Record<string, string> = {
    Bash: "执行命令",
    Write: "写入文件",
    Edit: "编辑文件",
    Read: "读取文件",
    Glob: "搜索文件",
    Grep: "搜索内容",
    Task: "执行任务",
    Agent: "启动代理",
  };

  const toolDisplayName = toolNameMap[request.toolName] || request.toolName;

  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 w-[600px] max-w-[90vw] rounded-xl border border-accent/20 bg-white p-4 shadow-lg">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h5.856c1.962 0 3.725-1.046 4.677-2.734l.802-1.422c.79-1.4 1.186-2.1 1.186-2.844 0-2.485-2.015-4.5-4.5-4.5H7.5m0 12h5.856" />
          </svg>
          <span className="font-medium text-ink-800">权限请求</span>
        </div>

        <div className="rounded-lg bg-surface-secondary p-3">
          <div className="text-sm text-ink-700">
            <span className="font-medium">{toolDisplayName}</span>
            {" - "}
            <span className="text-muted">
              {request.toolName === "Bash"
                ? String((request.input as { command?: string })?.command ?? "")
                : JSON.stringify(request.input).slice(0, 100)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <input
            data-permission-reason
            type="text"
            placeholder="拒绝原因（可选）..."
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            className="w-full rounded-lg border border-ink-900/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleDeny}
            className="rounded-lg bg-error/10 px-4 py-2 text-sm font-medium text-error hover:bg-error/20 transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={handleAllow}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}

export function PermissionHandler({
  permissionRequests,
  sessionId,
  onPermissionResult,
}: PermissionHandlerProps) {
  const currentRequest = permissionRequests[0];

  const handleResult = useCallback(
    (result: PermissionResult) => {
      if (currentRequest) {
        onPermissionResult(currentRequest.toolUseId, result);
      }
    },
    [onPermissionResult, currentRequest]
  );

  if (!currentRequest || !sessionId) return null;

  return <PermissionNotification request={currentRequest} onResponse={handleResult} />;
}
