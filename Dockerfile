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

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY apps ./apps
COPY scripts ./scripts
COPY README.md ARCHITECTURE.md ./

# Nest listens here; Next proxies to it at runtime via Route Handlers.
ENV API_PORT=4000
ENV API_HOST=127.0.0.1
ENV NEXT_TELEMETRY_DISABLED=1

RUN set -eux; \
    npm run build; \
    node scripts/standalone-assets.mjs --copy; \
    npm prune --omit=dev

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
