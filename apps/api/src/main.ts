import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Express } from "express";

import { AppModule } from "./app.module.js";
import { DemoService } from "./demo.service.js";

/**
 * Resolve the shared demo Express app from the repo `dist/` build.
 * Path: apps/api/dist/main.js → ../../../dist/http/demo-app.js
 */
async function loadDemoApp(): Promise<{
  app: Express;
}> {
  const mod = (await import(
    /* webpackIgnore: true */ "../../../dist/http/demo-app.js" as string
  )) as {
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
  const { app: demoApp } = await loadDemoApp();

  // Nest controllers register first; Express demo-app handles upload/SSE routes.
  // Duplicate GET handlers on demo-app remain for unit tests that import `app` alone.
  const nest = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ["error", "warn", "log"],
  });
  nest.use(demoApp);

  const port = intEnv("API_PORT", 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await nest.listen(port, host);
  console.log(`Nest API listening on http://${host}:${port}`);

  const demo = nest.get(DemoService);
  void demo.warmSamples();
}

bootstrap().catch((err) => {
  console.error("Nest API failed to start", err);
  process.exit(1);
});
