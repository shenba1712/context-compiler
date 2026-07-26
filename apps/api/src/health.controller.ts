import { Controller, Get } from "@nestjs/common";

import { DemoService } from "./demo.service.js";

@Controller()
export class HealthController {
  constructor(private readonly demo: DemoService) {}

  /** Render / platform liveness — must stay cheap (no markitdown). */
  @Get("healthz")
  healthz() {
    return this.demo.healthz();
  }
}
