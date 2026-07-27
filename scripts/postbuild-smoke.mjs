import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { copyStandaloneAssets, findStandaloneServer } from "./standalone-assets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "apps/web");

function filesUnder(directory) {
  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      const stat = lstatSync(full);
      assert.equal(stat.isSymbolicLink(), false, `standalone asset must be dereferenced: ${full}`);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files.push(full);
    }
  };
  visit(directory);
  return files;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const standaloneServer = findStandaloneServer(webDir);
assert.ok(standaloneServer, "Next standalone server must exist after npm run build");
copyStandaloneAssets(webDir, standaloneServer);
const standaloneRoot = dirname(standaloneServer);
const samples = filesUnder(join(standaloneRoot, "public/samples"));
const staticFiles = filesUnder(join(standaloneRoot, ".next/static"));
assert.ok(samples.length > 0, "standalone samples must contain real files");
assert.ok(
  staticFiles.some((file) => file.endsWith(".css")),
  "standalone static assets must contain CSS"
);

const apiPort = await freePort();
const child = spawn(process.execPath, [join(root, "apps/api/dist/main.js")], {
  cwd: root,
  env: { ...process.env, API_HOST: "127.0.0.1", API_PORT: String(apiPort), NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});

try {
  for (const path of ["/healthz", "/api/config", "/api/samples"]) {
    const response = await waitFor(`http://127.0.0.1:${apiPort}${path}`);
    assert.equal(response.headers.get("x-cc-route-owner"), "nest", `${path} must be owned by Nest`);
  }
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : error}\n${output}`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

console.log(
  `Post-build smoke passed: ${samples.length} samples, CSS present, Nest owns health/config/samples.`
);
