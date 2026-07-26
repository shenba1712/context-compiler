import { Module } from "@nestjs/common";

import { ConfigController } from "./config.controller.js";
import { HealthController } from "./health.controller.js";
import { HostService } from "./host.service.js";
import { SamplesController } from "./samples.controller.js";

/**
 * Nest owns GET /healthz, /api/config, /api/samples via controllers + HostService.
 * Upload/SSE routes remain on the shared Express app (`src/http/app.ts`) mounted in main.ts.
 */
@Module({
  controllers: [HealthController, ConfigController, SamplesController],
  providers: [HostService],
})
export class AppModule {}
