import { spawn } from "node:child_process";
import process from "node:process";

/**
 * 跨平台开发启动器。
 *
 * 原来的 package.json 直接写了 pkill / sleep / &，这些都是 Unix Shell 习惯用法；
 * 在 Windows PowerShell 或 cmd 下会直接失效。这里改成 Node 脚本统一编排：
 * - React/Vite 和 Electron 分别作为子进程启动；
 * - Windows 与 Linux/macOS 都复用同一套逻辑；
 * - 任意一个子进程退出时，主动清理另一个，避免留下悬挂进程占端口。
 */
const commands = [
  { name: "react", command: "bun", args: ["run", "dev:react"] },
  { name: "electron", command: "bun", args: ["run", "dev:electron"] },
];

const children = new Map();
let shuttingDown = false;

function spawnProcess({ name, command, args }) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  children.set(name, child);

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.warn(`[dev] ${name} exited with ${reason}; stopping dev stack.`);
    shutdown(code ?? 0);
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children.values()) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

for (const command of commands) {
  spawnProcess(command);
}
