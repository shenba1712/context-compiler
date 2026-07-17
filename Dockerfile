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
RUN npm run build && npm prune --omit=dev

ENV PORT=8000
ENV CC_CACHE_DIR=/tmp/cc-cache
EXPOSE 8000
CMD ["node", "dist/web.js"]
