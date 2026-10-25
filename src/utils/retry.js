// src/utils/retry.js
// Retry con exponential backoff + jitter.
// Filtra qué errores reintentar (por defecto: red, 429, 5xx).

export class RetryError extends Error {
    constructor(message, attempts, lastError) {
        super(message);
        this.name = 'RetryError';
        this.attempts = attempts;
        this.lastError = lastError;
    }
}

const DEFAULT_RETRYABLE = (err) => {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
    const status = err.status || err.statusCode || err._status;
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
};

/**
 * Ejecuta `fn` con retry.
 *
 * @param {Function} fn — async () => result
 * @param {Object}   opts
 *   - maxRetries    {number} default 3
 *   - baseMs        {number} default 1500
 *   - maxMs         {number} default 15000
 *   - retryable     {Function} (err) => boolean
 *   - onRetry       {Function} (attempt, err, delayMs) => void
 *   - signal        {AbortSignal} opcional
 *
 * @returns {Promise<any>}
 */
export async function withRetry(fn, opts = {}) {
    const {
        maxRetries = 3,
        baseMs = 1500,
        maxMs = 15000,
        retryable = DEFAULT_RETRYABLE,
        onRetry = null,
        signal = null,
    } = opts;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
            throw new Error('aborted');
        }

        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt >= maxRetries) break;
            if (!retryable(err)) break;

            const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
            const jitter = exp * (0.5 + Math.random());
            const delay = Math.round(Math.min(maxMs, jitter));

            if (onRetry) {
                try { onRetry(attempt + 1, err, delay); } catch (_) {}
            }

            await new Promise((resolve, reject) => {
                const t = setTimeout(resolve, delay);
                if (signal) {
                    const onAbort = () => {
                        clearTimeout(t);
                        reject(new Error('aborted'));
                    };
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            });
        }
    }

    throw new RetryError(
        `Retry exhausted after ${maxRetries + 1} attempts`,
        maxRetries + 1,
        lastError
    );
}

/**
 * Envuelve una promise con timeout.
 */
export function withTimeout(promise, ms, label = 'operation') {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            const t = setTimeout(() => {
                const err = new Error(`${label} timeout (${ms}ms)`);
                err.code = 'ETIMEDOUT';
                reject(err);
            }, ms);
            if (t.unref) t.unref();
        }),
    ]);
}
