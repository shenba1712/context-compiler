import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";

/**
 * Nest owns process bootstrap and listen bind. Demo HTTP routes live in the
 * shared Express app (`src/http/demo-app.ts`) mounted from main.ts.
 */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
