import { ipcMain, WebContents, WebFrameMain } from "electron";
import { getUIPath } from "./pathResolver.js";
import { fileURLToPath } from "url";
import path from "path";

export const DEV_PORT = 5173;

// Checks if you are in development mode
export function isDev(): boolean {
    return process.env.NODE_ENV === "development";
}

// IPC handle wrapper with frame validation
export function ipcMainHandle(
    key: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>
) {
    ipcMain.handle(key, (event, ...args) => {
        if (event.senderFrame) validateEventFrame(event.senderFrame);
        return handler(event, ...args);
    });
}

// IPC send wrapper
export function ipcWebContentsSend(key: string, webContents: WebContents, payload: unknown) {
    webContents.send(key, payload);
}

function normalizePathForCompare(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function filePathFromFrameUrl(frameUrl: string): string | null {
    try {
        const parsedUrl = new URL(frameUrl);
        if (parsedUrl.protocol !== "file:") return null;
        return normalizePathForCompare(fileURLToPath(parsedUrl));
    } catch {
        return null;
    }
}

export function isTrustedEventFrameUrl(frameUrl: string): boolean {
    try {
        const parsedUrl = new URL(frameUrl);
        if (
            isDev() &&
            (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
            parsedUrl.host === `localhost:${DEV_PORT}`
        ) {
            return true;
        }
    } catch {
        return false;
    }

    const actualPath = filePathFromFrameUrl(frameUrl);
    if (!actualPath) return false;

    // Electron 的 loadFile() 在打包后会生成 file:// URL。直接比较 URL 字符串会被
    // 空格编码、大小写、路径分隔符等差异误伤，所以这里统一落到本机文件路径比较。
    return actualPath === normalizePathForCompare(getUIPath());
}

export function validateEventFrame(frame: WebFrameMain) {
    if (!isTrustedEventFrameUrl(frame.url)) {
        throw new Error(`Malicious event: ${frame.url}`);
    }
}
