import type { ClientEvent } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string" && String(value[key]).trim().length > 0;
}

function hasPayload(event: Record<string, unknown>): event is Record<string, unknown> & { payload: Record<string, unknown> } {
  return isRecord(event.payload);
}

function isPermissionResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.behavior === "allow" || value.behavior === "deny";
}

function validateClientEvent(event: unknown): event is ClientEvent {
  if (!isRecord(event) || typeof event.type !== "string") {
    return false;
  }

  switch (event.type) {
    case "session.list":
      return !("payload" in event);

    case "session.start":
      return hasPayload(event) && hasString(event.payload, "title") && hasString(event.payload, "prompt");

    case "session.continue":
      return hasPayload(event) && hasString(event.payload, "sessionId") && hasString(event.payload, "prompt");

    case "session.stop":
    case "session.delete":
    case "session.history":
      return hasPayload(event) && hasString(event.payload, "sessionId");

    case "permission.response":
      return (
        hasPayload(event) &&
        hasString(event.payload, "sessionId") &&
        hasString(event.payload, "toolUseId") &&
        isPermissionResult(event.payload.result)
      );

    default:
      return false;
  }
}

/**
 * 解析渲染进程发来的 client-event 载荷。
 *
 * 这里故意同时兼容对象和 JSON 字符串两种形态：
 * - 旧版 preload 会先 JSON.stringify 再发送，主进程必须能反序列化。
 * - 后续如果 preload 改成直接发送对象，主进程也不需要再改 IPC 入口。
 */
export function parseClientEventPayload(payload: ClientEvent | string): ClientEvent | null {
  let parsed: unknown = payload;

  if (typeof payload !== "string") {
    return validateClientEvent(parsed) ? parsed : null;
  }

  try {
    parsed = JSON.parse(payload) as unknown;
  } catch (error) {
    console.error("[ipc-contract] Failed to parse client-event payload:", error);
    return null;
  }

  if (!validateClientEvent(parsed)) {
    console.error("[ipc-contract] Rejected invalid client-event payload");
    return null;
  }

  return parsed;
}
