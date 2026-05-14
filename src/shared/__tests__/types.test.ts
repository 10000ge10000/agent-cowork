/**
 * 共享类型系统测试
 *
 * 验证类型定义的正确性和类型守卫函数
 */
import { describe, it, expect } from "vitest";
import {
  isUserPromptMessage,
  isSDKMessage,
  isActiveSession,
  type SessionStatus,
  type ServerEvent,
  type ClientEvent,
} from "../index.js";

describe("Type Guards", () => {
  describe("isUserPromptMessage", () => {
    it("should return true for user_prompt message", () => {
      const msg = { type: "user_prompt" as const, prompt: "Hello" };
      expect(isUserPromptMessage(msg)).toBe(true);
    });

    it("should return false for SDK message", () => {
      const msg = { type: "assistant", message: { content: [] } };
      expect(isUserPromptMessage(msg)).toBe(false);
    });
  });

  describe("isSDKMessage", () => {
    it("should return true for SDK message types", () => {
      const msg = { type: "assistant", message: { content: [] } };
      expect(isSDKMessage(msg)).toBe(true);
    });

    it("should return false for user_prompt message", () => {
      const msg = { type: "user_prompt" as const, prompt: "Hello" };
      expect(isSDKMessage(msg)).toBe(false);
    });
  });

  describe("isActiveSession", () => {
    it("should return true for running status", () => {
      expect(isActiveSession("running")).toBe(true);
    });

    it("should return true for idle status", () => {
      expect(isActiveSession("idle")).toBe(true);
    });

    it("should return false for completed status", () => {
      expect(isActiveSession("completed")).toBe(false);
    });

    it("should return false for error status", () => {
      expect(isActiveSession("error")).toBe(false);
    });
  });
});

describe("Type Definitions", () => {
  it("should accept valid SessionStatus values", () => {
    const statuses: SessionStatus[] = ["idle", "running", "completed", "error"];
    expect(statuses).toHaveLength(4);
  });

  it("should accept valid ServerEvent types", () => {
    const event: ServerEvent = {
      type: "session.status",
      payload: {
        sessionId: "test-id",
        status: "running",
      },
    };
    expect(event.type).toBe("session.status");
  });

  it("should accept valid ClientEvent types", () => {
    const event: ClientEvent = {
      type: "session.start",
      payload: {
        title: "Test Session",
        prompt: "Hello Claude",
      },
    };
    expect(event.type).toBe("session.start");
  });

  it("should accept session.list event without payload", () => {
    const event: ClientEvent = {
      type: "session.list",
    };
    expect(event.type).toBe("session.list");
  });
});
