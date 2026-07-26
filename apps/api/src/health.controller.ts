import { Controller, Get } from "@nestjs/common";

/**
 * Nest-native liveness (also available via mounted demo-app `/healthz`).
 * Useful as a Nest module foothold without duplicating demo route logic.
 */
@Controller()
export class HealthController {
  @Get("nest-health")
  nestHealth() {
    return { status: "ok", surface: "nest" };
  }
}
