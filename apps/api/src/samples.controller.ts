import { Controller, Get, Header } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller("api")
export class SamplesController {
  constructor(private readonly host: HostService) {}

  @Get("samples")
  @Header("X-CC-Route-Owner", "nest")
  samples() {
    return this.host.samples();
  }
}
