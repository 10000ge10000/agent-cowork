import { app, BrowserWindow, ipcMain, dialog, globalShortcut, Menu } from "electron"
import { execSync } from "child_process";
import { ipcMainHandle, isDev, DEV_PORT } from "./util.js";
import { getPreloadPath, getUIPath, getIconPath } from "./pathResolver.js";
import { getStaticData, pollResources, stopPolling } from "./test.js";
import { handleClientEvent, sessions, cleanupAllSessions } from "./ipc-handlers.js";
import { generateSessionTitle } from "./libs/util.js";
import { loadPermissionConfig, saveApiConfig, savePermissionConfig } from "./libs/config-store.js";
import { getCurrentApiConfig, normalizeApiConfigForAgent } from "./libs/claude-settings.js";
import { parseClientEventPayload } from "./libs/ipc-contract.js";
import { DEFAULT_PROXY_PORT, startProxy, stopProxy, getProxyStatus } from "./libs/anthropic-proxy.js";
import { testApiConnection } from "./libs/api-connection.js";
import { getPermissionManager } from "./libs/permission-manager.js";
import type { ClientEvent } from "./types.js";
import type { ApiConfig, PermissionConfig } from "../shared/types.js";
import "./libs/claude-settings.js";

let cleanupComplete = false;
let mainWindow: BrowserWindow | null = null;

function killViteDevServer(): void {
    if (!isDev()) return;
    try {
        if (process.platform === 'win32') {
            execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${DEV_PORT}') do taskkill /PID %a /F`, { stdio: 'ignore', shell: 'cmd.exe' });
        } else {
            execSync(`lsof -ti:${DEV_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
        }
    } catch {
        // Process may already be dead
    }
}

function cleanup(): void {
    if (cleanupComplete) return;
    cleanupComplete = true;

    globalShortcut.unregisterAll();
    stopPolling();
    stopProxy(); // 停止代理服务
    cleanupAllSessions();
    killViteDevServer();
}

function handleSignal(): void {
    cleanup();
    app.quit();
}

// Initialize everything when app is ready
app.on("ready", () => {
    Menu.setApplicationMenu(null);
    // Setup event handlers
    app.on("before-quit", cleanup);
    app.on("will-quit", cleanup);
    app.on("window-all-closed", () => {
        cleanup();
        app.quit();
    });

    process.on("SIGTERM", handleSignal);
    process.on("SIGINT", handleSignal);
    process.on("SIGHUP", handleSignal);

    // Create main window
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: getPreloadPath(),
        },
        icon: getIconPath(),
        titleBarStyle: "hiddenInset",
        backgroundColor: "#FAF9F6",
        trafficLightPosition: { x: 15, y: 18 }
    });

    if (isDev()) mainWindow.loadURL(`http://localhost:${DEV_PORT}`)
    else mainWindow.loadFile(getUIPath());

    globalShortcut.register('CommandOrControl+Q', () => {
        cleanup();
        app.quit();
    });

    pollResources(mainWindow);

    ipcMainHandle("getStaticData", () => {
        return getStaticData();
    });

    // Handle client events
    ipcMain.on("client-event", (_event: Electron.IpcMainEvent, event: ClientEvent | string) => {
        const parsedEvent = parseClientEventPayload(event);
        if (!parsedEvent) {
            console.error("[Main] Ignored invalid client-event payload");
            return;
        }
        handleClientEvent(parsedEvent);
    });

    const savedPermissionConfig = loadPermissionConfig();
    if (savedPermissionConfig) {
        getPermissionManager().updateConfig(savedPermissionConfig);
    }

    // Handle session title generation
    ipcMainHandle("generate-session-title", async (_event, userInput) => {
        return generateSessionTitle(userInput as string | null);
    });

    // Handle recent cwds request - 确保 session 已初始化
    ipcMainHandle("get-recent-cwds", (_event, limit) => {
        console.warn("[Main] get-recent-cwds called");
        const boundedLimit = limit ? Math.min(Math.max(limit as number, 1), 20) : 8;

        // 关键修复：发送 session.list 事件会触发 initializeSessions() 创建 SessionStore
        handleClientEvent({ type: "session.list" });

        console.warn("[Main] sessions object:", sessions);

        // 如果 sessions 仍未初始化（极少数情况），返回空数组
        if (!sessions) {
            console.warn("[Main] Sessions not initialized yet, returning empty array");
            return [];
        }
        return sessions.listRecentCwds(boundedLimit);
    });

    // Handle directory selection
    ipcMainHandle("select-directory", async () => {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory']
        });

        if (result.canceled) {
            return null;
        }

        return result.filePaths[0];
    });

    // Handle API config
    ipcMainHandle("get-api-config", () => {
        return getCurrentApiConfig();
    });

    ipcMainHandle("check-api-config", () => {
        const config = getCurrentApiConfig();
        return { hasConfig: config !== null, config };
    });

    ipcMainHandle("get-permission-config", () => {
        return getPermissionManager().getConfig();
    });

    ipcMainHandle("save-permission-config", (_event, config) => {
        try {
            const permissionConfig = config as PermissionConfig;
            savePermissionConfig(permissionConfig);
            const savedConfig = loadPermissionConfig();
            if (savedConfig) {
                getPermissionManager().updateConfig(savedConfig);
            }
            return { success: true };
        } catch (error) {
            console.error("[Main] save-permission-config error:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });

    ipcMainHandle("save-api-config", async (_event, config) => {
        console.warn("[Main] save-api-config called, isPackaged:", app.isPackaged);
        try {
            const apiConfig = normalizeApiConfigForAgent(config as Parameters<typeof saveApiConfig>[0]);
            console.warn("[Main] Saving API config:", { apiType: apiConfig.apiType, baseURL: apiConfig.baseURL, model: apiConfig.model });
            saveApiConfig(apiConfig);
            console.warn("[Main] API config saved successfully");

            // NVIDIA 需要代理
            if (apiConfig.apiType === "nvidia") {
                console.warn("[Main] Starting proxy for NVIDIA...");
                try {
                    const proxyURL = await startProxy({
                        port: DEFAULT_PROXY_PORT,
                        targetBaseURL: apiConfig.baseURL,
                        targetAPIKey: apiConfig.apiKey,
                        targetModel: apiConfig.model
                    });
                    console.warn("[Main] Proxy started for NVIDIA API:", proxyURL);
                } catch (proxyError) {
                    console.error("[Main] Failed to start proxy:", proxyError);
                    return {
                        success: false,
                        error: `代理启动失败: ${proxyError instanceof Error ? proxyError.message : String(proxyError)}`
                    };
                }
            } else {
                // 自定义 API，不需要代理
                console.warn("[Main] Stopping proxy (custom API mode)");
                await stopProxy();
            }

            return { success: true };
        } catch (error) {
            console.error("[Main] save-api-config error:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });

    // 代理状态查询
    ipcMainHandle("get-proxy-status", () => {
        return getProxyStatus();
    });

    // API 连接测试（在主进程执行，避免 CORS）
    ipcMainHandle("test-api-connection", async (_event, config) => {
        const apiConfig = normalizeApiConfigForAgent(config as ApiConfig);
        console.warn("[Main] Starting API connection test...", {
            apiType: apiConfig.apiType,
            baseURL: apiConfig.baseURL,
            model: apiConfig.model,
            hasApiKey: Boolean(apiConfig.apiKey)
        });
        try {
            const result = await testApiConnection(apiConfig);
            console.warn("[Main] API connection test result:", result);
            return result;
        } catch (error) {
            console.error("[Main] Test API connection error:", error);
            return {
                success: false,
                message: `测试失败: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    });

    // 应用启动时检查配置，如果已配置 NVIDIA 则启动代理
    const existingConfig = getCurrentApiConfig();
    if (existingConfig && existingConfig.apiType === "nvidia") {
        startProxy({
            port: DEFAULT_PROXY_PORT,
            targetBaseURL: existingConfig.baseURL,
            targetAPIKey: existingConfig.apiKey,
            targetModel: existingConfig.model
        }).then((proxyURL) => {
            console.warn("[Main] Auto-started proxy for NVIDIA:", proxyURL);
        }).catch((error) => {
            console.error("[Main] Failed to auto-start proxy:", error);
        });
    }
})
