import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { URL } from "url";
import type { ApiConfig } from "./config-store.js";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildCustomMessagesEndpoint(baseURL: string): string {
  const normalized = trimTrailingSlash(baseURL);
  if (normalized.endsWith("/v1/messages")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/messages`;
  }
  return `${normalized}/v1/messages`;
}

function buildNvidiaChatEndpoint(baseURL: string): string {
  const normalized = trimTrailingSlash(baseURL);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

/**
 * 在主进程中测试 API 连接。
 *
 * 这个函数是设置页“测试”按钮背后的真实连通性逻辑：
 * - NVIDIA：按 OpenAI 兼容格式请求 /chat/completions。
 * - 自定义：按 Anthropic 兼容格式请求 /v1/messages，并兼容用户直接填完整 /v1/messages 的情况。
 */
export async function testApiConnection(config: ApiConfig): Promise<{ success: boolean; message: string }> {
  const apiType = config.apiType || "nvidia";

  return new Promise((resolve) => {
    let endpoint: string;
    let requestBody: string;
    let headers: Record<string, string>;

    if (apiType === "nvidia") {
      endpoint = buildNvidiaChatEndpoint(config.baseURL);
      requestBody = JSON.stringify({
        model: config.model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      };
    } else {
      endpoint = buildCustomMessagesEndpoint(config.baseURL);
      requestBody = JSON.stringify({
        model: config.model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
      headers = {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      };
    }

    const url = new URL(endpoint);
    const isHTTPS = url.protocol === "https:";
    const requestFn = isHTTPS ? httpsRequest : httpRequest;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHTTPS ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers,
      timeout: 30000,
    };

    const req = requestFn(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          if (apiType === "nvidia") {
            resolve({ success: true, message: "连接成功，NVIDIA API 工作正常。" });
          } else {
            resolve({ success: true, message: "连接成功。" });
          }
        } else {
          try {
            const errorData = JSON.parse(data);
            const errorMessage = errorData.error?.message || errorData.error?.type || `HTTP ${res.statusCode}`;
            resolve({ success: false, message: `连接失败: ${errorMessage}` });
          } catch {
            resolve({ success: false, message: `连接失败: HTTP ${res.statusCode}` });
          }
        }
      });
    });

    req.on("error", (error) => {
      console.error("[test-api-connection] Error:", error);
      resolve({ success: false, message: `连接失败: ${error.message}` });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, message: "连接失败: 请求超时" });
    });

    req.write(requestBody);
    req.end();
  });
}
