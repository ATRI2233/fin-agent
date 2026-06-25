#!/usr/bin/env node
/**
 * Fin-Agent 统一启动器（Node 原生版 —— 无需 pnpm/npm）
 *
 * 直接调用 node_modules 中的 CLI 入口，兼容无包管理器环境。
 * 启动三个服务：
 *   1. backend   — Fastify TS 后端 (port 8000)
 *   2. frontend  — Vite React 前端 (port 5173)
 *   3. openclaw  — openclaw gateway (port 18789)
 *
 * 用法：
 *   cd project && node config/start-all.mjs
 */
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const isWin = process.platform === "win32";
const reset = "\x1b[0m";
const colors = ["\x1b[36m", "\x1b[32m", "\x1b[35m", "\x1b[33m"]; // cyan, green, magenta, yellow

// ── 端口清理：启动前杀掉占用目标端口的旧进程 ──
const PORTS = { backend: 8000, frontend: 5173, openclaw: 18789 };

function cleanupPorts() {
  const portList = Object.values(PORTS);
  try {
    // 直接执行 netstat（无 pipe），JS 侧解析输出
    const output = execSync("netstat -aon -p TCP", { encoding: "utf8", timeout: 5000 });
    const killed = new Set();
    for (const line of output.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+.*?:(\d+)\s+.*?LISTENING\s+(\d+)$/im);
      if (m && portList.includes(Number(m[1]))) {
        const pid = m[2];
        if (!killed.has(pid)) {
          try {
            execSync(isWin ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`, { stdio: "ignore", timeout: 3000 });
            const port = m[1];
            console.log(`  Killed old process on port ${port} (PID ${pid})`);
          } catch {}
          killed.add(pid);
        }
      }
    }
  } catch {} // 无进程在监听、netstat 本身失败等情形一律静默
}

import { createRequire } from "module";

// ── 工具函数：解析 tsx / vite / openclaw 的入口 ──
const requireRoot = createRequire(resolve(projectRoot, "package.json"));
const requireWebui = createRequire(resolve(projectRoot, "src/webui/package.json"));

function tsxPath() {
  try {
    return requireRoot.resolve("tsx/cli");
  } catch {
    throw new Error("tsx not found. Run: pnpm install");
  }
}

function vitePath() {
  try {
    // vite 的 bin 路径不在 exports 中，先解析 package.json 所在目录再拼接
    const pkgPath = requireWebui.resolve("vite/package.json");
    return resolve(dirname(pkgPath), "bin", "vite.js");
  } catch {
    throw new Error("vite not found. Run: pnpm install");
  }
}

function openclawCmd() {
  return { cmd: isWin ? "openclaw.cmd" : "openclaw", args: [] };
}

// ── 服务定义 ──
const services = [
  {
    name: "backend",
    cmd: process.execPath,
    args: [tsxPath(), "watch", "src/server/index.ts"],
    cwd: projectRoot,
  },
  {
    name: "frontend",
    cmd: process.execPath,
    args: [vitePath()],
    cwd: resolve(projectRoot, "src", "webui"),
  },
  {
    name: "openclaw",
    ...openclawCmd(),
    args: ["gateway"],
    cwd: projectRoot,
  },
];

const children = [];
const pidMap = {};

mkdirSync(resolve(projectRoot, "config", "logs"), { recursive: true });

console.log("Starting all services...\n");

// 启动前自动清理占用端口的老进程
cleanupPorts();

for (let i = 0; i < services.length; i++) {
  const svc = services[i];
  const color = colors[i % colors.length];
  const prefix = `${color}[${svc.name.padEnd(8)}]${reset}`;

  // 可选服务检测
  if (svc.optional && !existsSync(svc.cmd)) {
    console.log(`${prefix} SKIPPED (not installed: ${svc.cmd})`);
    continue;
  }

  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  children.push(child);
  pidMap[svc.name] = child.pid;

  child.stdout.on("data", (data) => {
    data
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .forEach((line) => console.log(`${prefix} ${line}`));
  });

  child.stderr.on("data", (data) => {
    data
      .toString()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .forEach((line) => console.error(`${prefix} ${color}ERR${reset} ${line}`));
  });

  child.on("exit", (code) => {
    console.log(`${prefix} exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error(`${prefix} failed to start: ${err.message}`);
  });
}

// 保存 PID 文件
for (const [name, pid] of Object.entries(pidMap)) {
  writeFileSync(resolve(projectRoot, "config", "logs", `${name}.pid`), String(pid));
}

console.log("\nAll services started.");
console.log("  Backend : http://localhost:8000  (PID " + (pidMap.backend || "N/A") + ")");
console.log("  Frontend: http://localhost:5173  (PID " + (pidMap.frontend || "N/A") + ")");
console.log("  OpenClaw: http://localhost:18789  (PID " + (pidMap.openclaw || "N/A") + ")");
console.log("\nPress Ctrl+C to stop all.\n");

const cleanup = () => {
  console.log("\n\nStopping all services...");
  children.forEach((c) => {
    try {
      c.kill();
    } catch {}
  });
  setTimeout(() => process.exit(0), 500);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Windows 没有 SIGINT 传播到子进程，需要额外处理
if (isWin) {
  process.on("exit", cleanup);
}
