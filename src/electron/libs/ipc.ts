/**
 * 类型安全的 IPC 通信包装器
 *
 * 提供编译时类型检查的 IPC 调用方法，防止消息格式错误。
 */
import { BrowserWindow, ipcMain, ipcRenderer, type IpcMainEvent, type IpcRendererEvent } from "electron";
import type { ServerEvent, ClientEvent, IpcInvokeMapping } from "../../shared/types.js";

/**
 * 主进程 IPC 发送器
 */
export class IpcSender {
  constructor(private window: BrowserWindow) {}

  /**
   * 发送服务端事件到渲染进程（类型安全）
   */
  sendServerEvent(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    this.window.webContents.send("server-event", payload);
  }

  /**
   * 批量发送到所有窗口
   */
  broadcast(event: ServerEvent, windows: BrowserWindow[]): void {
    const payload = JSON.stringify(event);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("server-event", payload);
      }
    }
  }
}

/**
 * 主进程 IPC 接收器
 */
export class IpcReceiver {
  /**
   * 注册客户端事件处理器（类型安全）
   */
  onClientEvent(handler: (event: ClientEvent, reply: (response: ServerEvent) => void) => void): void {
    ipcMain.on("client-event", (_event: IpcMainEvent, payload: string) => {
      try {
        const clientEvent = JSON.parse(payload) as ClientEvent;
        const reply = (response: ServerEvent) => {
          _event.reply("server-event", JSON.stringify(response));
        };
        handler(clientEvent, reply);
      } catch (error) {
        console.error("[IPC] Failed to parse client event:", error);
      }
    });
  }

  /**
   * 注册类型安全的 invoke 处理器
   */
  handle<Key extends keyof IpcInvokeMapping>(
    channel: Key,
    handler: (...args: unknown[]) => Promise<IpcInvokeMapping[Key]> | IpcInvokeMapping[Key]
  ): void {
    ipcMain.handle(channel, async (_event, ...args) => {
      return handler(...args);
    });
  }
}

/**
 * 渲染进程 IPC 客户端（类型安全）
 *
 * 注意：此类主要用于 preload 脚本中，渲染进程通过 window.electron 使用
 */
export class IpcClient {
  /**
   * 发送客户端事件（类型安全）
   */
  sendClientEvent(event: ClientEvent): void {
    ipcRenderer.send("client-event", JSON.stringify(event));
  }

  /**
   * 订阅服务端事件（类型安全）
   */
  onServerEvent(callback: (event: ServerEvent) => void): () => void {
    const handler = (_event: IpcRendererEvent, payload: string): void => {
      try {
        const serverEvent = JSON.parse(payload) as ServerEvent;
        callback(serverEvent);
      } catch (error) {
        console.error("[IPC] Failed to parse server event:", error);
      }
    };
    ipcRenderer.on("server-event", handler);
    return () => ipcRenderer.removeListener("server-event", handler);
  }

  /**
   * 类型安全的 invoke 调用
   */
  async invoke<Key extends keyof IpcInvokeMapping>(
    channel: Key,
    ...args: unknown[]
  ): Promise<IpcInvokeMapping[Key]> {
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeMapping[Key]>;
  }
}

/**
 * 创建 IPC 客户端实例（用于 preload）
 */
export function createIpcClient(): IpcClient {
  return new IpcClient();
}

/**
 * 创建 IPC 发送器实例（用于主进程）
 */
export function createIpcSender(window: BrowserWindow): IpcSender {
  return new IpcSender(window);
}

/**
 * 创建 IPC 接收器实例（用于主进程）
 */
export function createIpcReceiver(): IpcReceiver {
  return new IpcReceiver();
}