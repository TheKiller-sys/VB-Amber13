// src/social/SocialMemory.js
// Provee contexto de acciones recientes al LLM para coherencia.
// Lee de la DB (social_actions) y formatea para inyectar en prompt.

import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';

export class SocialMemory {
    constructor({ database }) {
        this.database = database;
        this.logger = getLogger().child({ component: 'SocialMemory' });
    }

    async initialize() {
        this.logger.info('SocialMemory listo');
    }

    /**
     * Devuelve las últimas N acciones en formato para contexto de LLM.
     */
    recentActions({ platform = null, limit = 10 } = {}) {
        try {
            return this.database.listRecentActions({ platform, limit });
        } catch (err) {
            this.logger.warn({ err: err.message }, 'recentActions failed');
            return [];
        }
    }

    /**
     * Compone un bloque de texto con las últimas acciones para
     * inyectar como contexto.
     */
    buildContextBlock({ platform = null, limit = 10 } = {}) {
        const actions = this.recentActions({ platform, limit });
        if (actions.length === 0) return '';

        const lines = [];
        lines.push(`Has publicado ${actions.length} acciones recientes:`);
        for (const a of actions) {
            const age = this._humanAge(a.published_at);
            const text = String(a.text || '').substring(0, 150);
            lines.push(`• [${a.platform}] ${age}: "${text}"`);
        }
        lines.push('');
        lines.push('No te repitas. No te contradigas.');
        lines.push('Si el tema se parece, aporta un ángulo nuevo o guarda silencio.');

        return lines.join('\n');
    }

    /**
     * Devuelve la última acción idéntica o muy similar en las
     * últimas N acciones (para dedup).
     */
    findRecentDuplicate(text, { platform = null, limit = null } = {}) {
        const n = limit ?? TUNING.DRAFT_RECENT_DUPLICATE_CHECK_N;
        const actions = this.recentActions({ platform, limit: n });

        const norm = (s) => String(s || '')
            .toLowerCase()
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const target = norm(text);
        if (!target) return null;

        for (const a of actions) {
            if (norm(a.text) === target) {
                return { action: a, similarity: 1 };
            }
        }
        return null;
    }

    _humanAge(ts) {
        if (!ts) return 'hace rato';
        const diff = Date.now() - ts;
        if (diff < 60_000) return 'hace segundos';
        if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}min`;
        if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
        return `hace ${Math.floor(diff / 86_400_000)}d`;
    }

    getState() {
        try {
            const actions = this.database.listRecentActions({ limit: 1 });
            return {
                lastActionAt: actions[0]?.published_at || null,
                lastActionPlatform: actions[0]?.platform || null,
            };
        } catch (_) {
            return { lastActionAt: null, lastActionPlatform: null };
        }
    }

    async shutdown() {}
}

export default SocialMemory;
