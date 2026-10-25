// src/social/types.js
// Constantes, taxonomía y helpers compartidos en toda la capa social.

// ============================================================
// PLATAFORMAS
// ============================================================

export const PLATFORMS = Object.freeze({
    TWITTER: 'twitter',
    INSTAGRAM: 'instagram',
    LINKEDIN: 'linkedin',
    THREADS: 'threads',
});

export const SUPPORTED_PLATFORMS = Object.freeze([
    PLATFORMS.TWITTER,
    PLATFORMS.INSTAGRAM,
    PLATFORMS.LINKEDIN,
]);

// ============================================================
// KINDS DE SEÑAL
// ============================================================

export const SIGNAL_KINDS = Object.freeze({
    MENTION: 'mention',
    DM: 'dm',
    COMMENT: 'comment',
    PROACTIVE_POST: 'proactive_post',
    REACTION: 'reaction',       // like / retweet / save
    CRON: 'cron',               // trigger manual o programado
});

// ============================================================
// CLASIFICACIONES
// ============================================================

export const CLASSIFICATIONS = Object.freeze({
    // Menciones
    MENTION_POSITIVE: 'mention_positiva',
    MENTION_NEGATIVE: 'mention_negativa',
    MENTION_NEUTRAL: 'mention_neutra',
    MENTION_QUESTION: 'mention_pregunta',

    // DMs
    DM: 'dm',
    DM_URGENT: 'dm_urgente',
    DM_SPAM: 'dm_spam',

    // Comentarios
    COMMENT_POSITIVE: 'comment_positivo',
    COMMENT_NEGATIVE: 'comment_negativo',
    COMMENT_NEUTRAL: 'comment_neutro',
    COMMENT_QUESTION: 'comment_pregunta',

    // Proactivo
    PROACTIVE_POST: 'proactive',

    // Reacciones
    REACTION_POSITIVE: 'reaction_positiva',
    REACTION_NEGATIVE: 'reaction_negativa',

    // Genérico
    UNKNOWN: 'unknown',
});

// ============================================================
// DECISIONES
// ============================================================

export const DECISIONS = Object.freeze({
    PUBLISH: 'publish',
    PENDING: 'pending',
    REJECT: 'reject',
    IGNORE: 'ignore',
    ESCALATE: 'escalate',
    SKIP: 'skip',
});

// ============================================================
// ACCIONES (tools por plataforma)
// ============================================================

export const ACTIONS = Object.freeze({
    // Twitter
    TWITTER_POST: 'twitter_post',
    TWITTER_REPLY: 'twitter_reply',
    TWITTER_DM_REPLY: 'twitter_dm_reply',
    TWITTER_DELETE: 'twitter_delete',
    TWITTER_LIKE: 'twitter_like',

    // Instagram
    INSTAGRAM_POST: 'instagram_post',
    INSTAGRAM_COMMENT_REPLY: 'instagram_comment_reply',

    // LinkedIn
    LINKEDIN_POST: 'linkedin_post',
    LINKEDIN_COMMENT_REPLY: 'linkedin_comment_reply',
});

// ============================================================
// MAPEO SEÑAL → ACCIÓN SUGERIDA
// ============================================================

export const SIGNAL_TO_ACTION = Object.freeze({
    [`${PLATFORMS.TWITTER}:${SIGNAL_KINDS.MENTION}`]: ACTIONS.TWITTER_REPLY,
    [`${PLATFORMS.TWITTER}:${SIGNAL_KINDS.DM}`]: ACTIONS.TWITTER_DM_REPLY,
    [`${PLATFORMS.TWITTER}:${SIGNAL_KINDS.PROACTIVE_POST}`]: ACTIONS.TWITTER_POST,
    [`${PLATFORMS.INSTAGRAM}:${SIGNAL_KINDS.COMMENT}`]: ACTIONS.INSTAGRAM_COMMENT_REPLY,
    [`${PLATFORMS.INSTAGRAM}:${SIGNAL_KINDS.PROACTIVE_POST}`]: ACTIONS.INSTAGRAM_POST,
    [`${PLATFORMS.LINKEDIN}:${SIGNAL_KINDS.COMMENT}`]: ACTIONS.LINKEDIN_COMMENT_REPLY,
    [`${PLATFORMS.LINKEDIN}:${SIGNAL_KINDS.PROACTIVE_POST}`]: ACTIONS.LINKEDIN_POST,
});

export function actionForSignal(platform, kind) {
    return SIGNAL_TO_ACTION[`${platform}:${kind}`] || null;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Estructura normalizada de un Signal.
 * Cualquier adapter debe devolver objetos con esta forma.
 */
export function makeSignal({
    id,
    platform,
    kind,
    author = null,
    text = null,
    receivedAt = Date.now(),
    raw = null,
    externalId = null,
    threadParentId = null,
}) {
    return {
        id,
        platform,
        kind,
        author,
        text,
        receivedAt,
        raw,
        externalId,
        threadParentId,
    };
}

/**
 * Valida que un signal tenga los campos mínimos.
 */
export function isValidSignal(s) {
    if (!s || typeof s !== 'object') return false;
    if (!s.id || typeof s.id !== 'string') return false;
    if (!s.platform || !SUPPORTED_PLATFORMS.includes(s.platform)) return false;
    if (!s.kind || !Object.values(SIGNAL_KINDS).includes(s.kind)) return false;
    return true;
}

/**
 * Normaliza texto para comparación.
 */
export function normalizeText(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Trunca texto preservando palabras.
 */
export function truncate(text, maxLen) {
    if (!text) return '';
    const s = String(text);
    if (s.length <= maxLen) return s;
    const cut = s.substring(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.7) return cut.substring(0, lastSpace) + '…';
    return cut + '…';
}
