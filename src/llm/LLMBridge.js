// src/llm/LLMBridge.js
// Cliente unificado con retry, timeout, circuit breaker y prompt
// de persona inyectado.

import { getLogger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { withRetry, withTimeout, RetryError } from '../utils/retry.js';
import { getProvider, executeProviderRequest } from './providers.js';

const MAX_TRACKED_FAILURES = 100;
const MAX_TRACKED_LATENCIES = 50;

// ============================================================
// CIRCUIT BREAKER
// ============================================================

class CircuitBreaker {
    constructor({ failuresBeforeOpen = 3, openMs = 60000 }) {
        this.failuresBeforeOpen = failuresBeforeOpen;
        this.openMs = openMs;
        this._consecutiveFailures = 0;
        this._openedAt = 0;
        this._totalCalls = 0;
        this._totalSuccess = 0;
        this._totalFailures = 0;
    }

    canAttempt() {
        if (this._consecutiveFailures < this.failuresBeforeOpen) return true;
        return Date.now() - this._openedAt > this.openMs;
    }

    recordSuccess() {
        this._consecutiveFailures = 0;
        this._totalSuccess++;
        this._totalCalls++;
    }

    recordFailure() {
        this._consecutiveFailures++;
        this._totalFailures++;
        this._totalCalls++;
        if (this._consecutiveFailures >= this.failuresBeforeOpen) {
            this._openedAt = Date.now();
        }
    }

    get state() {
        if (this._consecutiveFailures < this.failuresBeforeOpen) return 'closed';
        if (Date.now() - this._openedAt > this.openMs) return 'half-open';
        return 'open';
    }

    getStats() {
        return {
            state: this.state,
            consecutiveFailures: this._consecutiveFailures,
            openAgoMs: this._openedAt ? Date.now() - this._openedAt : null,
            totalCalls: this._totalCalls,
            totalSuccess: this._totalSuccess,
            totalFailures: this._totalFailures,
        };
    }
}

// ============================================================
// LIMPIEZA DE OUTPUT
// ============================================================

function cleanOutput(text) {
    let t = String(text ?? '').trim();

    // Prefijos
    t = t.replace(
        /^(respuesta|tuit|tweet|post|draft|reply|output|bot|assistant|cerebro)\s*[:：]\s*/i,
        ''
    );

    // Comillas envolventes (varias capas)
    for (let i = 0; i < 3; i++) {
        const before = t;
        t = t.replace(/^["'«"`]+/, '').replace(/["'»"`]+$/, '');
        if (t === before) break;
    }

    // Markdown bold/italic
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    t = t.replace(/\*([^*\n]+)\*/g, '$1');
    t = t.replace(/__([^_\n]+)__/g, '$1');
    t = t.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1$2');
    t = t.replace(/`([^`\n]+)`/g, '$1');
    t = t.replace(/^#{1,6}\s+/gm, '');

    // Normalizar espacios
    t = t.replace(/\r\n/g, '\n');
    t = t.replace(/[ \t]+/g, ' ');
    t = t.replace(/\n{3,}/g, '\n\n');
    t = t.replace(/[ \t]+$/gm, '');

    return t.trim();
}

// ============================================================
// LLM BRIDGE
// ============================================================

export class LLMBridge {
    constructor() {
        this.env = getEnv();
        this.logger = getLogger().child({ component: 'LLMBridge' });

        this.provider = getProvider(this.env.LLM_PROVIDER);
        this.model = this.env.LLM_MODEL;
        this.apiKey = this.env.LLM_API_KEY;
        this.baseUrl = this.env.LLM_BASE_URL || '';
        this.timeoutMs = this.env.LLM_TIMEOUT_MS;
        this.maxOutputTokens = this.env.LLM_MAX_OUTPUT_TOKENS;
        this.temperature = this.env.LLM_TEMPERATURE;

        this.breaker = new CircuitBreaker();

        this.metrics = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalLatencyMs: 0,
            lastError: null,
            lastErrorAt: null,
            rejectionsByBreaker: 0,
        };

        this._latencies = [];
    }

    async initialize() {
        this.logger.info(
            {
                provider: this.env.LLM_PROVIDER,
                model: this.env.LLM_MODEL,
                timeoutMs: this.timeoutMs,
                maxOutputTokens: this.maxOutputTokens,
            },
            'LLMBridge inicializado'
        );
    }

    isAvailable() {
        return this.breaker.canAttempt();
    }

    getCircuitState() {
        return this.breaker.getStats();
    }

    // ============================================================
    // API PRINCIPAL
    // ============================================================

    /**
     * Generación directa con prompts explícitos.
     *
     * @param {Object} opts
     *   - systemPrompt   {string}
     *   - userMessage    {string} (obligatorio)
     *   - temperature    {number} (opcional)
     *   - maxTokens      {number} (opcional)
     *   - metadata       {Object} (opcional, para logs)
     *   - signal         {AbortSignal} (opcional)
     *
     * @returns {Promise<Object|null>} {
     *   text, usage, provider, model, latencyMs, cleaned
     * } o null si falla irrecuperablemente.
     */
    async generate(opts) {
        if (!opts?.userMessage || typeof opts.userMessage !== 'string') {
            throw new Error('LLMBridge.generate: userMessage required');
        }

        if (!this.breaker.canAttempt()) {
            this.metrics.rejectionsByBreaker++;
            this.logger.warn(
                { state: this.breaker.state },
                'circuit breaker abierto: rechazando llamada'
            );
            return null;
        }

        const temperature = typeof opts.temperature === 'number'
            ? opts.temperature
            : this.temperature;

        const maxTokens = typeof opts.maxTokens === 'number'
            ? opts.maxTokens
            : this.maxOutputTokens;

        const request = this.provider.buildRequest({
            model: this.model,
            systemPrompt: opts.systemPrompt || '',
            userMessage: opts.userMessage,
            temperature,
            maxTokens,
            apiKey: this.apiKey,
            baseUrl: this.baseUrl,
        });

        const t0 = Date.now();
        this.metrics.totalCalls++;

        try {
            const json = await withRetry(
                () => executeProviderRequest(this.provider, request, {
                    timeoutMs: this.timeoutMs,
                }),
                {
                    maxRetries: 2,
                    baseMs: 1500,
                    maxMs: 15000,
                    retryable: (err) => {
                        if (err?._retryable !== undefined) return err._retryable;
                        const status = err?._status;
                        if (status === 429) return true;
                        if (status >= 500 && status < 600) return true;
                        if (err?.code === 'ETIMEDOUT') return true;
                        return false;
                    },
                    onRetry: (attempt, err, delay) => {
                        this.logger.warn(
                            {
                                attempt,
                                delayMs: delay,
                                err: err.message,
                                metadata: opts.metadata || null,
                            },
                            'llm retry'
                        );
                    },
                    signal: opts.signal,
                }
            );

            const parsed = this.provider.parseResponse(json);
            const cleaned = cleanOutput(parsed.text);
            const latencyMs = Date.now() - t0;

            this.breaker.recordSuccess();
            this.metrics.successfulCalls++;
            this.metrics.totalLatencyMs += latencyMs;

            this._latencies.push(latencyMs);
            if (this._latencies.length > MAX_TRACKED_LATENCIES) {
                this._latencies.shift();
            }

            this.logger.debug(
                {
                    latencyMs,
                    usage: parsed.usage,
                    textLength: cleaned.length,
                    metadata: opts.metadata || null,
                },
                'llm call ok'
            );

            return {
                text: cleaned,
                rawText: parsed.text,
                usage: parsed.usage,
                provider: this.provider.name,
                model: this.model,
                latencyMs,
            };
        } catch (err) {
            const latencyMs = Date.now() - t0;
            this.breaker.recordFailure();
            this.metrics.failedCalls++;
            this.metrics.lastError = err.message;
            this.metrics.lastErrorAt = Date.now();

            this.logger.error(
                {
                    err: err.message,
                    kind: err._kind,
                    status: err._status,
                    latencyMs,
                    metadata: opts.metadata || null,
                },
                'llm call failed'
            );

            return null;
        }
    }

    // ============================================================
    // GENERACIÓN CON PERSONA
    // ============================================================

    /**
     * Genera un draft de red social a partir de persona + signal.
     *
     * @param {Object} opts
     *   - persona    {PersonaConfig}      (obligatorio)
     *   - signal     {Object}             (obligatorio) — { platform, kind, text, author }
     *   - task       {string}             (opcional) — instrucción específica
     *   - context    {Object}             (opcional) — { recentActions, memory }
     *
     * @returns {Promise<Object|null>} { text, skipped, ... }
     */
    async generateForSocial({ persona, signal, task = null, context = {} }) {
        if (!persona) throw new Error('persona requerida');
        if (!signal?.platform) throw new Error('signal.platform requerido');

        const systemPrompt = this._buildSocialSystemPrompt({
            persona,
            signal,
            task,
            context,
        });

        const userMessage = this._buildSocialUserMessage({ persona, signal, task });

        const result = await this.generate({
            systemPrompt,
            userMessage,
            metadata: {
                kind: 'social_draft',
                platform: signal.platform,
                signalKind: signal.kind,
                personaVersion: persona.version,
            },
        });

        if (!result) return null;

        const skipped = /^\s*\[SKIP\]\s*$/i.test(result.text);
        return {
            ...result,
            skipped,
        };
    }

    // ============================================================
    // CONSTRUCCIÓN DE PROMPTS
    // ============================================================

    _buildSocialSystemPrompt({ persona, signal, task, context }) {
        const blocks = [];

        // 1. Persona
        blocks.push(persona.toPromptBlock());
        blocks.push('');

        // 2. Tarea
        blocks.push('=== TAREA ===');
        blocks.push(this._taskInstruction(signal, persona, task));
        blocks.push('');

        // 3. Contexto de acciones recientes
        const recent = context?.recentActions || [];
        if (recent.length > 0) {
            blocks.push('=== TUS ACCIONES RECIENTES (no repitas ni te contradigas) ===');
            for (const a of recent.slice(-8)) {
                const when = this._humanAge(a.published_at);
                const text = String(a.text || '').substring(0, 200);
                blocks.push(`• [${a.platform}] ${when}: "${text}"`);
            }
            blocks.push('');
        }

        // 4. Instrucción de plataforma
        const platform = persona.getPlatformConfig(signal.platform);
        if (platform) {
            blocks.push('=== PLATAFORMA ===');
            blocks.push(`Estás escribiendo en ${signal.platform}.`);
            const maxLen = persona.getMaxLength(signal.platform);
            blocks.push(`Longitud máxima: ${maxLen} caracteres.`);
            if (platform.styleOverride?.tone) {
                blocks.push(`Tono específico para esta plataforma: ${platform.styleOverride.tone}.`);
            }
            blocks.push('');
        }

        // 5. Contexto de memoria
        if (context?.memory && typeof context.memory === 'string') {
            blocks.push('=== CONTEXTO DE MEMORIA ===');
            blocks.push(context.memory);
            blocks.push('');
        }

        // 6. Reglas finales
        blocks.push('=== RECORDATORIO FINAL ===');
        blocks.push('Recuerda: devuelve SOLO el texto a publicar.');
        blocks.push('Si el tema es tabú o no puedes responder con integridad, responde exactamente: [SKIP]');

        return blocks.join('\n');
    }

    _buildSocialUserMessage({ persona, signal, task }) {
        if (signal.kind === 'proactive_post') {
            return 'Escribe un post original para esta plataforma. Debe sentirse como tú, no como marketing.';
        }
        if (signal.kind === 'mention') {
            return `Responde a esta mención de @${signal.author || 'alguien'}: "${signal.text}"`;
        }
        if (signal.kind === 'dm') {
            return `Responde a este mensaje directo de ${signal.author || 'alguien'}: "${signal.text}"`;
        }
        if (signal.kind === 'comment') {
            return `Responde a este comentario de ${signal.author || 'alguien'}: "${signal.text}"`;
        }
        if (task) return task;
        return 'Escribe lo que corresponda.';
    }

    _taskInstruction(signal, persona, customTask) {
        if (customTask) return customTask;

        switch (signal.kind) {
            case 'proactive_post':
                return [
                    'Escribe un post NUEVO para publicar.',
                    'Debe ser coherente con tu voz y tus temas.',
                    'NO repitas ideas de tus acciones recientes.',
                    'NO incluyas hashtags promocionales a menos que estén en tus samples.',
                    `Máximo ${persona.getMaxLength(signal.platform)} caracteres.`,
                ].join(' ');

            case 'mention':
                return [
                    'Responde a la mención.',
                    'Agradece si es positiva, aclara si es neutra.',
                    'Si es negativa, responde con calma y honestidad, sin defenderte.',
                    'NO repitas textualmente lo que dice la mención.',
                    'Máximo 280 caracteres.',
                ].join(' ');

            case 'dm':
                return [
                    'Responde al mensaje directo con cercanía.',
                    'Si no puedes ayudar, dilo honestamente.',
                    'Máximo 500 caracteres.',
                ].join(' ');

            case 'comment':
                return [
                    'Responde al comentario brevemente.',
                    'Máximo 400 caracteres.',
                ].join(' ');

            default:
                return 'Escribe lo que corresponda de forma coherente con tu persona.';
        }
    }

    _humanAge(ts) {
        if (!ts) return 'hace rato';
        const diff = Date.now() - ts;
        if (diff < 60_000) return 'hace segundos';
        if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}min`;
        if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
        return `hace ${Math.floor(diff / 86_400_000)}d`;
    }

    // ============================================================
    // ESTADO
    // ============================================================

    getStats() {
        const avgLatency = this._latencies.length > 0
            ? this._latencies.reduce((a, b) => a + b, 0) / this._latencies.length
            : 0;

        return {
            provider: this.env.LLM_PROVIDER,
            model: this.env.LLM_MODEL,
            circuit: this.breaker.getStats(),
            metrics: {
                ...this.metrics,
                avgLatencyMs: Math.round(avgLatency),
            },
        };
    }

    async shutdown() {
        this.logger.info('LLMBridge shutdown');
    }
}

export default LLMBridge;
