import { Controller, Get } from "@nestjs/common";

import { DemoService } from "./demo.service.js";

@Controller("api")
export class ConfigController {
  constructor(private readonly demo: DemoService) {}

  @Get("config")
  config() {
    return this.demo.config();
  }
}
