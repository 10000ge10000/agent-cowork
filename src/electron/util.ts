import { ipcMain, WebContents, WebFrameMain } from "electron";
import { getUIPath } from "./pathResolver.js";
import { pathToFileURL } from "url";

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

export function validateEventFrame(frame: WebFrameMain) {
    if (isDev() && new URL(frame.url).host === `localhost:${DEV_PORT}`) return;

    if (frame.url !== pathToFileURL(getUIPath()).toString()) throw new Error("Malicious event");
}
