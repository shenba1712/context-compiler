/**
 * Test/helper entry: exports the shared demo Express app from http/demo-app.
 * Production serves Next (`apps/web`) + Nest (`apps/api`) via `npm run web`.
 */
import { pathToFileURL } from "node:url";

import { intEnv } from "./env.js";
import { app, warmSampleTokenCache } from "./http/demo-app.js";
import { log } from "./log.js";

export { app };

const PORT = intEnv("PORT", 8000, 0, 65535);

/** Direct listen only for ad-hoc API debugging (no Next UI). Prefer `npm run web`. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  app.listen(PORT, "0.0.0.0", () => {
    log.info("Context Compiler API-only listening (no Next UI)", { url: `http://0.0.0.0:${PORT}` });
    void warmSampleTokenCache();
  });
}
