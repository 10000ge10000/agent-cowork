import { isDev } from "./util.js"
import path from "path"
import { app } from "electron"

export function getPreloadPath() {
    // preload.cjs 在 asar 内部，直接使用 app.getAppPath()
    return path.join(app.getAppPath(), 'dist-electron/electron/preload.cjs')
}

export function getUIPath() {
    return path.join(app.getAppPath(), 'dist-react/index.html');
}

export function getIconPath() {
    if (isDev()) {
        return path.join(app.getAppPath(), 'claude-color.png')
    }
    // 生产环境：icon 在 resources 目录（asar 外部）
    return path.join(process.resourcesPath, 'claude-color.png')
}