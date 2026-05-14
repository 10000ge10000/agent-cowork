/**
 * 全局错误处理组件
 *
 * 显示全局错误提示：
 * - API 配置错误
 * - 连接错误
 * - 其他运行时错误
 */

export type GlobalErrorHandlerProps = {
  error: string | null;
  onDismiss: () => void;
};

export function GlobalErrorHandler({ error, onDismiss }: GlobalErrorHandlerProps) {
  if (!error) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-error/20 bg-error/10 px-4 py-3 shadow-lg">
      <div className="flex items-center gap-3">
        <svg className="h-5 w-5 text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm text-error">{error}</span>
        <button
          className="text-error hover:text-error/80 transition-colors"
          onClick={onDismiss}
          aria-label="关闭"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
