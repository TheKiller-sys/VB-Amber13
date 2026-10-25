// src/social/SignalIngester.js
// Orquesta la ingestión de señales desde adapters + cron proactivo.
// Deduplica contra DB (social_signals) y devuelve solo señales nuevas.

import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';
import { isValidSignal, SIGNAL_KINDS } from './types.js';

export class SignalIngester {
    /**
     * @param {Object} deps
     *   - database      — DatabaseManager (obligatorio)
     *   - adapterManager — AdapterManager (obligatorio)
     *   - personaRepo   — PersonaRepository (opcional, para proactivos)
     */
    constructor({ database, adapterManager, personaRepo = null }) {
        this.database = database;
        this.adapterManager = adapterManager;
        this.personaRepo = personaRepo;
        this.logger = getLogger().child({ component: 'SignalIngester' });

        this.metrics = {
            cycles: 0,
            signalsCollected: 0,
            signalsNew: 0,
            signalsDuped: 0,
            proactiveGenerated: 0,
        };

        this._lastProactiveAt = 0;
    }

    async initialize() {
        this.logger.info('SignalIngester listo');
    }

    /**
     * Recoge señales nuevas (deduplicadas) en un ciclo.
     * @returns {Promise<Array<Signal>>}
     */
    async ingest() {
        this.metrics.cycles++;

        const persona = this.personaRepo?.getLatest();
        if (!persona) {
            this.logger.warn('sin persona; skip ingest');
            return [];
        }

        // 1. Adapters
        const raw = await this.adapterManager.ingestAll();
        this.metrics.signalsCollected += raw.length;

        // 2. Proactivo (cron)
        const proactive = this._maybeCreateProactiveSignal(persona);
        if (proactive) {
            raw.push(proactive);
            this.metrics.proactiveGenerated++;
        }

        // 3. Dedup contra DB + dentro del batch
        const seenInBatch = new Set();
        const fresh = [];

        for (const signal of raw) {
            if (!isValidSignal(signal)) {
                this.logger.debug(
                    { platform: signal?.platform, kind: signal?.kind },
                    'invalid signal dropped'
                );
                continue;
            }

            if (seenInBatch.has(signal.id)) {
                this.metrics.signalsDuped++;
                continue;
            }
            seenInBatch.add(signal.id);

            try {
                if (this.database.wasSignalSeen(signal.id)) {
                    this.metrics.signalsDuped++;
                    continue;
                }
            } catch (err) {
                this.logger.warn(
                    { signalId: signal.id, err: err.message },
                    'dedup check failed; accepting'
                );
            }

            // Registrar en DB
            try {
                this.database.recordSignal(signal);
            } catch (err) {
                this.logger.warn(
                    { signalId: signal.id, err: err.message },
                    'record signal failed'
                );
            }

            fresh.push(signal);
            this.metrics.signalsNew++;
        }

        if (fresh.length > 0) {
            this.logger.info(
                {
                    fresh: fresh.length,
                    collected: raw.length,
                    byPlatform: this._countByPlatform(fresh),
                },
                'signals ingested'
            );
        }

        return fresh;
    }

    /**
     * Genera un signal proactivo si toca (cron).
     * Solo si:
     *  - No hay otro proactivo reciente (< MIN_MS_BETWEEN_PROACTIVE_POSTS)
     *  - Estamos dentro del horario permitido de la persona
     *  - No hemos superado el rate limit diario
     *  - Alguna plataforma está habilitada
     */
    _maybeCreateProactiveSignal(persona) {
        const now = Date.now();

        // 1. Gap mínimo entre proactivos
        if (now - this._lastProactiveAt < persona.boundaries.minMsBetweenProactivePosts) {
            return null;
        }

        // 2. Horario
        if (!persona.isWithinPostingHours(new Date(now))) {
            return null;
        }

        // 3. Rate limit diario (por plataforma)
        const enabledPlatforms = Object.keys(persona.platforms)
            .filter(p => persona.isPlatformEnabled(p));

        if (enabledPlatforms.length === 0) return null;

        // Elegir plataforma con menos posts hoy
        let candidate = null;
        let minCount = Infinity;

        for (const platform of enabledPlatforms) {
            try {
                const count = this.database.countActionsToday(platform);
                if (count < persona.boundaries.maxPostsPerDay && count < minCount) {
                    minCount = count;
                    candidate = platform;
                }
            } catch (_) {}
        }

        if (!candidate) return null;

        this._lastProactiveAt = now;

        return {
            id: `proactive_${candidate}_${Math.floor(now / 3600000)}`,
            platform: candidate,
            kind: SIGNAL_KINDS.PROACTIVE_POST,
            author: null,
            text: null,
            receivedAt: now,
            externalId: null,
            threadParentId: null,
            raw: { source: 'cron' },
        };
    }

    _countByPlatform(signals) {
        const out = {};
        for (const s of signals) {
            out[s.platform] = (out[s.platform] || 0) + 1;
        }
        return out;
    }

    getState() {
        return {
            metrics: { ...this.metrics },
            lastProactiveAt: this._lastProactiveAt,
            lastProactiveAgoMs: this._lastProactiveAt
                ? Date.now() - this._lastProactiveAt
                : null,
        };
    }

    async shutdown() {}
}

export default SignalIngester;
