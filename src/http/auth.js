// src/http/auth.js
// API key auth (timing-safe) + rate limit por IP.

import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';

// ============================================================
// AUTH
// ============================================================

function safeCompare(a, b) {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    if (ba.length !== bb.length) {
        // Comparación dummy para no filtrar longitud
        try { timingSafeEqual(bb, bb); } catch (_) {}
        return false;
    }
    try { return timingSafeEqual(ba, bb); } catch (_) { return false; }
}

function extractKey(req) {
    const direct = req.get('x-api-key');
    if (direct) return direct;
    const auth = req.get('authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

export function requireApiKey(req, res, next) {
    const env = getEnv();
    const provided = extractKey(req);

    if (!provided) {
        res.set('x-error-code', 'missing_api_key');
        return res.status(401).json({ error: 'missing_api_key' });
    }

    if (!safeCompare(provided, env.VB_AMBER_ADMIN_API_KEY)) {
        getLogger().warn(
            { ip: req.ip, path: req.path },
            'api key rechazada'
        );
        res.set('x-error-code', 'invalid_api_key');
        return res.status(403).json({ error: 'invalid_api_key' });
    }

    next();
}

// ============================================================
// RATE LIMIT (fixed window, por IP)
// ============================================================

const _buckets = new Map();
const _CLEANUP_EVERY_MS = 60_000;
let _lastCleanup = 0;

function _cleanup(now, windowMs) {
    if (now - _lastCleanup < _CLEANUP_EVERY_MS) return;
    _lastCleanup = now;
    for (const [key, b] of _buckets) {
        if (now > b.resetAt) _buckets.delete(key);
    }
}

export function rateLimit(opts = {}) {
    const windowMs = opts.windowMs ?? TUNING.RATE_LIMIT_WINDOW_MS;
    const max = opts.max ?? TUNING.RATE_LIMIT_MAX_REQ;

    return function rateLimitMw(req, res, next) {
        const now = Date.now();
        _cleanup(now, windowMs);

        const key = req.ip || 'unknown';
        let b = _buckets.get(key);
        if (!b || now > b.resetAt) {
            b = { count: 0, resetAt: now + windowMs };
            _buckets.set(key, b);
        }
        b.count++;

        res.set('X-RateLimit-Limit', String(max));
        res.set('X-RateLimit-Remaining', String(Math.max(0, max - b.count)));
        res.set('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));

        if (b.count > max) {
            res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
            res.set('x-error-code', 'rate_limited');
            return res.status(429).json({ error: 'rate_limited' });
        }

        next();
    };
}

export function _resetBuckets() {
    _buckets.clear();
    _lastCleanup = 0;
}
