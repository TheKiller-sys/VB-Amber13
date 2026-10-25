# syntax=docker/dockerfile:1.6

# ============================================================
# BUILD STAGE
# Compila better-sqlite3 (nativo) e instala dependencias.
# NO necesita Chromium: Chromium solo se usa en runtime (scraping).
# ============================================================
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiamos todo el contexto (node_modules, .git, data, etc. excluidos
# vía .dockerignore). Esto evita que falle si package-lock.json no existe,
# porque comprobamos su existencia en el RUN siguiente.
COPY . .

# Instalación robusta:
#   - Si hay package-lock.json → npm ci (rápido, determinista)
#   - Si no hay              → npm install (funciona igual, más lento)
#   - --legacy-peer-deps     → tolera conflictos de peer deps
#   - npm rebuild            → fuerza recompilación nativa de better-sqlite3
RUN if [ -f package-lock.json ]; then \
        echo "→ package-lock.json encontrado: usando npm ci"; \
        npm ci --legacy-peer-deps --no-audit --no-fund; \
    else \
        echo "⚠️  package-lock.json AUSENTE: usando npm install (lento, no determinista)"; \
        echo "    Recomendación: ejecuta 'npm install' localmente y haz commit del lockfile"; \
        npm install --legacy-peer-deps --no-audit --no-fund; \
    fi \
    && npm rebuild better-sqlite3

# ============================================================
# RUNTIME STAGE
# Incluye Chromium (Playwright) + xvfb para scraping.
# ============================================================
FROM node:20-bookworm-slim AS runtime

# System deps:
#   - tini          → init correcto (zombie reaper, señales)
#   - ca-certificates → TLS
#   - curl          → healthcheck
#   - xvfb          → display virtual para Chromium headless
#   - libnss3...    → runtime de Chromium
#   - fonts         → renderizado correcto de emojis y texto
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates curl \
    xvfb \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxext6 libxi6 libxtst6 libglib2.0-0 fonts-liberation \
    fonts-noto-color-emoji fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Solo copiamos lo necesario desde el builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./

# Instalamos SOLO el binario de Chromium (las deps de sistema ya están
# vía apt arriba, así evitamos 'playwright install --with-deps' que
# requiere root + apt en runtime).
# PLAYWRIGHT_BROWSERS_PATH asegura que el binario sea accesible por el
# usuario 'node' (no root) después del USER switch.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install chromium \
    && chown -R node:node /app/.playwright

# Variables de producción (overrideables desde el dashboard de Render)
ENV NODE_ENV=production
ENV DB_PATH=/app/data/vb-amber13.db
ENV VB_AMBER_SESSION_DIR=/app/data/sessions
ENV VB_AMBER_SCRAPING_HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

# Crear directorios de datos con permisos correctos
RUN mkdir -p /app/data /app/data/sessions \
    && chown -R node:node /app

# Usuario no-root
USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
