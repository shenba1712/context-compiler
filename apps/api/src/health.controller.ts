import { Controller, Get, Header } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller()
export class HealthController {
  constructor(private readonly host: HostService) {}

  /** Platform liveness — must stay cheap (no markitdown). */
  @Get("healthz")
  @Header("X-CC-Route-Owner", "nest")
  healthz() {
    return this.host.healthz();
  }
}
