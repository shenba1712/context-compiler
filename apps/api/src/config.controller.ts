import { Controller, Get, Header } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller("api")
export class ConfigController {
  constructor(private readonly host: HostService) {}

  @Get("config")
  @Header("X-CC-Route-Owner", "nest")
  config() {
    return this.host.config();
  }
}
