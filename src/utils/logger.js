// src/utils/logger.js
// Logger Pino con redacción automática de secretos.

import pino from 'pino';
import { getEnv } from '../config/env.js';

const REDACT_PATHS = [
    '*.apiKey',
    '*.access_token',
    '*.accessToken',
    '*.bearer_token',
    '*.bearerToken',
    '*.api_key',
    '*.apiSecret',
    '*.app_secret',
    '*.client_secret',
    '*.password',
    '*.token',
    'req.headers.authorization',
    'headers.authorization',
];

let cachedLogger = null;

export function getLogger() {
    if (cachedLogger) return cachedLogger;

    const env = getEnv();

    const baseOptions = {
        level: env.LOG_LEVEL,
        redact: {
            paths: REDACT_PATHS,
            censor: '[REDACTED]',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        base: {
            service: 'vb-amber13',
            env: env.NODE_ENV,
        },
    };

    if (env.LOG_FORMAT === 'pretty') {
        cachedLogger = pino({
            ...baseOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss.l',
                    ignore: 'pid,hostname,service,env',
                },
            },
        });
    } else {
        cachedLogger = pino(baseOptions);
    }

    return cachedLogger;
}

/**
 * Crea un child logger con contexto (ej. sessionId, platform).
 */
export function childLogger(bindings) {
    return getLogger().child(bindings);
}

export default getLogger;
