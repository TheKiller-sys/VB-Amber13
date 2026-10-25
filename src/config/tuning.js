// src/config/tuning.js
// Constantes operativas centralizadas. Todo lo que antes estaba
// disperso en magic numbers vive aquí.

export const TUNING = Object.freeze({
    // ---------- LOOP ----------
    LOOP_INTERVAL_MS: 90_000,
    SIGNAL_MAX_PER_CYCLE: 20,
    SIGNAL_DEDUP_WINDOW_MS: 24 * 60 * 60 * 1000,

    // ---------- RATE LIMITS ----------
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX_REQ: 100,
    MIN_MS_BETWEEN_PROACTIVE_POSTS: 3 * 60 * 60 * 1000,

    // ---------- DRAFTS ----------
    DRAFT_MAX_LENGTH_TWITTER: 280,
    DRAFT_MAX_LENGTH_LINKEDIN: 3000,
    DRAFT_MAX_LENGTH_INSTAGRAM: 2200,
    DRAFT_MIN_LENGTH: 5,
    DRAFT_RECENT_DUPLICATE_CHECK_N: 20,

    // ---------- APPROVAL ----------
    PENDING_ACTION_TTL_MS: 72 * 60 * 60 * 1000, // 72h para aprobar/rechazar
    PENDING_MAX_ENTRIES: 500,

    // ---------- CRISIS ----------
    CRISIS_NEGATIVE_THRESHOLD: 3,
    CRISIS_WINDOW_MS: 60 * 60 * 1000,
    CRISIS_PAUSE_MS: 30 * 60 * 1000,

    // ---------- LLM ----------
    LLM_MAX_RETRIES: 3,
    LLM_RETRY_BACKOFF_MS: 1500,
    LLM_RETRY_BACKOFF_MAX_MS: 15000,

    // ---------- MEMORY ----------
    MEMORY_RECENT_ACTIONS_MAX: 100,
    MEMORY_RECENT_ACTIONS_DAYS: 30,

    // ---------- DB ----------
    DB_BUSY_TIMEOUT_MS: 5000,
    DB_CACHE_KB: 20_000,

    // ---------- LOGGER ----------
    LOG_MAX_STRING_LENGTH: 1000,
});

export function tuning(key, fallback) {
    return key in TUNING ? TUNING[key] : fallback;
}

export default TUNING;
