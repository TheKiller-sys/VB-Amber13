// src/http/index.js
// Construcción de la app Express.
//
// Capas (en orden de ejecución):
//   1. helmet + cors              → seguridad y CORS
//   2. body parser selectivo      → raw para /webhooks, JSON para el resto
//   3. requestLogger              → log estructurado al terminar cada request
//   4. /static + /                → dashboard SPA (sin auth)
//   5. /health                    → healthchecks públicos
//   6. /webhooks                  → webhooks Meta (verificados por firma HMAC)
//   7. /api                       → rate limit + API key + rutas de negocio
//   8. notFoundHandler            → 404 estructurado
//   9. errorHandler               → errores centralizados

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';

import { requestLogger } from './logger.js';
import { requireApiKey, rateLimit } from './auth.js';
import { errorHandler, notFoundHandler } from './errorHandler.js';

import { createPersonaRouter } from './routes/persona.js';
import { createSocialRouter } from './routes/social.js';
import { createHealthRouter } from './routes/health.js';
import { createWebhooksRouter } from './routes/webhooks.js';
import { createSessionsRouter } from './routes/sessions.js';

// ============================================================
// __dirname equivalente en ESM
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_DIR = path.join(__dirname, 'static');

// ============================================================
// CREATE APP
// ============================================================

/**
 * Construye la app Express con todas las rutas y middlewares.
 *
 * @param {Object} deps
 *   - personaRepo    {PersonaRepository}
 *   - loop           {SocialAutonomyLoop}
 *   - adapterManager {AdapterManager}
 *   - sessions       {BrowserSessionManager|null}  null si transport=api
 *
 * @returns {import('express').Application}
 */
export function createApp({ personaRepo, loop, adapterManager, sessions = null }) {
    const env = getEnv();
    const logger = getLogger().child({ component: 'http' });
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', true);

    // ============================================================
    // 1. Seguridad + CORS
    // ============================================================

    // helmet por defecto bloquea la carga de Google Fonts con CSP.
    // Desactivamos SOLO contentSecurityPolicy. El resto de protecciones
    // (X-Frame-Options, X-Content-Type-Options, HSTS si aplica, etc.)
    // siguen activas.
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    }));

    app.use(cors({
        origin: env.CORS_ORIGIN === '*'
            ? true
            : env.CORS_ORIGIN.split(',').map(s => s.trim()),
        credentials: false,
    }));

    // ============================================================
    // 2. Body parser selectivo
    //    - /webhooks/*  → raw (necesario para HMAC de Meta)
    //    - resto        → JSON
    // ============================================================

    app.use((req, res, next) => {
        if (req.path.startsWith('/webhooks')) {
            return express.raw({ type: '*/*', limit: '2mb' })(req, res, () => {
                const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
                req.rawBody = buf.toString('utf8');
                try {
                    req.body = req.rawBody ? JSON.parse(req.rawBody) : {};
                } catch (_) {
                    req.body = {};
                }
                next();
            });
        }
        express.json({ limit: '1mb' })(req, res, next);
    });

    // ============================================================
    // 3. Logging HTTP
    // ============================================================

    app.use(requestLogger);

    // ============================================================
    // 4. Dashboard estático (SPA vanilla, sin build step)
    // ============================================================

    app.use('/static', express.static(STATIC_DIR, {
        maxAge: '1h',
        etag: true,
        index: false,
    }));

    app.get('/', (_req, res, next) => {
        // Si el dashboard no está compilado/presente, no rompemos la app.
        res.sendFile(path.join(STATIC_DIR, 'index.html'), (err) => {
            if (err) {
                logger.warn(
                    { err: err.message, path: STATIC_DIR },
                    'dashboard static no disponible'
                );
                next();
            }
        });
    });

    // ============================================================
    // 5. Healthchecks (públicos, sin auth)
    // ============================================================

    app.use('/health', createHealthRouter());

    // ============================================================
    // 6. Webhooks (públicos pero verificados por firma HMAC)
    // ============================================================

    app.use('/webhooks', createWebhooksRouter({ adapterManager }));

    // ============================================================
    // 7. API de negocio (rate limit + API key + rutas)
    // ============================================================

    const api = express.Router();
    api.use(rateLimit());
    api.use(requireApiKey);

    api.use('/persona', createPersonaRouter({ personaRepo }));
    api.use('/social', createSocialRouter({ loop }));
    api.use('/sessions', createSessionsRouter({ sessions }));

    app.use('/api', api);

    // ============================================================
    // 8. 404 estructurado
    // ============================================================

    app.use(notFoundHandler);

    // ============================================================
    // 9. Error handler centralizado (SIEMPRE al final)
    // ============================================================

    app.use(errorHandler);

    // Log de rutas montadas (útil para debugging en producción)
    logger.info(
        {
            static: STATIC_DIR,
            api: ['/persona', '/social', '/sessions'],
            public: ['/', '/health', '/webhooks'],
        },
        'http routes mounted'
    );

    return app;
}

// ============================================================
// START SERVER
// ============================================================

/**
 * Arranca el servidor HTTP en el puerto/host indicados.
 *
 * @param {import('express').Application} app
 * @param {Object} opts — { port, host }
 * @returns {Promise<import('node:http').Server>}
 */
export async function startServer(app, { port, host }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            getLogger().info({ port, host }, 'http server listening');
            resolve(server);
        });
        server.on('error', (err) => {
            getLogger().fatal({ err: err.message, port, host }, 'http server failed');
            reject(err);
        });
    });
}

export default createApp;
