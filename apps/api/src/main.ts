import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Express, NextFunction, Request, Response } from "express";

import { AppModule } from "./app.module.js";
import { HostService } from "./host.service.js";

/**
 * Resolve the shared Express HTTP app from the repo `dist/` build.
 * Path: apps/api/dist/main.js → ../../../dist/http/app.js
 */
async function loadHttpApp(): Promise<{ app: Express }> {
  const mod = (await import(/* webpackIgnore: true */ "../../../dist/http/app.js" as string)) as {
    app: Express;
  };
  return mod;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function bootstrap() {
  const { app: httpApp } = await loadHttpApp();

  const nest = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ["error", "warn", "log"],
  });
  // These reads are implemented by Nest controllers. Letting the shared
  // Express app answer them here would shadow the controllers because Nest
  // middleware is registered before controller routes.
  nest.use((req: Request, res: Response, next: NextFunction) => {
    const nestOwned =
      req.method === "GET" &&
      (req.path === "/healthz" || req.path === "/api/config" || req.path === "/api/samples");
    if (nestOwned) return next();
    return httpApp(req, res, next);
  });

  const port = intEnv("API_PORT", 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await nest.listen(port, host);
  console.log(`Nest API listening on http://${host}:${port}`);

  const svc = nest.get(HostService);
  void svc.warmSamples();
}

bootstrap().catch((err) => {
  console.error("Nest API failed to start", err);
  process.exit(1);
});
