# Single image: Node app + Python markitdown converter binary.
FROM node:22-slim

# Python + markitdown (the external converter, like installing ffmpeg)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages "markitdown[docx,pdf,xlsx,pptx]" \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
COPY README.md ARCHITECTURE.md DEMO_SCRIPT.md ./
RUN npm run build && npm prune --omit=dev

ENV PORT=8000
ENV CC_CACHE_DIR=/tmp/cc-cache
# Hackathon / public-demo posture: pin the abuse knobs so a redeploy can't
# accidentally fall back to "wide open" if someone clears dashboard env.
ENV CC_MAX_FILE_BYTES=20971520
ENV CC_RATE_LIMIT=30
ENV CC_RATE_COST_AGENT=12
ENV CC_RATE_COST_ANSWER=4
ENV CC_MAX_CONCURRENT_LLM=2
ENV CC_MAX_CONCURRENT_CONVERSIONS=3
ENV CC_MAX_QUEUED_CONVERSIONS=12
ENV CC_LLM_TIMEOUT_MS=30000
# Do NOT set CC_TRUST_PROXY here — Render/Railway should set hop count `1` in
# the dashboard if needed. Never `true` on a public URL.
EXPOSE 8000
CMD ["node", "dist/web.js"]
