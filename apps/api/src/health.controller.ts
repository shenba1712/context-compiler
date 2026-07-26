import { Controller, Get } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller()
export class HealthController {
  constructor(private readonly host: HostService) {}

  /** Platform liveness — must stay cheap (no markitdown). */
  @Get("healthz")
  healthz() {
    return this.host.healthz();
  }
}
