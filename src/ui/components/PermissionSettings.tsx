/**
 * 权限策略配置组件
 *
 * 显示和配置工具权限策略：
 * - 默认模式选择
 * - 工具覆盖配置
 * - 危险工具强制确认开关
 */
import { useEffect, useState } from "react";
import type { PermissionConfig, PermissionBehavior } from "../../shared/types";

type PermissionSettingsProps = Record<string, never>;

export function PermissionSettings(_props: PermissionSettingsProps) {
  const [config, setConfig] = useState<PermissionConfig>({
    defaultMode: "smart",
    toolOverrides: {},
    forceConfirmDangerous: true,
    enableLogging: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 展开状态
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  // 加载当前配置
  useEffect(() => {
    let mounted = true;

    window.electron
      .getPermissionConfig()
      .then((savedConfig) => {
        if (mounted) {
          setConfig(savedConfig);
        }
      })
      .catch((error) => {
        console.error("加载权限配置失败:", error);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.electron.savePermissionConfig(config);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        console.error("保存权限配置失败:", result.error);
      }
    } catch (error) {
      console.error("保存权限配置失败:", error);
    } finally {
      setSaving(false);
    }
  };

  // 更新工具覆盖
  const updateToolOverride = (toolName: string, behavior: PermissionBehavior | "") => {
    const newOverrides = { ...config.toolOverrides };
    if (behavior === "") {
      delete newOverrides[toolName];
    } else {
      newOverrides[toolName] = behavior;
    }
    setConfig({ ...config, toolOverrides: newOverrides });
  };

  if (loading) {
    return (
      <div className="mt-4 flex items-center justify-center py-8">
        <svg className="h-6 w-6 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    );
  }

  const toolCategories = [
    {
      id: "dangerous",
      name: "危险工具",
      description: "可能造成数据丢失或系统更改",
      tools: ["Bash", "Write", "Edit"],
      color: "error",
    },
    {
      id: "moderate",
      name: "中等风险",
      description: "可能影响多个文件或执行复杂操作",
      tools: ["Task", "Agent", "NotebookEdit"],
      color: "warning",
    },
    {
      id: "safe",
      name: "安全工具",
      description: "仅读取数据，不会修改文件",
      tools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
      color: "success",
    },
  ];

  const behaviorOptions: { value: PermissionBehavior | ""; label: string }[] = [
    { value: "", label: "使用默认" },
    { value: "allow", label: "始终允许" },
    { value: "ask-user", label: "询问用户" },
    { value: "deny", label: "始终拒绝" },
  ];

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        配置 Claude 如何请求工具权限。选择默认模式，或单独配置特定工具。
      </p>

      {/* 默认模式 */}
      <div>
        <label className="text-xs font-medium text-muted">默认权限模式</label>
        <select
          className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none"
          value={config.defaultMode}
          onChange={(e) => setConfig({ ...config, defaultMode: e.target.value as PermissionConfig["defaultMode"] })}
        >
          <option value="smart">智能模式 - 根据工具风险级别自动判断</option>
          <option value="ask-user">询问模式 - 始终请求用户确认</option>
          <option value="auto-approve">自动批准 - 允许所有工具（危险）</option>
        </select>
      </div>

      {/* 危险工具强制确认 */}
      <label className="flex items-center gap-3 rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-3 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-ink-900/20 text-accent"
          checked={config.forceConfirmDangerous}
          onChange={(e) => setConfig({ ...config, forceConfirmDangerous: e.target.checked })}
        />
        <div className="flex-1">
          <div className="text-sm font-medium text-ink-800">强制确认危险工具</div>
          <div className="text-xs text-muted">Bash、Write、Edit 操作始终需要用户确认</div>
        </div>
      </label>

      {/* 工具覆盖配置 - 折叠面板 */}
      <div>
        <label className="text-xs font-medium text-muted">工具权限覆盖</label>
        <div className="mt-1.5 space-y-2">
          {toolCategories.map((category) => (
            <div key={category.id}>
              <button
                type="button"
                className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                  expandedCategory === category.id
                    ? `border-${category.color}/30 bg-${category.color}/5`
                    : "border-ink-900/10 bg-surface-secondary hover:bg-surface-tertiary"
                }`}
                onClick={() => setExpandedCategory(expandedCategory === category.id ? null : category.id)}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-medium ${expandedCategory === category.id ? `text-${category.color}` : "text-ink-800"}`}>
                    {category.name}
                  </span>
                  <span className="text-xs text-muted">{category.tools.join(", ")}</span>
                </div>
                <svg
                  className={`h-4 w-4 text-muted transition-transform ${expandedCategory === category.id ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {expandedCategory === category.id && (
                <div className="mt-2 space-y-2 pl-4">
                  {category.tools.map((tool) => (
                    <div key={tool} className="flex items-center gap-3">
                      <span className="w-24 text-sm text-ink-700">{tool}</span>
                      <select
                        className="flex-1 rounded-lg border border-ink-900/10 bg-surface px-3 py-1.5 text-xs focus:border-accent focus:outline-none"
                        value={config.toolOverrides[tool] || ""}
                        onChange={(e) => updateToolOverride(tool, e.target.value as PermissionBehavior | "")}
                      >
                        {behaviorOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 保存按钮 */}
      <button
        className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "保存中..." : "保存设置"}
      </button>

      {/* 保存成功提示 */}
      {saved && (
        <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-2.5 text-sm text-success">
          权限设置已保存！
        </div>
      )}
    </div>
  );
}
