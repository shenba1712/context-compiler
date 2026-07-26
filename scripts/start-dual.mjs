#!/usr/bin/env node
/**
 * Production dual-process entry: Nest API on 127.0.0.1:API_PORT, Next on PORT.
 * Next rewrites /api, /healthz, /metrics to Nest (API_PORT must match next build).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = process.env.API_PORT ?? "4000";
const apiHost = process.env.API_HOST ?? "127.0.0.1";
const publicPort = process.env.PORT ?? "8000";

const apiEntry = join(root, "apps/api/dist/main.js");
const webDir = join(root, "apps/web");
const standaloneCandidates = [
  join(webDir, ".next/standalone/apps/web/server.js"),
  join(webDir, ".next/standalone/server.js"),
];

if (!existsSync(apiEntry)) {
  console.error("Missing apps/api/dist/main.js — run npm run build first");
  process.exit(1);
}

const children = [];

function shutdown(code = 0) {
  for (const c of children) {
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
  child.on("exit", (code, signal) => {
    if (signal) shutdown(1);
    else if (code && code !== 0) shutdown(code);
  });
  return child;
}

async function waitForApi(ms = 60_000) {
  const url = `http://${apiHost}:${apiPort}/healthz`;
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
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

const nextServer = standaloneCandidates.find((p) => existsSync(p));
if (nextServer) {
  console.log(`Starting Next standalone on 0.0.0.0:${publicPort}`);
  // Copy static assets expectation: Dockerfile places public + .next/static into standalone
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
