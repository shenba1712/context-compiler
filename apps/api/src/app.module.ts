import { Module } from "@nestjs/common";

import { ConfigController } from "./config.controller.js";
import { DemoService } from "./demo.service.js";
import { HealthController } from "./health.controller.js";
import { SamplesController } from "./samples.controller.js";

/**
 * Nest owns GET /healthz, /api/config, /api/samples via controllers + DemoService.
 * Upload/SSE routes remain on the shared Express demo-app mounted in main.ts.
 */
@Module({
  controllers: [HealthController, ConfigController, SamplesController],
  providers: [DemoService],
})
export class AppModule {}
