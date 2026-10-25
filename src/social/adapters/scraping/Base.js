// src/social/adapters/scraping/Base.js
// Clase base para los adapters de scraping. Concentra rate limiting
// local, manejo de challenge y registro uniforme de errores.

import { getLogger } from '../../../utils/logger.js';
import { getEnv } from '../../../config/env.js';
import { TUNING } from '../../../config/tuning.js';
import { HumanDelay } from '../../browser/HumanDelay.js';

export class ScrapingAdapterBase {
    /**
     * @param {Object} deps
     *   - name     {string}           plataforma
     *   - sessions {BrowserSessionManager}
     *   - database {DatabaseManager}
     */
    constructor({ name, sessions, database }) {
        this.name = name;
        this.sessions = sessions;
        this.database = database;
        this.enabled = false;
        this.delay = new HumanDelay();
        this.logger = getLogger().child({ component: `Scraping:${name}` });
    }

    async initialize() {
        // El manager ya se inicializó; aquí solo verificamos si hay sesión.
        const env = getEnv();
        if (env.VB_AMBER_TRANSPORT !== 'scraping') {
            this.enabled = false;
            return false;
        }

        const hasSession = this.sessions.hasSession(this.name);
        this.enabled = hasSession;

        this.logger.info(
            {
                enabled: hasSession,
                hint: hasSession ? null : 'usa POST /api/sessions/:platform/login',
            },
            hasSession ? `${this.name} scraping listo` : `${this.name} sin sesión guardada`
        );
        return hasSession;
    }

    // ============================================================
    // RATE LIMITING LOCAL
    // ============================================================

    /**
     * Verifica límites locales ANTES de tocar el browser.
     * Devuelve { ok: true } o { ok: false, error, ... }.
     */
    _checkLocalRateLimit(kind) {
        const env = getEnv();

        try {
            if (kind === 'post') {
                const today = this.database.countActionsToday(this.name);
                if (today >= env.VB_AMBER_SCRAPING_DAILY_POST_LIMIT) {
                    return {
                        ok: false,
                        error: 'daily_limit_reached',
                        count: today,
                        limit: env.VB_AMBER_SCRAPING_DAILY_POST_LIMIT,
                    };
                }
                const recent = this.database.listRecentActions({
                    platform: this.name,
                    limit: 1,
                });
                if (recent.length > 0) {
                    const since = Date.now() - recent[0].published_at;
                    if (since < TUNING.SCRAPING_MIN_MS_BETWEEN_POSTS) {
                        return {
                            ok: false,
                            error: 'min_interval_not_elapsed',
                            waitMs: TUNING.SCRAPING_MIN_MS_BETWEEN_POSTS - since,
                        };
                    }
                }
            }

            if (kind === 'reply') {
                const hour = this.database.countActionsInWindow(this.name, 3600_000);
                if (hour >= env.VB_AMBER_SCRAPING_HOURLY_REPLY_LIMIT) {
                    return {
                        ok: false,
                        error: 'hourly_limit_reached',
                        count: hour,
                        limit: env.VB_AMBER_SCRAPING_HOURLY_REPLY_LIMIT,
                    };
                }
            }
        } catch (err) {
            this.logger.warn({ err: err.message }, 'rate limit check failed; allowing');
        }

        return { ok: true };
    }

    // ============================================================
    // EJECUCIÓN SEGURA
    // ============================================================

    /**
     * Wrapper que ejecuta `fn(page)` dentro de withPage y añade
     * manejo uniforme de challenge y errores.
     */
    async _execute(fn) {
        if (!this.enabled) {
            return { ok: false, error: `${this.name}_disabled` };
        }
        if (this.sessions.isChallengeActive(this.name)) {
            return {
                ok: false,
                error: 'challenge_active',
                detail: this.sessions.getChallengeInfo(this.name),
            };
        }

        const result = await this.sessions.withPage(this.name, fn);

        if (result && result.error === 'challenge_detected') {
            // El manager ya marcó challenge; devolvemos info al loop
            return result;
        }

        return result;
    }

    // ============================================================
    // LECTURA — a sobrescribir
    // ============================================================

    async readMentions() { return []; }
    async readDMs() { return []; }
    async readRecentComments() { return []; }

    // ============================================================
    // ESCRITURA — a sobrescribir
    // ============================================================

    async postText() { return { ok: false, error: 'not_implemented' }; }

    async shutdown() {
        this.enabled = false;
    }
}

export default ScrapingAdapterBase;
