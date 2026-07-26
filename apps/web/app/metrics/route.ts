import { NextRequest } from "next/server";

import { proxyToApi } from "@/lib/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return proxyToApi(req, "/metrics");
}
