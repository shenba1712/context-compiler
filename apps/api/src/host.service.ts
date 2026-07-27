import { Injectable } from "@nestjs/common";

@Injectable()
export class HostService {
  async config(): Promise<Record<string, unknown>> {
    const { getApiConfig } = (await import("../../../dist/http/config.js" as string)) as {
      getApiConfig: () => Record<string, unknown>;
    };
    return getApiConfig();
  }

  async samples(): Promise<unknown[]> {
    const { getSamplesCatalog } = (await import("../../../dist/http/samples-catalog.js" as string)) as {
      getSamplesCatalog: () => unknown[];
    };
    return getSamplesCatalog();
  }

  async warmSamples(): Promise<void> {
    const { warmSampleTokenCache } = (await import("../../../dist/http/samples-catalog.js" as string)) as {
      warmSampleTokenCache: () => Promise<void>;
    };
    await warmSampleTokenCache();
  }

  healthz() {
    return { status: "ok" as const, uptime_s: Math.round(process.uptime()) };
  }
}
