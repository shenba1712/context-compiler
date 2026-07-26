import { NextRequest } from "next/server";

import { proxyToApi } from "@/lib/api-proxy";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxyToApi(req, `/api/${path.join("/")}`);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
