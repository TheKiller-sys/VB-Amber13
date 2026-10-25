// src/http/errorHandler.js
// Error centralizado + async wrapper.

import { getLogger } from '../utils/logger.js';

export class HttpError extends Error {
    constructor(status, code, message = null, details = null) {
        super(message || code);
        this.name = 'HttpError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function notFoundHandler(req, res) {
    res.set('x-error-code', 'not_found');
    res.status(404).json({
        error: 'not_found',
        path: req.path,
    });
}

export function errorHandler(err, req, res, _next) {
    const logger = getLogger();
    const status = Number.isInteger(err.status) ? err.status : 500;
    const code = err.code || (status >= 500 ? 'internal_error' : 'request_error');

    const logEntry = {
        code,
        status,
        path: req.path,
        method: req.method,
        err: err.message,
    };
    if (status >= 500) {
        logEntry.stack = err.stack;
        logger.error(logEntry, 'http error');
    } else {
        logger.warn(logEntry, 'http error');
    }

    if (res.headersSent) return;

    res.set('x-error-code', code);
    res.status(status).json({
        error: code,
        message: status >= 500 ? 'internal server error' : err.message,
        ...(err.details ? { details: err.details } : {}),
    });
}

export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
