import { Controller, Get } from "@nestjs/common";

import { HostService } from "./host.service.js";

@Controller("api")
export class ConfigController {
  constructor(private readonly host: HostService) {}

  @Get("config")
  config() {
    return this.host.config();
  }
}
