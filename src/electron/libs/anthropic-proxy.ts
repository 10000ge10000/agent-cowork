/**
 * Anthropic-to-OpenAI 代理服务
 *
 * 功能：
 * - 将 Anthropic API 格式转换为 OpenAI 兼容格式
 * - 支持 NVIDIA NIM、OpenRouter 等 OpenAI 兼容后端
 * - 流式响应支持
 *
 * 请求流程：
 * Claude Agent SDK → 本地代理 (Anthropic 格式) → 后端 API (OpenAI 格式)
 */

import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { URL } from "url";

export const DEFAULT_PROXY_PORT = 18765;

// ============================================
// 类型定义
// ============================================

/**
 * Anthropic 消息格式
 */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}
interface AnthropicContent {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContent[];
  is_error?: boolean;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

interface AnthropicToolChoice {
  type: "auto" | "any" | "tool" | "none";
  name?: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

/**
 * OpenAI 消息格式
 */
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContent[] | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

interface OpenAIRequest {
  model: string;
  max_tokens: number;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

const CLAUDE_MODEL_PREFIXES = ["claude-", "anthropic/claude-"];
const NVIDIA_DEFAULT_MODEL = "minimaxai/minimax-m2.7";
const NVIDIA_MIN_OUTPUT_TOKENS = 8192;

/**
 * OpenAI 流式响应
 */
interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

type AnthropicStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContent[];
  stop_reason: AnthropicStopReason;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface OpenAIResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/**
 * Anthropic 流式响应
 */
/**
 * 代理配置
 */
export interface ProxyConfig {
  port: number;
  targetBaseURL: string;
  targetAPIKey: string;
  targetModel: string;
}

export type PublicProxyStatus = {
  running: boolean;
  config: {
    port: number;
    targetBaseURL: string;
    targetModel: string;
  } | null;
};

// ============================================
// 消息转换
// ============================================

/**
 * 将 Anthropic 消息转换为 OpenAI 格式
 */
function stringifyAnthropicContent(content: string | AnthropicContent[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text || "";
      return JSON.stringify(block);
    })
    .filter(Boolean)
    .join("\n");
}

function parseToolArguments(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) return {};
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapAnthropicTools(tools: AnthropicTool[] | undefined): OpenAITool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.input_schema || { type: "object", properties: {} }
    }
  }));
}

function mapAnthropicToolChoice(
  choice: AnthropicToolChoice | undefined
): OpenAIRequest["tool_choice"] | undefined {
  if (!choice) return undefined;
  if (choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "none") return "none";
  if (choice.type === "tool" && choice.name) {
    return { type: "function", function: { name: choice.name } };
  }
  return undefined;
}

function appendAnthropicMessage(messages: OpenAIMessage[], msg: AnthropicMessage): void {
  if (typeof msg.content === "string") {
    messages.push({
      role: msg.role,
      content: msg.content
    });
    return;
  }

  const textBlocks: OpenAIContent[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  const flushTextBlocks = () => {
    if (textBlocks.length === 0) return;
    messages.push({
      role: msg.role,
      content: textBlocks.length === 1 && textBlocks[0]?.type === "text"
        ? textBlocks[0].text || ""
        : [...textBlocks]
    });
    textBlocks.length = 0;
  };

  for (const block of msg.content) {
    if (block.type === "text") {
      textBlocks.push({
        type: "text",
        text: block.text || ""
      });
    } else if (block.type === "image" && block.source) {
      textBlocks.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`
        }
      });
    } else if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      });
    } else if (block.type === "tool_result" && block.tool_use_id) {
      flushTextBlocks();
      messages.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: stringifyAnthropicContent(block.content)
      });
    }
  }

  if (toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: textBlocks.map((block) => block.text || "").filter(Boolean).join("\n") || null,
      tool_calls: toolCalls
    });
    return;
  }

  flushTextBlocks();
}

function convertAnthropicToOpenAI(anthropic: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = [];

  if (anthropic.system) {
    messages.push({
      role: "system",
      content: anthropic.system
    });
  }

  for (const msg of anthropic.messages) {
    appendAnthropicMessage(messages, msg);
  }

  return {
    model: anthropic.model,
    max_tokens: Math.max(anthropic.max_tokens || 0, NVIDIA_MIN_OUTPUT_TOKENS),
    messages,
    tools: mapAnthropicTools(anthropic.tools),
    tool_choice: mapAnthropicToolChoice(anthropic.tool_choice),
    stream: anthropic.tools?.length ? false : anthropic.stream,
    temperature: anthropic.temperature,
    top_p: anthropic.top_p,
    stop: anthropic.stop_sequences
  };
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * NVIDIA 只接受自己的 OpenAI 兼容模型 ID。
 * 如果旧配置里残留了 Claude SDK 占位模型，这里强制回退到可用默认模型，避免后端直接返回 invalid model。
 */
function resolveNvidiaTargetModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || CLAUDE_MODEL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return NVIDIA_DEFAULT_MODEL;
  }
  return trimmed;
}

function mapOpenAIStopReason(reason: string | null): AnthropicStopReason {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "stop_sequence";
  return null;
}

function convertOpenAIResponseToAnthropic(openaiResponse: OpenAIResponse, model: string): AnthropicResponse {
  const choice = openaiResponse.choices?.[0] || {};
  const message = choice.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as OpenAIToolCall[] : [];
  const content: AnthropicContent[] = [];

  if (message.content) {
    content.push({
      type: "text",
      text: String(message.content)
    });
  }

  for (const toolCall of toolCalls) {
    if (!toolCall.id || !toolCall.function?.name) continue;
    content.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input: parseToolArguments(toolCall.function.arguments)
    });
  }

  return {
    id: generateId(),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: toolCalls.length > 0 ? "tool_use" : mapOpenAIStopReason(choice.finish_reason ?? null),
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

function* convertAnthropicResponseToStreamEvents(response: AnthropicResponse): Generator<string> {
  yield `event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: response.id,
      type: "message",
      role: "assistant",
      model: response.model
    }
  })}\n\n`;

  for (const [index, block] of response.content.entries()) {
    if (block.type === "tool_use") {
      yield `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {}
        }
      })}\n\n`;
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input || {})
        }
      })}\n\n`;
    } else {
      yield `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" }
      })}\n\n`;
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index,
        delta: {
          type: "text_delta",
          text: block.text || ""
        }
      })}\n\n`;
    }

    yield `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index
    })}\n\n`;
  }

  yield `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: {
      stop_reason: response.stop_reason,
      stop_sequence: null
    },
    usage: { output_tokens: response.usage.output_tokens }
  })}\n\n`;

  yield `event: message_stop\ndata: ${JSON.stringify({
    type: "message_stop"
  })}\n\n`;
}

/**
 * 将 OpenAI 流式块转换为 Anthropic 事件
 */
function* convertStreamChunk(chunk: OpenAIStreamChunk, isFirst: boolean): Generator<string> {
  const messageId = generateId();

  if (isFirst) {
    // 发送 message_start 事件
    yield `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        model: chunk.model
      }
    })}\n\n`;

    // 发送 content_block_start 事件
    yield `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" }
    })}\n\n`;
  }

  // 发送内容增量
  for (const choice of chunk.choices) {
    if (choice.delta.content) {
      yield `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: choice.delta.content
        }
      })}\n\n`;
    }

    if (choice.finish_reason) {
      // 发送 content_block_stop
      yield `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: 0
      })}\n\n`;

      // 发送 message_delta
      yield `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: {
          stop_reason: mapOpenAIStopReason(choice.finish_reason),
          stop_sequence: null
        },
        usage: { output_tokens: 0 }
      })}\n\n`;

      // 发送 message_stop
      yield `event: message_stop\ndata: ${JSON.stringify({
        type: "message_stop"
      })}\n\n`;
    }
  }
}

function* createFinalStreamEvents(reason: "end_turn" | "max_tokens" | "stop_sequence" = "end_turn"): Generator<string> {
  yield `event: content_block_stop\ndata: ${JSON.stringify({
    type: "content_block_stop",
    index: 0
  })}\n\n`;

  yield `event: message_delta\ndata: ${JSON.stringify({
    type: "message_delta",
    delta: {
      stop_reason: reason,
      stop_sequence: null
    },
    usage: { output_tokens: 0 }
  })}\n\n`;

  yield `event: message_stop\ndata: ${JSON.stringify({
    type: "message_stop"
  })}\n\n`;
}

function writeOnce(
  res: ServerResponse,
  statusCode: number,
  headers: Record<string, string>,
  body?: string
): boolean {
  if (res.headersSent || res.writableEnded || res.destroyed) {
    return false;
  }
  res.writeHead(statusCode, headers);
  if (body === undefined) {
    return true;
  } else {
    res.end(body);
  }
  return true;
}

function writeJsonOnce(res: ServerResponse, statusCode: number, payload: unknown): boolean {
  return writeOnce(res, statusCode, { "Content-Type": "application/json" }, JSON.stringify(payload));
}

function sendProxyError(res: ServerResponse, statusCode: number, body: string): void {
  let message = `Backend returned HTTP ${statusCode}`;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    message = parsed.error?.message || parsed.error?.type || message;
  } catch {
    if (body.trim()) {
      message = body.trim().slice(0, 500);
    }
  }

  writeJsonOnce(res, statusCode, { error: { type: "api_error", message } });
}

// ============================================
// 代理服务器
// ============================================

let proxyServer: Server | null = null;
let currentConfig: ProxyConfig | null = null;

export function isProxyRunningForConfig(config: ProxyConfig): boolean {
  return Boolean(
    proxyServer &&
      currentConfig?.targetBaseURL === config.targetBaseURL &&
      currentConfig.targetAPIKey === config.targetAPIKey &&
      currentConfig.targetModel === config.targetModel
  );
}

/**
 * 处理代理请求
 */
function handleProxyRequest(req: IncomingMessage, res: ServerResponse): void {
  const requestURL = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method !== "POST" || requestURL.pathname !== "/v1/messages") {
    writeOnce(res, 404, { "Content-Type": "text/plain" }, "Not Found");
    return;
  }

  if (!currentConfig) {
    writeJsonOnce(res, 500, { error: { type: "api_error", message: "Proxy not configured" } });
    return;
  }

  let responseClosed = false;
  const markResponseClosed = () => {
    responseClosed = true;
  };
  res.on("close", markResponseClosed);
  res.on("finish", markResponseClosed);

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const anthropicRequest = JSON.parse(body) as AnthropicRequest;
      console.warn("[Proxy] Received Anthropic request:", {
        model: anthropicRequest.model,
        messages: anthropicRequest.messages.length,
        stream: anthropicRequest.stream
      });

      // 转换请求格式
      const openaiRequest = convertAnthropicToOpenAI(anthropicRequest);

      // 使用已验证的配置
      const config = currentConfig;
      if (!config) {
        writeJsonOnce(res, 500, { error: { type: "api_error", message: "Proxy not configured" } });
        return;
      }

      // 映射模型名称
      openaiRequest.model = resolveNvidiaTargetModel(config.targetModel);

      // 解析目标 URL
      const targetURL = new URL(config.targetBaseURL);
      const isHTTPS = targetURL.protocol === "https:";
      const requestFn = isHTTPS ? httpsRequest : httpRequest;

      // 构建请求路径 - NVIDIA 使用 /chat/completions
      let requestPath = targetURL.pathname.replace(/\/+$/, "");
      if (!requestPath.endsWith("/chat/completions")) {
        requestPath += "/chat/completions";
      }

      console.warn("[Proxy] Forwarding to:", `${targetURL.origin}${requestPath}`, {
        requestedModel: anthropicRequest.model,
        targetModel: openaiRequest.model,
      });

      // 构建请求选项
      const options = {
        hostname: targetURL.hostname,
        port: targetURL.port || (isHTTPS ? 443 : 80),
        path: requestPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.targetAPIKey}`
        }
      };

      // 发送请求到后端
      const proxyReq = requestFn(options, (proxyRes) => {
        if (responseClosed) {
          proxyRes.resume();
          return;
        }

        console.warn("[Proxy] Backend response:", proxyRes.statusCode);
        const statusCode = proxyRes.statusCode ?? 500;

        if (statusCode < 200 || statusCode >= 300) {
          let errorBody = "";
          proxyRes.on("data", (chunk) => {
            errorBody += chunk.toString();
          });
          proxyRes.on("end", () => {
            if (!responseClosed) {
              sendProxyError(res, statusCode, errorBody);
            }
          });
          return;
        }

        if (anthropicRequest.stream && openaiRequest.stream) {
          // 流式响应处理
          if (!writeOnce(res, 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          })) {
            proxyRes.resume();
            return;
          }

          let isFirst = true;
          let didStartMessage = false;
          let didFinishMessage = false;
          let buffer = "";

          proxyRes.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") {
                  if (didStartMessage && !didFinishMessage) {
                    for (const event of createFinalStreamEvents("end_turn")) {
                      if (!res.writableEnded && !res.destroyed) res.write(event);
                    }
                    didFinishMessage = true;
                  }
                  continue;
                }
                try {
                  const chunk = JSON.parse(data) as OpenAIStreamChunk;
                  for (const event of convertStreamChunk(chunk, isFirst)) {
                    if (!res.writableEnded && !res.destroyed) res.write(event);
                    didStartMessage = true;
                    if (event.includes("message_stop")) {
                      didFinishMessage = true;
                    }
                    isFirst = false;
                  }
                } catch (_e) {
                  // 忽略解析错误
                }
              }
            }
          });

          proxyRes.on("end", () => {
            if (didStartMessage && !didFinishMessage) {
              for (const event of createFinalStreamEvents("end_turn")) {
                if (!res.writableEnded && !res.destroyed) res.write(event);
              }
            }
            if (!res.writableEnded && !res.destroyed) res.end();
          });
        } else {
          // 非流式响应处理
          let responseBody = "";
          proxyRes.on("data", (chunk) => {
            responseBody += chunk.toString();
          });

          proxyRes.on("end", () => {
            try {
              const openaiResponse = JSON.parse(responseBody) as OpenAIResponse;
              const anthropicResponse = convertOpenAIResponseToAnthropic(openaiResponse, openaiRequest.model);

              if (anthropicRequest.stream) {
                if (!writeOnce(res, 200, {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                  "Connection": "keep-alive"
                })) {
                  return;
                }
                for (const event of convertAnthropicResponseToStreamEvents(anthropicResponse)) {
                  if (!res.writableEnded && !res.destroyed) res.write(event);
                }
                if (!res.writableEnded && !res.destroyed) res.end();
                return;
              }

              writeJsonOnce(res, 200, anthropicResponse);
            } catch (error) {
              console.error("[Proxy] Response parsing error:", error);
              writeJsonOnce(res, 500, { error: { type: "api_error", message: "Failed to parse response" } });
            }
          });
        }
      });

      proxyReq.on("error", (error) => {
        console.error("[Proxy] Request error:", error);
        if (!responseClosed) {
          writeJsonOnce(res, 500, { error: { type: "api_error", message: error.message } });
        }
      });

      // 设置超时
      proxyReq.setTimeout(120000, () => {
        responseClosed = true;
        proxyReq.destroy();
        writeJsonOnce(res, 504, { error: { type: "api_error", message: "Request timeout" } });
      });

      proxyReq.write(JSON.stringify(openaiRequest));
      proxyReq.end();

    } catch (error) {
      console.error("[Proxy] Request handling error:", error);
      writeJsonOnce(res, 400, { error: { type: "invalid_request_error", message: "Invalid request body" } });
    }
  });
}

/**
 * 启动代理服务器
 */
export async function startProxy(config: ProxyConfig): Promise<string> {
  if (proxyServer) {
    await stopProxy();
  }

  return new Promise((resolve, reject) => {
    currentConfig = config;
    proxyServer = createServer(handleProxyRequest);

    proxyServer.on("error", (error) => {
      console.error("[Proxy] Server error:", error);
      reject(error);
    });

    proxyServer.listen(config.port, "127.0.0.1", () => {
      const proxyURL = `http://127.0.0.1:${config.port}`;
      console.warn(`[Proxy] Anthropic-compatible proxy started at ${proxyURL}`);
      console.warn(`[Proxy] Target: ${config.targetBaseURL}`);
      console.warn(`[Proxy] Model: ${config.targetModel}`);
      resolve(proxyURL);
    });
  });
}

/**
 * 停止代理服务器
 */
export function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (proxyServer) {
      proxyServer.close(() => {
        proxyServer = null;
        currentConfig = null;
        console.warn("[Proxy] Server stopped");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * 获取当前代理状态
 */
export function getProxyStatus(): PublicProxyStatus {
  return {
    running: proxyServer !== null,
    config: currentConfig
      ? {
          port: currentConfig.port,
          targetBaseURL: currentConfig.targetBaseURL,
          targetModel: currentConfig.targetModel,
        }
      : null
  };
}
