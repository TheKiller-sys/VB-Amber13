// src/social/SignalClassifier.js
// Clasifica señales en categorías semánticas.
// Usa heurísticas (no LLM) para no quemar tokens en algo que puede
// resolverse con regex + reglas.

import { getLogger } from '../utils/logger.js';
import { CLASSIFICATIONS, SIGNAL_KINDS, normalizeText } from './types.js';

// ============================================================
// PATRONES
// ============================================================

const POSITIVE_PATTERNS = [
    /\b(gracias|thank you|thanks|thx)\b/,
    /\b(genial|increíble|excelente|top|brutal|magnífico)\b/,
    /\b(me (gusta|encanta|mola|flipa)|me ha (gustado|encantado|molado))\b/,
    /\b(felicitaciones|enhorabuena|congrats)\b/,
    /\b(te (admiro|sigo|leo)|gran (trabajo|post|artículo))\b/,
    /\b(aprendí|me ayudó|me sirvió)\b/,
    /\b(❤️|🙌|👏|🔥|💯|🥰|😍)/u,
    /\b(love it|great|awesome|amazing|fantastic|brilliant)\b/,
];

const NEGATIVE_PATTERNS = [
    /\b(malo|malísimo|horrible|terrible|fatal|asqueroso)\b/,
    /\b(estafa|scam|fraud|engaño|mentira|bulo)\b/,
    /\b(no funciona|no sirve|no me sirve|roto|rota)\b/,
    /\b(queja|reclamo|denuncia|protesta)\b/,
    /\b(odio|asco|asco das|me das asco|patético)\b/,
    /\b(error|fallo|bug|problema grave)\b/,
    /\b(estúpido|idiota|imbécil|gilipollas|pendejo)\b/,
    /\b(shut up|hate|terrible|awful|disgusting|pathetic)\b/,
];

const QUESTION_PATTERNS = [
    /\?/,
    /\b(c[oó]mo|qu[eé]|cu[aá]ndo|d[oó]nde|por qu[eé]|qui[eé]n|cu[aá]l)\b/,
    /\b(how|what|when|where|why|who|which)\b/,
];

const URGENT_PATTERNS = [
    /\b(urgente|urgent|asap|ya mismo|socorro|ayuda ya)\b/,
    /!{2,}/,
    /\b(emergencia|emergency)\b/,
];

const SPAM_PATTERNS = [
    /\b(gana (dinero|bitcoin|crypto)|hazte rico|trabaja desde casa)\b/,
    /\b(inversión garantizada|100% garantizado|sin riesgo)\b/,
    /\b(follow (back|me)|sígueme|sigueme|te sigo)\b/,
    /\b(link in bio|mira mi perfil|check my profile)\b/,
    /https?:\/\/[^\s]+/g, // URLs sin texto contextual son sospechosas en DMs
];

// ============================================================
// CLASIFICADOR
// ============================================================

export class SignalClassifier {
    constructor() {
        this.logger = getLogger().child({ component: 'SignalClassifier' });
        this.metrics = {
            classified: 0,
            byCategory: {},
        };
    }

    async initialize() {
        this.logger.info('SignalClassifier listo');
    }

    /**
     * @param {Signal} signal
     * @returns {Object} {
     *   classification: string,
     *   confidence: number,
     *   reasons: string[],
     *   urgency: 'low'|'normal'|'high'|'critical',
     * }
     */
    classify(signal) {
        this.metrics.classified++;

        const text = normalizeText(signal.text || '');
        const rawText = signal.text || '';

        let classification = CLASSIFICATIONS.UNKNOWN;
        let confidence = 0.3;
        const reasons = [];

        // Proactivo
        if (signal.kind === SIGNAL_KINDS.PROACTIVE_POST) {
            classification = CLASSIFICATIONS.PROACTIVE_POST;
            confidence = 1;
            reasons.push('signal_kind');
        }
        // DMs
        else if (signal.kind === SIGNAL_KINDS.DM) {
            if (this._matchesAny(text, SPAM_PATTERNS)) {
                classification = CLASSIFICATIONS.DM_SPAM;
                confidence = 0.8;
                reasons.push('spam_pattern');
            } else if (this._matchesAny(rawText, URGENT_PATTERNS)) {
                classification = CLASSIFICATIONS.DM_URGENT;
                confidence = 0.75;
                reasons.push('urgency_marker');
            } else {
                classification = CLASSIFICATIONS.DM;
                confidence = 0.9;
                reasons.push('signal_kind');
            }
        }
        // Menciones / comentarios
        else if (signal.kind === SIGNAL_KINDS.MENTION || signal.kind === SIGNAL_KINDS.COMMENT) {
            const isPositive = this._matchesAny(text, POSITIVE_PATTERNS);
            const isNegative = this._matchesAny(text, NEGATIVE_PATTERNS);
            const isQuestion = this._matchesAny(rawText, QUESTION_PATTERNS);

            if (isNegative) {
                classification = signal.kind === SIGNAL_KINDS.MENTION
                    ? CLASSIFICATIONS.MENTION_NEGATIVE
                    : CLASSIFICATIONS.COMMENT_NEGATIVE;
                confidence = 0.75;
                reasons.push('negative_pattern');
            } else if (isPositive) {
                classification = signal.kind === SIGNAL_KINDS.MENTION
                    ? CLASSIFICATIONS.MENTION_POSITIVE
                    : CLASSIFICATIONS.COMMENT_POSITIVE;
                confidence = 0.8;
                reasons.push('positive_pattern');
            } else if (isQuestion) {
                classification = signal.kind === SIGNAL_KINDS.MENTION
                    ? CLASSIFICATIONS.MENTION_QUESTION
                    : CLASSIFICATIONS.COMMENT_QUESTION;
                confidence = 0.7;
                reasons.push('question_pattern');
            } else {
                classification = signal.kind === SIGNAL_KINDS.MENTION
                    ? CLASSIFICATIONS.MENTION_NEUTRAL
                    : CLASSIFICATIONS.COMMENT_NEUTRAL;
                confidence = 0.55;
                reasons.push('default_neutral');
            }
        }
        // Reacciones
        else if (signal.kind === SIGNAL_KINDS.REACTION) {
            classification = CLASSIFICATIONS.REACTION_POSITIVE;
            confidence = 0.6;
            reasons.push('reaction_default');
        }

        // Urgencia
        let urgency = 'normal';
        if (classification === CLASSIFICATIONS.DM_URGENT) {
            urgency = 'critical';
        } else if (this._matchesAny(rawText, URGENT_PATTERNS)) {
            urgency = 'high';
        } else if (classification.includes('negativa') || classification.includes('negativo')) {
            urgency = 'high';
        } else if (classification.includes('pregunta')) {
            urgency = 'normal';
        }

        // Tracking
        this.metrics.byCategory[classification] =
            (this.metrics.byCategory[classification] || 0) + 1;

        return {
            classification,
            confidence,
            reasons,
            urgency,
        };
    }

    _matchesAny(text, patterns) {
        for (const p of patterns) {
            if (p.test(text)) return true;
        }
        return false;
    }

    getState() {
        return {
            metrics: { ...this.metrics, byCategory: { ...this.metrics.byCategory } },
        };
    }

    async shutdown() {}
}

export default SignalClassifier;
