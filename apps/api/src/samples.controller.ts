import { Controller, Get } from "@nestjs/common";

import { DemoService } from "./demo.service.js";

@Controller("api")
export class SamplesController {
  constructor(private readonly demo: DemoService) {}

  @Get("samples")
  samples() {
    return this.demo.samples();
  }
}
