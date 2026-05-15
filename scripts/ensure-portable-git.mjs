import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, rename, stat } from "node:fs/promises";
import { get } from "node:https";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const VERSION = "2.54.0";
const TAG = "v2.54.0.windows.1";
const ASSET = `PortableGit-${VERSION}-64-bit.7z.exe`;
const URL = `https://github.com/git-for-windows/git/releases/download/${TAG}/${ASSET}`;

const rootDir = resolve(import.meta.dirname, "..");
const vendorDir = join(rootDir, "vendor");
const downloadDir = join(vendorDir, "_downloads");
const archivePath = join(downloadDir, ASSET);
const extractDir = join(downloadDir, `PortableGit-${VERSION}-64-bit`);
const targetDir = join(vendorDir, "git");

function isWindows() {
  return process.platform === "win32";
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function hasPortableGitRuntime(path) {
  return (await exists(join(path, "bin", "bash.exe"))) && (await exists(join(path, "usr", "bin", "bash.exe")));
}

async function download(url, destination) {
  await mkdir(downloadDir, { recursive: true });

  await new Promise((resolvePromise, rejectPromise) => {
    const request = get(url, { headers: { "User-Agent": "Agent-Cowork-Build" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolvePromise, rejectPromise);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        rejectPromise(new Error(`下载 PortableGit 失败：HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolvePromise);
      });
      file.on("error", rejectPromise);
    });

    request.on("error", rejectPromise);
  });
}

async function extractPortableGit() {
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  // PortableGit 是 7-Zip 自解压包。这里不写入系统，不改注册表，只把运行时解压到项目本地缓存目录。
  const result = spawnSync(archivePath, ["-y", `-o${extractDir}`], {
    cwd: rootDir,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`解压 PortableGit 失败：${basename(archivePath)} exited with code ${result.status}`);
  }

  if (!(await hasPortableGitRuntime(extractDir))) {
    throw new Error("解压后的 PortableGit 不包含 bin\\bash.exe 和 usr\\bin\\bash.exe。");
  }
}

async function replaceTarget() {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(extractDir, { withFileTypes: true })) {
    await rename(join(extractDir, entry.name), join(targetDir, entry.name));
  }
}

if (!isWindows()) {
  console.warn("[prepare:git-runtime] 当前不是 Windows，跳过 PortableGit 准备。");
  process.exit(0);
}

if (await hasPortableGitRuntime(targetDir)) {
  console.warn("[prepare:git-runtime] vendor/git 已存在可用 PortableGit，跳过下载。");
  process.exit(0);
}

if (!(await exists(archivePath))) {
  console.warn(`[prepare:git-runtime] 下载 ${ASSET}`);
  await download(URL, archivePath);
}

console.warn("[prepare:git-runtime] 解压 PortableGit 到 vendor/git");
await extractPortableGit();
await replaceTarget();
console.warn("[prepare:git-runtime] PortableGit 准备完成。");
