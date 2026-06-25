#!/usr/bin/env node
/**
 * Fin-Agent 缁熶竴鍚姩鍣紙Node 鍘熺敓鐗?鈥斺€?鏃犻渶 pnpm/npm锛?
 *
 * 鐩存帴璋冪敤 node_modules 涓殑 CLI 鍏ュ彛锛屽吋瀹规棤鍖呯鐞嗗櫒鐜銆?
 * 鍚姩涓変釜鏈嶅姟锛?
 *   1. backend   鈥?Fastify TS 鍚庣 (port 8000)
 *   2. frontend  鈥?Vite React 鍓嶇 (port 5173)
 *   3. openclaw  鈥?openclaw gateway (port 18789)
 *
 * 鐢ㄦ硶锛?
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

// 鈹€鈹€ 绔彛娓呯悊锛氬惎鍔ㄥ墠鏉€鎺夊崰鐢ㄧ洰鏍囩鍙ｇ殑鏃ц繘绋?鈹€鈹€
const PORTS = { backend: 8000, frontend: 5173, openclaw: 18789 };

function cleanupPorts() {
  const portList = Object.values(PORTS);
  try {
    // 鐩存帴鎵ц netstat锛堟棤 pipe锛夛紝JS 渚цВ鏋愯緭鍑?
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
  } catch {} // 鏃犺繘绋嬪湪鐩戝惉銆乶etstat 鏈韩澶辫触绛夋儏褰竴寰嬮潤榛?
}

import { createRequire } from "module";

// 鈹€鈹€ 宸ュ叿鍑芥暟锛氳В鏋?tsx / vite / openclaw 鐨勫叆鍙?鈹€鈹€
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
    // vite 鐨?bin 璺緞涓嶅湪 exports 涓紝鍏堣В鏋?package.json 鎵€鍦ㄧ洰褰曞啀鎷兼帴
    const pkgPath = requireWebui.resolve("vite/package.json");
    return resolve(dirname(pkgPath), "bin", "vite.js");
  } catch {
    throw new Error("vite not found. Run: pnpm install");
  }
}

function openclawCmd() {
  return { cmd: isWin ? "openclaw.cmd" : "openclaw", args: [] };
}

// 鈹€鈹€ 鏈嶅姟瀹氫箟 鈹€鈹€
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

// 鍚姩鍓嶈嚜鍔ㄦ竻鐞嗗崰鐢ㄧ鍙ｇ殑鑰佽繘绋?
cleanupPorts();

for (let i = 0; i < services.length; i++) {
  const svc = services[i];
  const color = colors[i % colors.length];
  const prefix = `${color}[${svc.name.padEnd(8)}]${reset}`;

  // 鍙€夋湇鍔℃娴?
  if (svc.optional && !existsSync(svc.cmd)) {
    console.log(`${prefix} SKIPPED (not installed: ${svc.cmd})`);
    continue;
  }

  // Windows 上 .cmd/.bat 不能直接 spawn，需通过 cmd.exe /c
  const isCmdFile = isWin && /\.(cmd|bat)$/i.test(svc.cmd);
  const child = spawn(isCmdFile ? "cmd.exe" : svc.cmd, isCmdFile ? ["/c", svc.cmd, ...svc.args] : svc.args, {
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

// 淇濆瓨 PID 鏂囦欢
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

// Windows 娌℃湁 SIGINT 浼犳挱鍒板瓙杩涚▼锛岄渶瑕侀澶栧鐞?
if (isWin) {
  process.on("exit", cleanup);
}
