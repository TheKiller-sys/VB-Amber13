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

    // ============================================================
    // SCRAPING (transporte alternativo a API oficial)
    // ============================================================

    // Delays humanos entre acciones (jitter aleatorio)
    SCRAPING_HUMAN_DELAY_MIN_MS: 800,
    SCRAPING_HUMAN_DELAY_MAX_MS: 2500,

    // Timeouts internos de Playwright
    SCRAPING_PAGE_TIMEOUT_MS: 45000,
    SCRAPING_NAV_TIMEOUT_MS: 30000,

    // Cuánto espera el sistema a que el usuario termine el login manual
    SCRAPING_LOGIN_TIMEOUT_MS: 300_000, // 5 min

    // Cada cuánto se revalida la sesión guardada
    SCRAPING_HEALTH_CHECK_INTERVAL_MS: 900_000, // 15 min

    // Límites conservadores (más bajos que API para reducir detección)
    SCRAPING_MAX_POSTS_PER_DAY: 3,
    SCRAPING_MAX_REPLIES_PER_HOUR: 2,
    SCRAPING_MIN_MS_BETWEEN_POSTS: 3 * 60 * 60 * 1000, // 3h

    // Cooldown automático cuando se detecta un challenge.
    // Pasado este tiempo, la plataforma se reanuda sola (el challenge puede ser transitorio).
    SCRAPING_CHALLENGE_COOLDOWN_MS: 60 * 60 * 1000, // 1h

    // Polling para detectar login exitoso (ms entre checks)
    SCRAPING_LOGIN_POLL_MS: 2000,

    // Cuántos posts/comentarios leer por ciclo en scraping
    SCRAPING_READ_MAX_ITEMS: 10,
    SCRAPING_SCROLL_ITERATIONS: 3,
    SCRAPING_SCROLL_PX: 800,
});

export function tuning(key, fallback) {
    return key in TUNING ? TUNING[key] : fallback;
}

export default TUNING;
