// src/http/index.js
// Construcción de la app Express.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

export function createApp({ personaRepo, loop, adapterManager, sessions = null }) {
    const env = getEnv();
    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', true);

    // Seguridad + CORS
    app.use(helmet());
    app.use(cors({
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map(s => s.trim()),
        credentials: false,
    }));

    // Body parser selectivo:
    //   /webhooks/* → raw (necesario para HMAC de Meta)
    //   resto      → json
    app.use((req, res, next) => {
        if (req.path.startsWith('/webhooks')) {
            return express.raw({ type: '*/*', limit: '2mb' })(req, res, () => {
                const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
                req.rawBody = buf.toString('utf8');
                try { req.body = req.rawBody ? JSON.parse(req.rawBody) : {}; }
                catch (_) { req.body = {}; }
                next();
            });
        }
        express.json({ limit: '1mb' })(req, res, next);
    });

    app.use(requestLogger);

    // Health (público)
    app.use('/health', createHealthRouter());

    // Webhooks (público pero verificado por firma)
    app.use('/webhooks', createWebhooksRouter({ adapterManager }));

    // API (auth + rate limit)
    const api = express.Router();
    api.use(rateLimit());
    api.use(requireApiKey);
    api.use('/persona', createPersonaRouter({ personaRepo }));
    api.use('/social', createSocialRouter({ loop }));
    api.use('/sessions', createSessionsRouter({ sessions }));
    app.use('/api', api);

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

export async function startServer(app, { port, host }) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            getLogger().info({ port, host }, 'http server listening');
            resolve(server);
        });
        server.on('error', reject);
    });
}
