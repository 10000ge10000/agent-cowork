import { describe, expect, it } from "vitest";
import type { ClientEvent } from "../../types.js";
import { parseClientEventPayload } from "../ipc-contract.js";

describe("IPC client-event contract", () => {
  it("should accept object payloads from renderer process", () => {
    const event: ClientEvent = { type: "session.list" };

    expect(parseClientEventPayload(event)).toEqual(event);
  });

  it("should parse JSON payloads sent by preload", () => {
    const event: ClientEvent = {
      type: "session.start",
      payload: {
        title: "Test Session",
        prompt: "Hello",
        cwd: "C:\\work",
        allowedTools: "Read,Edit,Bash",
      },
    };

    expect(parseClientEventPayload(JSON.stringify(event))).toEqual(event);
  });

  it("should reject malformed JSON payloads without throwing", () => {
    expect(parseClientEventPayload("{bad json")).toBeNull();
  });

  it("should reject unknown event types", () => {
    expect(parseClientEventPayload(JSON.stringify({ type: "session.nuke" }))).toBeNull();
  });

  it("should reject events with missing required payload fields", () => {
    expect(parseClientEventPayload(JSON.stringify({ type: "session.start", payload: { title: "No prompt" } }))).toBeNull();
    expect(parseClientEventPayload(JSON.stringify({ type: "session.delete", payload: {} }))).toBeNull();
  });

  it("should reject permission responses without a valid result", () => {
    expect(parseClientEventPayload(JSON.stringify({
      type: "permission.response",
      payload: {
        sessionId: "session-id",
        toolUseId: "tool-id",
        result: { behavior: "ask-user" },
      },
    }))).toBeNull();
  });
});
