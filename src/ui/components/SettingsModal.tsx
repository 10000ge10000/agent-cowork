import { useCallback, useEffect, useState } from "react";
import type { ApiType } from "../../shared/types";
import {
  NVIDIA_AGENT_MODELS,
  NVIDIA_DEFAULT_AGENT_MODEL,
  isSupportedNvidiaAgentModel,
} from "../../shared/nvidia-models";
import { PermissionSettings } from "./PermissionSettings";

type SettingsModalProps = {
  onClose: () => void;
};

type TabType = "api" | "permissions";

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("api");
  const [apiType, setApiType] = useState<ApiType>("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("https://integrate.api.nvidia.com/v1");
  const [model, setModel] = useState(NVIDIA_DEFAULT_AGENT_MODEL);
  const [customBaseURL, setCustomBaseURL] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    window.electron
      .getApiConfig()
      .then((config) => {
        if (!mounted || !config) return;

        setApiKey(config.apiKey);
        setApiType(config.apiType || "nvidia");

        if (config.apiType === "custom") {
          setCustomBaseURL(config.baseURL);
          setCustomModel(config.model);
        } else if (!isSupportedNvidiaAgentModel(config.model)) {
          setTestResult({
            success: false,
            message: `当前 NVIDIA 模型 ${config.model} 未通过 Agent 运行时验证，已回退到 ${NVIDIA_DEFAULT_AGENT_MODEL}。`,
          });
          setModel(NVIDIA_DEFAULT_AGENT_MODEL);
          setBaseURL(config.baseURL);
          return;
        }

        setBaseURL(config.baseURL);
        setModel(config.model);
      })
      .catch((err) => {
        if (!mounted) return;
        console.error("加载配置失败:", err);
      })
      .finally(() => {
        if (mounted) setInitialLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleApiTypeChange = useCallback((type: ApiType) => {
    setApiType(type);
    setError(null);
    setTestResult(null);

    if (type === "nvidia") {
      setBaseURL("https://integrate.api.nvidia.com/v1");
      setModel(isSupportedNvidiaAgentModel(model) ? model : NVIDIA_DEFAULT_AGENT_MODEL);
    } else {
      setBaseURL(customBaseURL);
      setModel(customModel);
    }
  }, [customBaseURL, customModel, model]);

  const handleCustomURLChange = (value: string) => {
    setCustomBaseURL(value);
    setBaseURL(value);
    setError(null);
    setTestResult(null);
  };

  const handleCustomModelChange = (value: string) => {
    setCustomModel(value);
    setModel(value);
    setError(null);
    setTestResult(null);
  };

  const handleNvidiaModelSelect = (value: string) => {
    setError(null);
    setTestResult(null);
    setModel(value);
  };

  const validateInput = (): boolean => {
    if (!apiKey.trim()) {
      setError("请输入 API Key");
      return false;
    }
    if (!baseURL.trim()) {
      setError("请输入接口地址");
      return false;
    }
    if (!model.trim()) {
      setError("请输入模型名称");
      return false;
    }

    try {
      new URL(baseURL);
    } catch {
      setError("接口地址格式无效");
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateInput()) return;

    setError(null);
    setSaving(true);

    try {
      const result = await window.electron.saveApiConfig({
        apiKey: apiKey.trim(),
        baseURL: baseURL.trim(),
        model: model.trim(),
        apiType,
      });

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 1000);
      } else {
        setError(result.error || "保存失败");
      }
    } catch (err) {
      console.error("保存配置失败:", err);
      setError("保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!validateInput()) return;

    setTesting(true);
    setTestResult(null);

    try {
      const result = await window.electron.testApiConnection({
        apiKey: apiKey.trim(),
        baseURL: baseURL.trim(),
        model: model.trim(),
        apiType,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const isCustom = apiType === "custom";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-ink-900/5 bg-surface p-6 shadow-elevated">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800">设置</div>
          <button
            className="rounded-full p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-700 transition-colors"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-xl bg-surface-secondary p-1">
          <button
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "api" ? "bg-surface text-ink-800 shadow-sm" : "text-muted hover:text-ink-700"
            }`}
            onClick={() => setActiveTab("api")}
          >
            API 配置
          </button>
          <button
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "permissions" ? "bg-surface text-ink-800 shadow-sm" : "text-muted hover:text-ink-700"
            }`}
            onClick={() => setActiveTab("permissions")}
          >
            权限设置
          </button>
        </div>

        {activeTab === "api" && (
          <div className="mt-4">
            <p className="text-sm text-muted">配置 API 提供商、接口地址、API Key 和模型名称。</p>

            {initialLoading ? (
              <div className="mt-5 flex items-center justify-center py-8">
                <svg aria-hidden="true" className="h-6 w-6 animate-spin text-accent" viewBox="0 0 100 101" fill="none">
                  <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" opacity="0.3" />
                  <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentColor" />
                </svg>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted">API 提供商</label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        apiType === "nvidia"
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-ink-900/10 bg-surface-secondary text-ink-700 hover:border-ink-900/20"
                      }`}
                      onClick={() => handleApiTypeChange("nvidia")}
                    >
                      NVIDIA
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        apiType === "custom"
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-ink-900/10 bg-surface-secondary text-ink-700 hover:border-ink-900/20"
                      }`}
                      onClick={() => handleApiTypeChange("custom")}
                    >
                      自定义
                    </button>
                  </div>

                  {apiType === "nvidia" && (
                    <div className="mt-2 rounded-xl border border-info/20 bg-info/10 px-4 py-2.5 text-sm text-info">
                      <div>NVIDIA NIM 提供免费模型，通过内置代理转换 API 格式。</div>
                      <button
                        type="button"
                        className="mt-1 text-left text-xs underline underline-offset-2 hover:text-info/80"
                        onClick={() => window.open("https://build.nvidia.com/settings/api-keys", "_blank", "noopener,noreferrer")}
                      >
                        如何获取 NVIDIA API Key？访问 build.nvidia.com/settings/api-keys 注册账号后即可免费获取 API Key，平台提供 GLM-4.7、MiniMax-M2.7、Llama 系列等顶级模型的免费调用额度。
                      </button>
                    </div>
                  )}

                  {apiType === "custom" && (
                    <div className="mt-2 rounded-xl border border-warning/20 bg-warning/10 px-4 py-2.5 text-sm text-warning">
                      自定义 API 使用 Anthropic 兼容格式，接口地址可以填写服务根地址、/v1 或完整 /v1/messages。
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">接口地址</label>
                  {isCustom ? (
                    <input
                      type="url"
                      className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none"
                      placeholder="https://your-api.com/v1"
                      value={customBaseURL}
                      onChange={(e) => handleCustomURLChange(e.target.value)}
                      required
                    />
                  ) : (
                    <input
                      type="text"
                      className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-700 cursor-not-allowed"
                      value="https://integrate.api.nvidia.com/v1"
                      disabled
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">API Key</label>
                  <input
                    type="password"
                    className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none"
                    placeholder={apiType === "nvidia" ? "nvapi-..." : "your-api-key"}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setError(null);
                      setTestResult(null);
                    }}
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted">模型 {apiType === "nvidia" ? "（免费）" : ""}</label>
                  {isCustom ? (
                    <input
                      type="text"
                      className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none"
                      placeholder="model-name"
                      value={customModel}
                      onChange={(e) => handleCustomModelChange(e.target.value)}
                      required
                    />
                  ) : (
                    <div className="space-y-2">
                      <select
                        className="mt-1.5 w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none appearance-none cursor-pointer"
                        value={model}
                        onChange={(e) => handleNvidiaModelSelect(e.target.value)}
                      >
                        {NVIDIA_AGENT_MODELS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {testResult && (
                  <div className={`max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border px-4 py-2.5 text-sm ${
                    testResult.success ? "border-success/20 bg-success/10 text-success" : "border-error/20 bg-error/10 text-error"
                  }`}
                  >
                    {testResult.message}
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-error/20 bg-error/10 px-4 py-2.5 text-sm text-error">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-2.5 text-sm text-success">
                    配置已保存
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    className="flex-1 rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-surface-tertiary transition-colors"
                    onClick={onClose}
                    disabled={saving}
                  >
                    取消
                  </button>
                  <button
                    className="flex-1 rounded-xl border border-accent/20 bg-surface px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/5 transition-colors disabled:opacity-50"
                    onClick={handleTestConnection}
                    disabled={testing || saving || !apiKey.trim() || !baseURL.trim() || !model.trim()}
                  >
                    {testing ? "测试中..." : "测试"}
                  </button>
                  <button
                    className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
                    onClick={handleSave}
                    disabled={saving || !apiKey.trim() || !baseURL.trim() || !model.trim()}
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "permissions" && <PermissionSettings />}
      </div>
    </div>
  );
}
