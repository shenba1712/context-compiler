import { NextRequest, NextResponse } from "next/server";

/** Nest origin — read at request time (not baked into next.config rewrites). */
export function apiOrigin(): string {
  const host = process.env.API_HOST ?? "127.0.0.1";
  const port = process.env.API_PORT ?? "4000";
  return `http://${host}:${port}`;
}

export async function proxyToApi(req: NextRequest, path: string): Promise<Response> {
  const url = new URL(path, apiOrigin());
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("connection");

  const init: RequestInit = {
    method: req.method,
    headers,
    // Duplex required for streaming request bodies in Node fetch.
    // @ts-expect-error duplex is valid for Node undici
    duplex: "half",
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  const upstream = await fetch(url, init);

  // Pass through status, headers, and body (including SSE streams).
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("transfer-encoding");
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}
