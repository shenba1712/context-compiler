# Single image: Nest API (localhost) + Next UI (public) + Python markitdown.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages "markitdown[docx,pdf,xlsx,pptx]" \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
COPY apps ./apps
COPY scripts ./scripts
COPY README.md ARCHITECTURE.md ./

# Nest listens here; Next rewrites are resolved at build time against this port.
ENV API_PORT=4000
ENV API_HOST=127.0.0.1
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build \
    && mkdir -p apps/web/.next/standalone/apps/web \
    && cp -R apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null || \
       cp -R apps/web/public apps/web/.next/standalone/public \
    && mkdir -p apps/web/.next/standalone/apps/web/.next \
    && cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static 2>/dev/null || \
       (mkdir -p apps/web/.next/standalone/.next && cp -R apps/web/.next/static apps/web/.next/standalone/.next/static) \
    && npm prune --omit=dev

ENV PORT=8000
ENV CC_CACHE_DIR=/tmp/cc-cache
ENV CC_MAX_FILE_BYTES=20971520
ENV CC_RATE_LIMIT=100
ENV CC_RATE_COST_AGENT=12
ENV CC_RATE_COST_ANSWER=4
ENV CC_MAX_CONCURRENT_LLM=2
ENV CC_MAX_CONCURRENT_CONVERSIONS=3
ENV CC_MAX_QUEUED_CONVERSIONS=12
ENV CC_LLM_TIMEOUT_MS=30000

EXPOSE 8000
CMD ["node", "scripts/start-dual.mjs"]
