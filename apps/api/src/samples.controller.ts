import { Controller, Get } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller("api")
export class SamplesController {
  constructor(private readonly host: HostService) {}

  @Get("samples")
  samples() {
    return this.host.samples();
  }
}
