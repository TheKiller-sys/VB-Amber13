// src/http/logger.js
// Middleware de logging HTTP: una línea por request al terminar.

import { getLogger } from '../utils/logger.js';

export function requestLogger(req, res, next) {
    const t0 = Date.now();
    const method = req.method;
    const path = req.originalUrl || req.url;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    res.on('finish', () => {
        const logger = getLogger();
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const entry = {
            method,
            path,
            status,
            ms: Date.now() - t0,
            ip,
            ua: req.get('user-agent') || null,
        };
        if (status >= 400) entry.code = res.get('x-error-code') || null;
        logger[level](entry, 'http');
    });

    next();
}

export default requestLogger;
