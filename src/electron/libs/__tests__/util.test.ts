import { beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "url";

const mocks = vi.hoisted(() => ({
  getUIPath: vi.fn(),
}));

vi.mock("../../pathResolver.js", () => ({
  getUIPath: mocks.getUIPath,
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe("isTrustedEventFrameUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "production";
    mocks.getUIPath.mockReturnValue("C:\\Users\\Administrator\\Documents\\Worker Man\\Claude-Cowork\\dist-react\\index.html");
  });

  it("should trust packaged file URLs even when the path contains spaces", async () => {
    const { isTrustedEventFrameUrl } = await import("../../util.js");

    const frameUrl = pathToFileURL(
      "C:\\Users\\Administrator\\Documents\\Worker Man\\Claude-Cowork\\dist-react\\index.html"
    ).toString();

    expect(frameUrl).toContain("Worker%20Man");
    expect(isTrustedEventFrameUrl(frameUrl)).toBe(true);
  });

  it("should trust the packaged UI entry when Electron adds a hash fragment", async () => {
    const { isTrustedEventFrameUrl } = await import("../../util.js");

    const frameUrl = `${pathToFileURL(
      "C:\\Users\\Administrator\\Documents\\Worker Man\\Claude-Cowork\\dist-react\\index.html"
    ).toString()}#/settings`;

    expect(isTrustedEventFrameUrl(frameUrl)).toBe(true);
  });

  it("should reject file URLs outside the packaged UI entry", async () => {
    const { isTrustedEventFrameUrl } = await import("../../util.js");

    expect(isTrustedEventFrameUrl(pathToFileURL("C:\\tmp\\index.html").toString())).toBe(false);
  });

  it("should trust the Vite dev server only in development mode", async () => {
    const { isTrustedEventFrameUrl } = await import("../../util.js");

    process.env.NODE_ENV = "development";
    expect(isTrustedEventFrameUrl("http://localhost:5173/")).toBe(true);

    process.env.NODE_ENV = "production";
    expect(isTrustedEventFrameUrl("http://localhost:5173/")).toBe(false);
  });
});
