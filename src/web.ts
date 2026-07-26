/**
 * Legacy single-process entry: Express demo API + static UI from public/.
 * Production dual-process deploy uses Nest (apps/api) + Next (apps/web) instead.
 *
 * Run: npm run web   ->  http://localhost:8000
 */
import { pathToFileURL } from "node:url";

import { intEnv } from "./env.js";
import { app, warmSampleTokenCache } from "./http/demo-app.js";
import { log } from "./log.js";

export { app };

const PORT = intEnv("PORT", 8000, 0, 65535);

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  app.listen(PORT, "0.0.0.0", () => {
    log.info("Context Compiler demo listening", { url: `http://0.0.0.0:${PORT}` });
    void warmSampleTokenCache();
  });
}
