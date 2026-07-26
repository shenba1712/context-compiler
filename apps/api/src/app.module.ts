import { Module } from "@nestjs/common";

/**
 * Nest hosts the demo HTTP surface. Route implementations live in the shared
 * Express app (`src/http/demo-app.ts`) mounted via ExpressAdapter in main.ts —
 * Nest owns process bootstrap, listen bind, and future module growth.
 */
@Module({})
export class AppModule {}
