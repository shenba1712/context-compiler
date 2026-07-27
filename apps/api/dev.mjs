import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const compilerCommand = process.platform === "win32" ? "tsc.cmd" : "tsc";
const apiDirectory = fileURLToPath(new URL(".", import.meta.url));
const children = new Set();
let stopping = false;
let server;
let restartTimer;
let restartingServer = false;

function spawnChild(command, args, label, onExit, stdio = "inherit") {
  const child = spawn(command, args, {
    cwd: apiDirectory,
    env: process.env,
    stdio,
  });
  children.add(child);

  child.on("error", (error) => {
    console.error(`[api:dev] ${label} failed to start:`, error);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    if (onExit?.(code, signal)) return;
    console.error(`[api:dev] ${label} exited (${signal ?? code ?? "unknown"}); stopping supervisor.`);
    stop("SIGTERM", code || 1);
  });

  return child;
}

function startServer() {
  server = spawnChild(process.execPath, ["dist/main.js"], "API server", () => {
    if (!restartingServer) return false;
    restartingServer = false;
    startServer();
    return true;
  });
}

function scheduleServerRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping) return;
    restartingServer = true;
    server.kill("SIGTERM");
  }, 150);
}

function stop(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  process.exitCode = exitCode;
  for (const child of children) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const compiler = spawnChild(
  compilerCommand,
  ["-p", "tsconfig.json", "--watch", "--preserveWatchOutput"],
  "TypeScript watcher",
  undefined,
  ["inherit", "pipe", "inherit"]
);
let compilerOutput = "";
let compilerReady = false;
compiler.stdout.setEncoding("utf8");
compiler.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  compilerOutput += chunk;
  if (compilerOutput.includes("Watching for file changes.")) {
    if (compilerReady) scheduleServerRestart();
    compilerReady = true;
    compilerOutput = "";
  } else {
    compilerOutput = compilerOutput.slice(-100);
  }
});

startServer();
