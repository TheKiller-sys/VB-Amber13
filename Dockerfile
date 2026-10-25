# syntax=docker/dockerfile:1.6

# ============================================================
# BUILD STAGE
# ============================================================
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN if [ -f package-lock.json ]; then \
        echo "→ package-lock.json encontrado: usando npm ci"; \
        npm ci --legacy-peer-deps --no-audit --no-fund; \
    else \
        echo "⚠️  package-lock.json AUSENTE: usando npm install"; \
        npm install --legacy-peer-deps --no-audit --no-fund; \
    fi \
    && npm rebuild better-sqlite3

# ============================================================
# RUNTIME STAGE
# ============================================================
FROM node:20-bookworm-slim AS runtime

# System deps: Añadimos x11vnc, fluxbox, novnc y websockify para el VNC
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates curl \
    xvfb x11vnc fluxbox novnc websockify \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxext6 libxi6 libxtst6 libglib2.0-0 fonts-liberation \
    fonts-noto-color-emoji fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./

ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install chromium \
    && chown -R node:node /app/.playwright

# Variables de producción
ENV NODE_ENV=production
ENV DB_PATH=/app/data/vb-amber13.db
ENV VB_AMBER_SESSION_DIR=/app/data/sessions
ENV VB_AMBER_SCRAPING_HEADLESS=false # ¡Obligatorio false para ver la ventana!
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
ENV DISPLAY=:99

# Configurar VNC
ENV VNC_PORT=5900
ENV NOVNC_PORT=6080

RUN mkdir -p /app/data /app/data/sessions \
    && chown -R node:node /app

USER node
EXPOSE 3000 6080

ENTRYPOINT ["/usr/bin/tini", "--"]

# Script de arranque: Xvfb -> Fluxbox -> x11vnc -> noVNC -> Node
CMD ["sh", "-c", "\
    Xvfb :99 -screen 0 1280x900x24 -ac & \
    sleep 2; \
    fluxbox & \
    x11vnc -display :99 -forever -shared -nopw -rfbport ${VNC_PORT} -bg & \
    websockify --web=/usr/share/novnc/ ${NOVNC_PORT} localhost:${VNC_PORT} & \
    node src/index.js \
"]
