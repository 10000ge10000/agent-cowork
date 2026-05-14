import { createServer, type IncomingMessage } from "http";
import { afterEach, describe, expect, it } from "vitest";
import { testApiConnection } from "../api-connection.js";
import { getProxyStatus, startProxy, stopProxy } from "../anthropic-proxy.js";

type CapturedRequest = {
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
};

let closeServer: (() => Promise<void>) | null = null;

type MockResponseFactory = (request: CapturedRequest) => unknown;

async function startMockApiServer(
  responseFactory: MockResponseFactory = () => ({ ok: true })
): Promise<{ baseURL: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];

  const server = createServer((req, res) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk.toString();
    });
    req.on("end", () => {
      const capturedRequest = {
        path: req.url ?? "",
        headers: req.headers,
        body: rawBody ? JSON.parse(rawBody) : null,
      };
      requests.push(capturedRequest);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseFactory(capturedRequest)));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock API server");
  }

  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    requests,
  };
}

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
  await stopProxy();
});

describe("testApiConnection", () => {
  it("should call custom APIs with Anthropic-compatible /v1/messages requests", async () => {
    const mock = await startMockApiServer();

    const result = await testApiConnection({
      apiType: "custom",
      apiKey: "custom-key",
      baseURL: `${mock.baseURL}/v1`,
      model: "custom-model",
    });

    expect(result.success).toBe(true);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      path: "/v1/messages",
      body: {
        model: "custom-model",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    expect(mock.requests[0]?.headers["x-api-key"]).toBe("custom-key");
    expect(mock.requests[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("should not append /v1/messages twice when custom baseURL is already the messages endpoint", async () => {
    const mock = await startMockApiServer();

    const result = await testApiConnection({
      apiType: "custom",
      apiKey: "custom-key",
      baseURL: `${mock.baseURL}/v1/messages`,
      model: "custom-model",
    });

    expect(result.success).toBe(true);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.path).toBe("/v1/messages");
  });

  it("should call NVIDIA APIs with OpenAI-compatible /chat/completions requests", async () => {
    const mock = await startMockApiServer();

    const result = await testApiConnection({
      apiType: "nvidia",
      apiKey: "nvidia-key",
      baseURL: mock.baseURL,
      model: "nvidia-model",
    });

    expect(result.success).toBe(true);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      path: "/chat/completions",
      body: {
        model: "nvidia-model",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      },
    });
    expect(mock.requests[0]?.headers.authorization).toBe("Bearer nvidia-key");
  });

  it("should force NVIDIA proxy requests to use the configured target model", async () => {
    const mock = await startMockApiServer();
    await startProxy({
      port: 18768,
      targetBaseURL: mock.baseURL,
      targetAPIKey: "nvidia-key",
      targetModel: "minimaxai/minimax-m2.7",
    });

    const response = await fetch("http://127.0.0.1:18768/v1/messages?anthropic-beta=test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    expect(response.status).toBe(200);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      path: "/chat/completions",
      body: {
        model: "minimaxai/minimax-m2.7",
        max_tokens: 8192,
      },
    });
  });

  it("should not expose target API keys from public proxy status", async () => {
    const mock = await startMockApiServer();
    await startProxy({
      port: 18768,
      targetBaseURL: mock.baseURL,
      targetAPIKey: "nvidia-secret-key",
      targetModel: "minimaxai/minimax-m2.7",
    });

    const status = getProxyStatus();

    expect(status).toMatchObject({
      running: true,
      config: {
        port: 18768,
        targetBaseURL: mock.baseURL,
        targetModel: "minimaxai/minimax-m2.7",
      },
    });
    expect(JSON.stringify(status)).not.toContain("nvidia-secret-key");
    expect(status.config).not.toHaveProperty("targetAPIKey");
  });

  it("should translate Anthropic tools to OpenAI tools and OpenAI tool_calls back to Anthropic tool_use", async () => {
    const mock = await startMockApiServer(() => ({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [
              {
                id: "call_write_1",
                type: "function",
                function: {
                  name: "Write",
                  arguments: JSON.stringify({
                    file_path: "agent-rw-smoke.txt",
                    content: "hello-from-agent",
                  }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }));
    await startProxy({
      port: 18768,
      targetBaseURL: mock.baseURL,
      targetAPIKey: "nvidia-key",
      targetModel: "minimaxai/minimax-m2.7",
    });

    const response = await fetch("http://127.0.0.1:18768/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 10,
        stream: false,
        tools: [
          {
            name: "Write",
            description: "Write a file",
            input_schema: {
              type: "object",
              properties: {
                file_path: { type: "string" },
                content: { type: "string" },
              },
              required: ["file_path", "content"],
            },
          },
        ],
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: "Create the smoke file." }],
      }),
    });

    const body = await response.json() as {
      content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
    };
    const forwardedBody = mock.requests[0]?.body as {
      stream?: boolean;
      tools?: Array<{ type: string; function: { name: string; parameters: Record<string, unknown> } }>;
      tool_choice?: string;
    };

    expect(response.status).toBe(200);
    expect(forwardedBody.stream).toBe(false);
    expect(forwardedBody.tool_choice).toBe("auto");
    expect(forwardedBody.tools?.[0]).toMatchObject({
      type: "function",
      function: { name: "Write" },
    });
    expect(body.stop_reason).toBe("tool_use");
    expect(body.content[0]).toMatchObject({
      type: "tool_use",
      id: "call_write_1",
      name: "Write",
      input: {
        file_path: "agent-rw-smoke.txt",
        content: "hello-from-agent",
      },
    });
  });

  it("should wrap non-streaming OpenAI tool_calls as Anthropic SSE events when tools are requested with stream", async () => {
    const mock = await startMockApiServer(() => ({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                id: "call_write_2",
                type: "function",
                function: {
                  name: "Write",
                  arguments: JSON.stringify({ file_path: "agent-rw-smoke.txt", content: "hello-from-agent" }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }));
    await startProxy({
      port: 18768,
      targetBaseURL: mock.baseURL,
      targetAPIKey: "nvidia-key",
      targetModel: "minimaxai/minimax-m2.7",
    });

    const response = await fetch("http://127.0.0.1:18768/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 10,
        stream: true,
        tools: [{ name: "Write", input_schema: { type: "object", properties: {} } }],
        messages: [{ role: "user", content: "Create the smoke file." }],
      }),
    });

    const forwardedBody = mock.requests[0]?.body as { stream?: boolean };
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(forwardedBody.stream).toBe(false);
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("\"type\":\"tool_use\"");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("\"type\":\"input_json_delta\"");
    expect(text).toContain("\"stop_reason\":\"tool_use\"");
    expect(text).toContain("event: message_stop");
  });

  it("should translate Anthropic tool_result blocks to OpenAI tool role messages", async () => {
    const mock = await startMockApiServer(() => ({
      choices: [{ finish_reason: "stop", message: { content: "done" } }],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    }));
    await startProxy({
      port: 18768,
      targetBaseURL: mock.baseURL,
      targetAPIKey: "nvidia-key",
      targetModel: "minimaxai/minimax-m2.7",
    });

    const response = await fetch("http://127.0.0.1:18768/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 10,
        messages: [
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "call_ls_1", name: "LS", input: { path: "." } }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_ls_1", content: "agent-rw-smoke.txt" }],
          },
        ],
      }),
    });

    const forwardedBody = mock.requests[0]?.body as { messages?: Array<{ role: string; tool_call_id?: string; content?: string }> };

    expect(response.status).toBe(200);
    expect(forwardedBody.messages).toContainEqual({
      role: "tool",
      tool_call_id: "call_ls_1",
      content: "agent-rw-smoke.txt",
    });
  });
});
