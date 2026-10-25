// src/persona/PersonaGuard.js
// Filtro multi-capa que valida CUALQUIER draft antes de publicar.
// Es la última línea de defensa: si algo se cuela aquí, se publica mal.

import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';

const VALID_DECISIONS = new Set([
    'publish',
    'reject',
    'escalate',
    'ignore',
]);

const AI_REFUSAL_PATTERNS = [
    /\bcomo (una )?ia\b/i,
    /\bcomo (un )?modelo de lenguaje\b/i,
    /\bcomo (un )?asistente\b/i,
    /\bno soy (un |una )?(humano|persona|humana)\b/i,
    /\bfui entrenado para\b/i,
    /\bno puedo (ayudar|proporcionar|responder)\b.*\b(eso|esto)\b/i,
    /\blo siento, pero no puedo\b/i,
    /\bI'?m (just )?an? (AI|language model|assistant)\b/i,
    /\bI cannot (help|provide|respond|answer)\b/i,
];

const URL_RE = /https?:\/\/[^\s]+/gi;

// ============================================================
// GUARD
// ============================================================

export class PersonaGuard {
    /**
     * @param {Object} deps
     *   - database   — DatabaseManager (opcional, para recent actions y rate limits)
     *   - repository — PersonaRepository (opcional, para persona vigente)
     */
    constructor({ database = null, repository = null } = {}) {
        this.database = database;
        this.repository = repository;
        this.logger = getLogger().child({ component: 'PersonaGuard' });
    }

    /**
     * Valida un draft contra la persona y el signal.
     *
     * @param {Object} opts
     *   - persona       {PersonaConfig}   (obligatorio)
     *   - draft         {string}          (obligatorio)
     *   - signal        {Object}          (obligatorio) — { platform, kind, author, text }
     *   - action        {string}          (obligatorio) — nombre de la tool: twitter_post, etc.
     *   - now           {number}          (opcional)
     *
     * @returns {Object} {
     *   ok: boolean,
     *   decision: 'publish' | 'reject' | 'escalate',
     *   errors: Array<{code, detail}>,
     *   warnings: Array<{code, detail}>,
     * }
     */
    validate({ persona, draft, signal, action, now = Date.now() }) {
        if (!persona) {
            return this._fail('missing_persona', 'PersonaConfig requerida');
        }
        if (typeof draft !== 'string' || draft.trim().length === 0) {
            return this._fail('empty_draft', 'Draft vacío');
        }
        if (!signal || !signal.platform) {
            return this._fail('missing_signal', 'Signal con platform requerido');
        }
        if (!action) {
            return this._fail('missing_action', 'Acción requerida');
        }

        const errors = [];
        const warnings = [];

        const text = draft.trim();
        const platform = signal.platform;

        // 1) SKIP explícito
        if (/^\s*\[SKIP\]\s*$/i.test(text)) {
            return {
                ok: false,
                decision: 'reject',
                errors: [{ code: 'explicit_skip', detail: 'LLM devolvió [SKIP]' }],
                warnings: [],
            };
        }

        // 2) Longitud mínima / máxima
        if (text.length < TUNING.DRAFT_MIN_LENGTH) {
            errors.push({ code: 'too_short', detail: `${text.length} chars` });
        }
        const maxLen = persona.getMaxLength(platform);
        if (text.length > maxLen) {
            errors.push({
                code: 'too_long',
                detail: `${text.length} > ${maxLen} (${platform})`,
            });
        }

        // 3) Tabúes textuales
        const lower = text.toLowerCase();
        for (const taboo of persona.topics.taboos) {
            if (taboo.length < 3) continue;
            if (lower.includes(taboo.toLowerCase())) {
                errors.push({ code: 'taboo', detail: taboo });
            }
        }

        // 4) Frases prohibidas
        for (const banned of persona.voice.bannedPhrases) {
            if (banned.length < 3) continue;
            if (lower.includes(banned.toLowerCase())) {
                errors.push({ code: 'banned_phrase', detail: banned });
            }
        }

        // 5) Refusal de IA ("como modelo de lenguaje…")
        for (const pat of AI_REFUSAL_PATTERNS) {
            if (pat.test(text)) {
                errors.push({
                    code: 'ai_refusal',
                    detail: pat.source.substring(0, 60),
                });
            }
        }

        // 6) Markdown / formato
        if (/\*\*[^*]+\*\*/.test(text) || /`[^`]+`/.test(text) || /^#{1,6}\s/m.test(text)) {
            warnings.push({
                code: 'markdown_detected',
                detail: 'Contiene markdown que puede no renderizarse',
            });
        }

        // 7) Prefijos indeseados
        if (/^(tuit|tweet|post|respuesta|draft|output|bot|reply)\s*[:：]/i.test(text)) {
            errors.push({ code: 'prefix_detected', detail: 'Elimina el prefijo del draft' });
        }

        // 8) Comillas envolventes
        if (/^["'«"`].*["'»"`]$/s.test(text) && text.length > 4) {
            warnings.push({ code: 'wrapped_quotes', detail: 'Elimina las comillas envolventes' });
        }

        // 9) Author bloqueado
        if (signal.author && persona.boundaries.neverReplyTo.length > 0) {
            const authorStr = String(signal.author).toLowerCase();
            for (const blocked of persona.boundaries.neverReplyTo) {
                if (authorStr === blocked.toLowerCase()) {
                    errors.push({ code: 'blocked_author', detail: blocked });
                }
            }
        }

        // 10) Horario permitido (solo proactivos)
        if (signal.kind === 'proactive_post') {
            if (!persona.isWithinPostingHours(new Date(now))) {
                errors.push({
                    code: 'outside_posting_hours',
                    detail: `Ventana: ${persona.boundaries.neverPostBetween?.join('–')}`,
                });
            }
        }

        // 11) Rate limits (solo si hay DB)
        if (this.database?.isInitialized) {
            try {
                const todayCount = this.database.countActionsToday(platform);
                if (todayCount >= persona.boundaries.maxPostsPerDay) {
                    errors.push({
                        code: 'daily_post_limit',
                        detail: `${todayCount}/${persona.boundaries.maxPostsPerDay} hoy en ${platform}`,
                    });
                }

                if (signal.kind === 'mention' || signal.kind === 'dm' || signal.kind === 'comment') {
                    const hourCount = this.database.countActionsInWindow(platform, 3600_000);
                    if (hourCount >= persona.boundaries.maxRepliesPerHour) {
                        errors.push({
                            code: 'hourly_reply_limit',
                            detail: `${hourCount}/${persona.boundaries.maxRepliesPerHour} en última hora`,
                        });
                    }
                }
            } catch (err) {
                this.logger.warn({ err: err.message }, 'guard: no se pudo consultar rate limits');
                warnings.push({ code: 'rate_limit_check_failed', detail: err.message });
            }
        }

        // 12) Duplicado reciente (solo si hay DB)
        if (this.database?.isInitialized) {
            try {
                const recent = this.database.listRecentActions({
                    platform,
                    limit: TUNING.DRAFT_RECENT_DUPLICATE_CHECK_N,
                });
                const dup = this._findDuplicate(text, recent);
                if (dup) {
                    errors.push({
                        code: 'recent_duplicate',
                        detail: `similar a ${dup.id} (${dup.similarity.toFixed(2)})`,
                    });
                }
            } catch (err) {
                warnings.push({ code: 'dup_check_failed', detail: err.message });
            }
        }

        // 13) Reglas custom de la persona
        for (const rule of persona.rules) {
            if (!this._ruleMatches(rule, signal, text)) continue;
            if (rule.then === 'escalate_to_human') {
                errors.push({ code: 'rule_escalate', detail: rule.if });
            } else if (rule.then === 'avoid' || rule.then === 'skip') {
                errors.push({ code: 'rule_avoid', detail: rule.if });
            } else if (rule.then === 'force_approval') {
                warnings.push({ code: 'rule_force_approval', detail: rule.if });
            }
        }

        // 14) URLs sospechosas
        const urls = text.match(URL_RE) || [];
        if (urls.length > 0 && signal.kind === 'proactive_post') {
            warnings.push({
                code: 'urls_in_proactive',
                detail: `${urls.length} URL(s) en post proactivo`,
            });
        }

        const hasCriticalError = errors.some(e =>
            ['taboo', 'ai_refusal', 'rule_escalate', 'rule_avoid', 'blocked_author']
                .includes(e.code)
        );

        const decision = hasCriticalError
            ? 'escalate'
            : errors.length > 0
            ? 'reject'
            : 'publish';

        return {
            ok: errors.length === 0,
            decision,
            errors,
            warnings,
        };
    }

    // ============================================================
    // INTERNOS
    // ============================================================

    _fail(code, detail) {
        return {
            ok: false,
            decision: 'reject',
            errors: [{ code, detail }],
            warnings: [],
        };
    }

    _findDuplicate(text, recent) {
        if (!Array.isArray(recent) || recent.length === 0) return null;

        const target = this._normalize(text);
        const targetBigrams = this._bigrams(target);

        for (const action of recent) {
            const prev = this._normalize(action.text || '');
            if (prev === target) {
                return { id: action.id, similarity: 1 };
            }
            const sim = this._jaccard(targetBigrams, this._bigrams(prev));
            if (sim >= 0.85) {
                return { id: action.id, similarity: sim };
            }
        }
        return null;
    }

    _normalize(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _bigrams(s) {
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) {
            set.add(s.substring(i, i + 2));
        }
        return set;
    }

    _jaccard(a, b) {
        if (a.size === 0 && b.size === 0) return 1;
        let inter = 0;
        for (const g of a) if (b.has(g)) inter++;
        const union = a.size + b.size - inter;
        return union === 0 ? 0 : inter / union;
    }

    _ruleMatches(rule, signal, text) {
        const cond = String(rule.if || '').toLowerCase();

        // Formatos soportados:
        // "mention contiene 'urgente'"
        // "dm contiene 'precio'"
        // "tema = 'cripto'"
        // "cualquier dm"
        // "proactive con urls"

        if (cond === 'cualquier dm' && signal.kind === 'dm') return true;
        if (cond === 'proactive con urls' && signal.kind === 'proactive_post'
            && URL_RE.test(text)) return true;

        const contieneMatch = cond.match(/^(\w+)\s+contiene\s+["'«](.+?)["'»]$/);
        if (contieneMatch) {
            const [, kind, kw] = contieneMatch;
            if (kind === 'mention' || kind === 'dm' || kind === 'comment') {
                if (signal.kind !== kind) return false;
            }
            const hay = ((signal.text || '') + ' ' + text).toLowerCase();
            return hay.includes(kw.toLowerCase());
        }

        const temaMatch = cond.match(/^tema\s*=\s*["'«](.+?)["'»]$/);
        if (temaMatch) {
            const kw = temaMatch[1];
            return text.toLowerCase().includes(kw.toLowerCase());
        }

        return false;
    }
}

export default PersonaGuard;
