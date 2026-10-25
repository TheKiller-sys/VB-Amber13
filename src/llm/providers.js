// src/llm/providers.js
// Adapters puros por proveedor. Cada uno expone:
//   - name
//   - buildRequest({ model, systemPrompt, userMessage, temperature, maxTokens, apiKey, baseUrl })
//     → { url, headers, body }
//   - parseResponse(json) → { text, usage }
//   - classifyError(status, bodyText) → { retryable, kind, status }

import { withTimeout } from '../utils/retry.js';

// ============================================================
// OPENAI
// ============================================================

const OpenAIProvider = {
    name: 'openai',

    defaultBaseUrl() {
        return 'https://api.openai.com/v1';
    },

    buildRequest(opts) {
        const base = (opts.baseUrl || this.defaultBaseUrl()).replace(/\/$/, '');
        const messages = [];
        if (opts.systemPrompt) {
            messages.push({ role: 'system', content: opts.systemPrompt });
        }
        messages.push({ role: 'user', content: opts.userMessage });

        return {
            url: `${base}/chat/completions`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${opts.apiKey}`,
            },
            body: {
                model: opts.model,
                messages,
                temperature: opts.temperature,
                max_tokens: opts.maxTokens,
            },
        };
    },

    parseResponse(json) {
        const choice = json?.choices?.[0];
        const text = choice?.message?.content || '';
        return {
            text: typeof text === 'string' ? text : String(text),
            usage: json?.usage || null,
        };
    },

    classifyError(status, bodyText) {
        if (status === 401 || status === 403) {
            return { retryable: false, kind: 'auth', status };
        }
        if (status === 429) {
            return { retryable: true, kind: 'rate_limit', status };
        }
        if (status >= 500 && status < 600) {
            return { retryable: true, kind: 'server', status };
        }
        if (status === 400) {
            return { retryable: false, kind: 'bad_request', status };
        }
        return { retryable: false, kind: 'http', status };
    },
};

// ============================================================
// ANTHROPIC
// ============================================================

const AnthropicProvider = {
    name: 'anthropic',

    defaultBaseUrl() {
        return 'https://api.anthropic.com';
    },

    buildRequest(opts) {
        const base = (opts.baseUrl || this.defaultBaseUrl()).replace(/\/$/, '');

        return {
            url: `${base}/v1/messages`,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': opts.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: {
                model: opts.model,
                system: opts.systemPrompt || '',
                messages: [{ role: 'user', content: opts.userMessage }],
                max_tokens: opts.maxTokens,
                temperature: opts.temperature,
            },
        };
    },

    parseResponse(json) {
        const block = Array.isArray(json?.content) ? json.content[0] : null;
        const text = block?.text || '';
        return {
            text: typeof text === 'string' ? text : String(text),
            usage: json?.usage || null,
        };
    },

    classifyError(status, bodyText) {
        if (status === 401 || status === 403) {
            return { retryable: false, kind: 'auth', status };
        }
        if (status === 429) {
            return { retryable: true, kind: 'rate_limit', status };
        }
        if (status === 529 || (status >= 500 && status < 600)) {
            return { retryable: true, kind: 'server', status };
        }
        if (status === 400) {
            return { retryable: false, kind: 'bad_request', status };
        }
        return { retryable: false, kind: 'http', status };
    },
};

// ============================================================
// OLLAMA
// ============================================================

const OllamaProvider = {
    name: 'ollama',

    defaultBaseUrl() {
        return 'http://localhost:11434';
    },

    buildRequest(opts) {
        const base = (opts.baseUrl || this.defaultBaseUrl()).replace(/\/$/, '');
        const messages = [];
        if (opts.systemPrompt) {
            messages.push({ role: 'system', content: opts.systemPrompt });
        }
        messages.push({ role: 'user', content: opts.userMessage });

        const headers = { 'Content-Type': 'application/json' };
        if (opts.apiKey) {
            headers['Authorization'] = `Bearer ${opts.apiKey}`;
        }

        return {
            url: `${base}/api/chat`,
            headers,
            body: {
                model: opts.model,
                messages,
                stream: false,
                options: {
                    temperature: opts.temperature,
                    num_predict: opts.maxTokens,
                },
            },
        };
    },

    parseResponse(json) {
        const text = json?.message?.content || '';
        return {
            text: typeof text === 'string' ? text : String(text),
            usage: json?.eval_count ? {
                completion_tokens: json.eval_count,
                prompt_tokens: json.prompt_eval_count,
            } : null,
        };
    },

    classifyError(status, bodyText) {
        if (status === 404) {
            return { retryable: false, kind: 'not_found', status };
        }
        if (status >= 500) {
            return { retryable: true, kind: 'server', status };
        }
        return { retryable: false, kind: 'http', status };
    },
};

// ============================================================
// FETCH HELPER COMPARTIDO
// ============================================================

/**
 * Ejecuta una llamada HTTP al proveedor.
 * Respeta `maxBodyBytes` para no cargar respuestas gigantes.
 */
export async function executeProviderRequest(provider, request, { timeoutMs, maxBodyBytes = 4 * 1024 * 1024 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (timer.unref) timer.unref();

    let response;
    try {
        response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            const e = new Error(`llm_timeout (${timeoutMs}ms)`);
            e.code = 'ETIMEDOUT';
            throw e;
        }
        const e = new Error(`llm_network: ${err.message}`);
        e.code = err.code || 'ENETWORK';
        throw e;
    } finally {
        clearTimeout(timer);
    }

    // Leer body con límite
    const reader = response.body?.getReader();
    if (!reader) {
        const text = await response.text();
        const trimmed = text.length > maxBodyBytes
            ? text.substring(0, maxBodyBytes)
            : text;

        if (!response.ok) {
            const info = provider.classifyError(response.status, trimmed);
            const e = new Error(`llm_http_${response.status}: ${trimmed.substring(0, 300)}`);
            e._status = response.status;
            e._kind = info.kind;
            e._retryable = info.retryable;
            throw e;
        }
        try {
            return JSON.parse(trimmed);
        } catch (err) {
            const e = new Error(`llm_parse: ${err.message}`);
            e._kind = 'parse';
            throw e;
        }
    }

    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.length;
            if (total > maxBodyBytes) {
                try { reader.cancel(); } catch (_) {}
                const e = new Error(`llm_body_oversized (${total} > ${maxBodyBytes})`);
                e._kind = 'body_oversized';
                throw e;
            }
            chunks.push(value);
        }
    } finally {
        try { reader.releaseLock(); } catch (_) {}
    }

    const buffer = Buffer.concat(chunks);
    const text = buffer.toString('utf8');

    if (!response.ok) {
        const info = provider.classifyError(response.status, text);
        const e = new Error(`llm_http_${response.status}: ${text.substring(0, 300)}`);
        e._status = response.status;
        e._kind = info.kind;
        e._retryable = info.retryable;
        throw e;
    }

    try {
        return JSON.parse(text);
    } catch (err) {
        const e = new Error(`llm_parse: ${err.message}`);
        e._kind = 'parse';
        throw e;
    }
}

export const PROVIDERS = Object.freeze({
    openai: OpenAIProvider,
    anthropic: AnthropicProvider,
    ollama: OllamaProvider,
});

export function getProvider(name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`Proveedor LLM desconocido: ${name}`);
    return p;
}
