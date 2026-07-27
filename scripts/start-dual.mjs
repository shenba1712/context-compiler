#!/usr/bin/env node
/**
 * Production dual-process entry: Nest API on 127.0.0.1:API_PORT, Next on PORT.
 * Next rewrites /api, /healthz, /metrics to Nest (API_PORT must match next build).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyStandaloneAssets, findStandaloneServer } from "./standalone-assets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = validPort("API_PORT", process.env.API_PORT ?? "4000");
const apiHost = process.env.API_HOST ?? "127.0.0.1";
const publicPort = validPort("PORT", process.env.PORT ?? "8000");

const apiEntry = join(root, "apps/api/dist/main.js");
const webDir = join(root, "apps/web");

function validPort(name, value) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return String(port);
}

if (!existsSync(apiEntry)) {
  console.error("Missing apps/api/dist/main.js — run npm run build first");
  process.exit(1);
}

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode !== null || c.signalCode !== null) continue;
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd ?? root,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Failed to start ${cmd}:`, error);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`${cmd} exited unexpectedly${signal ? ` with ${signal}` : ` with code ${code ?? 1}`}`);
      shutdown(code && code !== 0 ? code : 1);
    }
  });
  return child;
}

async function waitForApi(ms = 60_000) {
  const url = `http://${apiHost}:${apiPort}/healthz`;
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Nest API did not become ready at ${url}`);
}

console.log(`Starting Nest API on ${apiHost}:${apiPort}`);
run(process.execPath, [apiEntry], {
  env: { API_PORT: apiPort, API_HOST: apiHost },
});

try {
  await waitForApi();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  shutdown(1);
}

const nextServer = findStandaloneServer(webDir);
if (nextServer) {
  try {
    const assetRoot = copyStandaloneAssets(webDir, nextServer);
    console.log(`Validated standalone assets under apps/web/${assetRoot}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    shutdown(1);
  }
  console.log(`Starting Next standalone on 0.0.0.0:${publicPort}`);
  run(process.execPath, [nextServer], {
    cwd: join(webDir, ".next/standalone"),
    env: {
      PORT: publicPort,
      HOSTNAME: "0.0.0.0",
      API_PORT: apiPort,
      API_HOST: apiHost,
    },
  });
} else {
  console.log(`Starting Next (next start) on ${publicPort}`);
  const nextBin = [
    join(webDir, "node_modules/next/dist/bin/next"),
    join(root, "node_modules/next/dist/bin/next"),
  ].find((p) => existsSync(p));
  if (!nextBin) {
    console.error("next binary not found");
    shutdown(1);
  }
  run(process.execPath, [nextBin, "start", "-p", publicPort, "-H", "0.0.0.0"], {
    cwd: webDir,
    env: { PORT: publicPort, API_PORT: apiPort, API_HOST: apiHost },
  });
}
