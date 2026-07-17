/**
 * Path confinement for the MCP server: a requested file must resolve to a real
 * path inside CC_ROOT. Extracted from server.ts so it can be unit-tested
 * without booting the stdio transport.
 *
 * The critical property: symlinks are resolved (realpath) BEFORE the
 * containment check, so a symlink placed inside the root that points outside
 * it (e.g. at ~/.ssh/id_rsa) cannot escape confinement.
 */
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export function checkPathWithin(root: string, filePath: string): string {
  const realRoot = realpathSync(resolve(root));
  const requested = resolve(filePath.replace(/^~(?=$|\/)/, homedir()));
  const st = statSync(requested, { throwIfNoEntry: false });
  if (!st?.isFile()) {
    throw new Error(`Not a file: ${requested}`);
  }
  const real = realpathSync(requested);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(`Access denied: resolved path is outside allowed root ${realRoot}`);
  }
  return real;
}
