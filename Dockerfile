# ---------- Build stage ----------
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# ---------- Runtime stage ----------
FROM node:20-bookworm-slim

# Dependencias de sistema para Chromium (Playwright) + xvfb + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates curl \
    xvfb \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxext6 libxi6 libxtst6 libglib2.0-0 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./

# Descargar Chromium de Playwright (necesario para scraping)
RUN npx playwright install chromium || true

ENV NODE_ENV=production
ENV DB_PATH=/app/data/vb-amber13.db
ENV VB_AMBER_SESSION_DIR=/app/data/sessions
ENV VB_AMBER_SCRAPING_HEADLESS=true

RUN mkdir -p /app/data /app/data/sessions \
    && chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
