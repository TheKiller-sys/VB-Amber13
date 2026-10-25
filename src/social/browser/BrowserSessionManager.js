// src/social/browser/BrowserSessionManager.js
// Gestiona el ciclo de vida de Chromium/Playwright, el login manual
// del usuario, la persistencia cifrada de storage_state y la salud
// de cada sesión por plataforma.
//
// Interfaz pública:
//   initialize()
//   login(platform)                     → { ok, message|error, savedAt? }
//   withPage(platform, fn)              → ejecuta fn(page) con ciclo de vida seguro
//   checkChallenge(page)                → { challenged, ... }
//   markChallenge(platform, detail)
//   isChallengeActive(platform)         → bool
//   hasSession(platform)                → bool
//   healthCheck(platform)               → { ok, reason? }
//   healthCheckAll()                    → resultados por plataforma
//   invalidate(platform)                → borra storage_state y context
//   getState()                          → snapshot
//   shutdown()

import fs from 'node:fs';
import path from 'node:path';
import { getEnv } from '../../config/env.js';
import { getLogger } from '../../utils/logger.js';
import { TUNING } from '../../config/tuning.js';
import { SessionEncryption } from './SessionEncryption.js';
import { ChallengeDetector } from './ChallengeDetector.js';

// ============================================================
// LAZY LOAD DE PLAYWRIGHT
// ============================================================

let _pw = null;
async function getPlaywright() {
    if (!_pw) {
        _pw = await import('playwright');
    }
    return _pw;
}

// ============================================================
// CONSTANTES DE STEALTH
// ============================================================

const CHROMIUM_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--disable-infobars',
    '--disable-notifications',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1280,900',
    '--lang=es-ES,es',
];

const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const STEALTH_SCRIPT = () => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', {
        get: () => ['es-ES', 'es', 'en'],
    });
    Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
    });
    // window.chrome mínimo
    if (!window.chrome) {
        window.chrome = { runtime: {} };
    }
    // permissions.query: devolver 'granted' para notifications
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
        window.navigator.permissions.query = (params) =>
            params && params.name === 'notifications'
                ? Promise.resolve({ state: 'granted' })
                : origQuery(params);
    }
};

// ============================================================
// CONFIG DE LOGIN POR PLATAFORMA
// ============================================================

const LOGIN_CONFIGS = {
    twitter: {
        loginUrl: 'https://x.com/i/flow/login',
        homeUrl: 'https://x.com/home',
        async isLoggedIn(page) {
            const url = page.url();
            if (!url.includes('/home')) return false;
            const sel = [
                '[data-testid="SideNav_AccountSwitcher_Button"]',
                '[data-testid="SideNav_NewTweet_Button"]',
                '[aria-label="Post"]',
                '[aria-label="Publicar"]',
            ];
            for (const s of sel) {
                const n = await page.locator(s).count().catch(() => 0);
                if (n > 0) return true;
            }
            return false;
        },
    },
    instagram: {
        loginUrl: 'https://www.instagram.com/accounts/login/',
        homeUrl: 'https://www.instagram.com/',
        async isLoggedIn(page) {
            const url = page.url();
            if (url.includes('/accounts/login')) return false;
            if (url.includes('/challenge')) return false;
            const sel = [
                'svg[aria-label="Home"]',
                'svg[aria-label="Inicio"]',
                'a[href="/direct/inbox/"]',
                'a[href="/explore/"]',
            ];
            for (const s of sel) {
                const n = await page.locator(s).count().catch(() => 0);
                if (n > 0) return true;
            }
            return false;
        },
    },
    linkedin: {
        loginUrl: 'https://www.linkedin.com/login',
        homeUrl: 'https://www.linkedin.com/feed/',
        async isLoggedIn(page) {
            const url = page.url();
            if (url.includes('/login')) return false;
            if (url.includes('/checkpoint')) return false;
            if (!url.includes('/feed') && !url.includes('/mynetwork')) return false;
            const sel = [
                '.global-nav__me',
                '.feed-identity-module',
                '[data-control-name="nav.settings"]',
            ];
            for (const s of sel) {
                const n = await page.locator(s).count().catch(() => 0);
                if (n > 0) return true;
            }
            return false;
        },
    },
};

// ============================================================
// MANAGER
// ============================================================

export class BrowserSessionManager {
    constructor() {
        this.logger = getLogger().child({ component: 'BrowserSessionManager' });
        this.challengeDetector = new ChallengeDetector();

        this._browser = null;
        this._contexts = new Map();          // platform → BrowserContext
        this._challengeUntil = new Map();    // platform → timestamp ms
        this._lastChallenge = new Map();     // platform → { reason, detail, at }
        this._lastHealthCheck = new Map();   // platform → timestamp
        this._encryption = null;
        this._sessionDir = null;
        this._initialized = false;

        this.metrics = {
            logins: 0,
            loginFailures: 0,
            pagesOpened: 0,
            challengesDetected: 0,
            healthChecks: 0,
            healthCheckFailures: 0,
        };
    }

    async initialize() {
        if (this._initialized) return true;

        const env = getEnv();

        if (env.VB_AMBER_TRANSPORT !== 'scraping') {
            this.logger.info('BrowserSessionManager no-op (transport != scraping)');
            this._initialized = true;
            return true;
        }

        this._encryption = new SessionEncryption(env.VB_AMBER_SESSION_ENCRYPTION_KEY);
        this._sessionDir = path.resolve(env.VB_AMBER_SESSION_DIR);

        if (!fs.existsSync(this._sessionDir)) {
            fs.mkdirSync(this._sessionDir, { recursive: true });
            this.logger.info({ dir: this._sessionDir }, 'session directory created');
        }

        // Verificar que Playwright está instalado (si no, fallar rápido)
        try {
            await getPlaywright();
        } catch (err) {
            this.logger.error(
                { err: err.message },
                'Playwright no instalado. Ejecuta: npx playwright install chromium'
            );
            throw new Error(
                'Playwright no instalado. Ejecuta: npm install && npx playwright install chromium'
            );
        }

        this._initialized = true;
        this.logger.info({ sessionDir: this._sessionDir }, 'BrowserSessionManager listo');
        return true;
    }

    // ============================================================
    // LOGIN
    // ============================================================

    /**
     * Abre un navegador VISIBLE para que el usuario haga login manual.
     * Hace polling hasta detectar login OK, challenge persistente o timeout.
     *
     * @param {string} platform
     * @returns {Promise<{ ok: boolean, message?: string, error?: string, savedAt?: number }>}
     */
    async login(platform) {
        const cfg = LOGIN_CONFIGS[platform];
        if (!cfg) return { ok: false, error: 'unsupported_platform' };

        const env = getEnv();
        const pw = await getPlaywright();

        this.logger.info({ platform }, 'login flow started (ventana visible)');

        let browser;
        try {
            browser = await pw.chromium.launch({
                headless: false,          // login SIEMPRE visible
                args: CHROMIUM_ARGS,
            });
        } catch (err) {
            this.logger.error(
                { err: err.message },
                'no se pudo lanzar Chromium visible. En headless usar xvfb.'
            );
            return { ok: false, error: 'browser_launch_failed', detail: err.message };
        }

        try {
            const context = await browser.newContext({
                userAgent: USER_AGENT,
                viewport: { width: 1280, height: 900 },
                locale: 'es-ES',
                timezoneId: 'Europe/Madrid',
            });
            await context.addInitScript(STEALTH_SCRIPT);

            const page = await context.newPage();
            page.setDefaultTimeout(TUNING.SCRAPING_PAGE_TIMEOUT_MS);

            await page.goto(cfg.loginUrl, {
                waitUntil: 'domcontentloaded',
                timeout: TUNING.SCRAPING_NAV_TIMEOUT_MS,
            });

            const startedAt = Date.now();
            const timeout = env.VB_AMBER_SCRAPING_LOGIN_TIMEOUT_MS;
            let lastChallenge = null;

            while (Date.now() - startedAt < timeout) {
                await page.waitForTimeout(TUNING.SCRAPING_LOGIN_POLL_MS);

                // Detectar challenge (no abortamos: el usuario puede resolverlo)
                try {
                    const ch = await this.challengeDetector.detect(page);
                    if (ch.challenged) {
                        lastChallenge = ch;
                        this.logger.debug({ platform, ...ch }, 'challenge visible durante login');
                    }
                } catch (_) {}

                // ¿Login OK?
                try {
                    const ok = await cfg.isLoggedIn(page);
                    if (ok) {
                        const state = await context.storageState();
                        this._saveSession(platform, state);
                        this.metrics.logins++;
                        this.logger.info(
                            { platform, cookies: state.cookies?.length || 0 },
                            '✅ login successful, session saved'
                        );
                        return {
                            ok: true,
                            message: 'login successful',
                            savedAt: Date.now(),
                        };
                    }
                } catch (_) {}
            }

            this.metrics.loginFailures++;
            this.logger.warn(
                { platform, timeoutMs: timeout, hadChallenge: !!lastChallenge },
                'login timeout'
            );
            return {
                ok: false,
                error: 'login_timeout',
                detail: lastChallenge ? 'challenge_present' : null,
            };
        } finally {
            try { await browser.close(); } catch (_) {}
        }
    }

    // ============================================================
    // PAGES
    // ============================================================

    /**
     * Ejecuta `fn(page)` con un page nuevo, manejando challenge,
     * errores y guardado de storage_state al terminar.
     *
     * @param {string} platform
     * @param {(page: import('playwright').Page) => Promise<any>} fn
     * @returns {Promise<any>}
     */
    async withPage(platform, fn) {
        const opened = await this.openPage(platform);
        if (opened.error) {
            return { ok: false, error: opened.error, detail: opened.detail };
        }

        const { page } = opened;
        this.metrics.pagesOpened++;

        try {
            const result = await fn(page);
            // Detección final de challenge (por si acaso)
            try {
                const ch = await this.challengeDetector.detect(page);
                if (ch.challenged) {
                    this.markChallenge(platform, ch);
                    return { ok: false, error: 'challenge_detected', detail: ch };
                }
            } catch (_) {}
            return result;
        } catch (err) {
            this.logger.warn(
                { platform, err: err.message },
                'withPage: error en ejecución'
            );
            return { ok: false, error: 'execution_failed', detail: err.message };
        } finally {
            await this.closePage(platform, page);
        }
    }

    async openPage(platform) {
        const env = getEnv();

        if (this.isChallengeActive(platform)) {
            return {
                error: 'challenge_active',
                detail: this._lastChallenge.get(platform) || null,
            };
        }

        if (!this.hasSession(platform)) {
            return { error: 'no_session' };
        }

        if (!this._browser) {
            await this._launchBrowser();
        }

        let context = this._contexts.get(platform);
        if (!context) {
            context = await this._createContext(platform);
            if (!context) return { error: 'context_failed' };
            this._contexts.set(platform, context);
        }

        const page = await context.newPage();
        page.setDefaultTimeout(TUNING.SCRAPING_PAGE_TIMEOUT_MS);

        // Red de seguridad: detectar challenge en cada navegación
        page.on('framenavigated', (frame) => {
            if (frame !== page.mainFrame()) return;
            setTimeout(async () => {
                try {
                    const ch = await this.challengeDetector.detect(page);
                    if (ch.challenged) {
                        this.logger.error(
                            { platform, ...ch },
                            'challenge detectado mid-navigation'
                        );
                        this.markChallenge(platform, ch);
                    }
                } catch (_) {}
            }, 600);
        });

        return { page, context };
    }

    async closePage(platform, page) {
        // Guardar storage_state ANTES de cerrar (por rotación de cookies)
        const context = this._contexts.get(platform);
        if (context) {
            try {
                const state = await context.storageState();
                this._saveSession(platform, state);
            } catch (err) {
                this.logger.debug(
                    { platform, err: err.message },
                    'no se pudo guardar storage_state al cerrar'
                );
            }
        }
        try { await page.close(); } catch (_) {}
    }

    async _launchBrowser() {
        const env = getEnv();
        const pw = await getPlaywright();

        this._browser = await pw.chromium.launch({
            headless: !!env.VB_AMBER_SCRAPING_HEADLESS,
            args: CHROMIUM_ARGS,
        });

        this.logger.info(
            { headless: !!env.VB_AMBER_SCRAPING_HEADLESS },
            'chromium launched'
        );
    }

    async _createContext(platform) {
        if (!this._browser) return null;

        const state = this._loadSession(platform);
        if (!state) return null;

        try {
            const context = await this._browser.newContext({
                userAgent: USER_AGENT,
                viewport: { width: 1280, height: 900 },
                locale: 'es-ES',
                timezoneId: 'Europe/Madrid',
                storageState: state,
            });
            await context.addInitScript(STEALTH_SCRIPT);
            return context;
        } catch (err) {
            this.logger.error(
                { platform, err: err.message },
                'no se pudo crear context con storage_state'
            );
            return null;
        }
    }

    // ============================================================
    // CHALLENGE
    // ============================================================

    async checkChallenge(page) {
        return this.challengeDetector.detect(page);
    }

    markChallenge(platform, detail) {
        const env = getEnv();
        const until = Date.now() + TUNING.SCRAPING_CHALLENGE_COOLDOWN_MS;

        this._challengeUntil.set(platform, until);
        this._lastChallenge.set(platform, {
            reason: detail?.reason || 'unknown',
            detail: detail?.detail || null,
            url: detail?.url || null,
            at: Date.now(),
        });
        this.metrics.challengesDetected++;

        // Cerrar context para forzar re-login si el usuario decide hacerlo
        const ctx = this._contexts.get(platform);
        if (ctx) {
            ctx.close().catch(() => {});
            this._contexts.delete(platform);
        }

        this.logger.error(
            {
                platform,
                reason: detail?.reason,
                detail: detail?.detail,
                cooldownMs: TUNING.SCRAPING_CHALLENGE_COOLDOWN_MS,
            },
            '🚨 CHALLENGE detectado — plataforma pausada'
        );
    }

    isChallengeActive(platform) {
        const until = this._challengeUntil.get(platform);
        if (!until) return false;
        if (Date.now() >= until) {
            this._challengeUntil.delete(platform);
            this._lastChallenge.delete(platform);
            this.logger.info({ platform }, 'challenge cooldown expired');
            return false;
        }
        return true;
    }

    getChallengeInfo(platform) {
        const until = this._challengeUntil.get(platform);
        return {
            active: this.isChallengeActive(platform),
            until: until || null,
            remainingMs: until ? Math.max(0, until - Date.now()) : 0,
            last: this._lastChallenge.get(platform) || null,
        };
    }

    // ============================================================
    // SESIÓN
    // ============================================================

    hasSession(platform) {
        const file = this._sessionPath(platform);
        return fs.existsSync(file);
    }

    _sessionPath(platform) {
        return path.join(this._sessionDir, `${platform}.enc`);
    }

    _saveSession(platform, state) {
        if (!this._encryption) return;
        try {
            const enc = this._encryption.encrypt(state);
            const file = this._sessionPath(platform);
            fs.writeFileSync(file, enc, { mode: 0o600 });
        } catch (err) {
            this.logger.error(
                { platform, err: err.message },
                'no se pudo guardar session'
            );
        }
    }

    _loadSession(platform) {
        if (!this._encryption) return null;
        const file = this._sessionPath(platform);
        if (!fs.existsSync(file)) return null;
        try {
            const buf = fs.readFileSync(file);
            const json = this._encryption.decrypt(buf);
            return JSON.parse(json);
        } catch (err) {
            this.logger.error(
                { platform, err: err.message },
                'no se pudo cargar session (¿clave incorrecta o fichero corrupto?)'
            );
            return null;
        }
    }

    invalidate(platform) {
        const file = this._sessionPath(platform);
        try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (_) {}

        const ctx = this._contexts.get(platform);
        if (ctx) {
            ctx.close().catch(() => {});
            this._contexts.delete(platform);
        }

        this._challengeUntil.delete(platform);
        this._lastChallenge.delete(platform);

        this.logger.warn({ platform }, 'session invalidada');
    }

    // ============================================================
    // HEALTH CHECK
    // ============================================================

    /**
     * Navega a home de la plataforma con la sesión cargada y verifica
     * que no hay redirect a login ni challenge.
     */
    async healthCheck(platform) {
        const cfg = LOGIN_CONFIGS[platform];
        if (!cfg) return { ok: false, reason: 'unsupported_platform' };

        if (!this.hasSession(platform)) {
            return { ok: false, reason: 'no_session' };
        }

        if (this.isChallengeActive(platform)) {
            return { ok: false, reason: 'challenge_active' };
        }

        const env = getEnv();
        const wasHeadless = this._browser ? true : null;

        try {
            if (!this._browser) await this._launchBrowser();

            const context = await this._createContext(platform);
            if (!context) return { ok: false, reason: 'context_failed' };

            const page = await context.newPage();
            page.setDefaultTimeout(TUNING.SCRAPING_PAGE_TIMEOUT_MS);

            try {
                await page.goto(cfg.homeUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: TUNING.SCRAPING_NAV_TIMEOUT_MS,
                });
                await page.waitForTimeout(1500);

                // Challenge?
                const ch = await this.challengeDetector.detect(page);
                if (ch.challenged) {
                    this.markChallenge(platform, ch);
                    return { ok: false, reason: 'challenge', detail: ch };
                }

                // ¿Sigue logueado?
                const ok = await cfg.isLoggedIn(page);
                if (!ok) {
                    return { ok: false, reason: 'session_expired' };
                }

                // Guardar storage_state actualizado
                const state = await context.storageState();
                this._saveSession(platform, state);

                this.metrics.healthChecks++;
                this._lastHealthCheck.set(platform, Date.now());
                return { ok: true };
            } finally {
                try { await page.close(); } catch (_) {}
                try { await context.close(); } catch (_) {}
                this._contexts.delete(platform);
            }
        } catch (err) {
            this.metrics.healthCheckFailures++;
            return { ok: false, reason: 'exception', detail: err.message };
        }
    }

    async healthCheckAll() {
        const results = {};
        for (const platform of Object.keys(LOGIN_CONFIGS)) {
            if (!this.hasSession(platform)) continue;
            results[platform] = await this.healthCheck(platform);
        }
        return results;
    }

    // ============================================================
    // STATE
    // ============================================================

    getState() {
        const platforms = {};
        for (const p of Object.keys(LOGIN_CONFIGS)) {
            platforms[p] = {
                hasSession: this.hasSession(p),
                challenge: this.getChallengeInfo(p),
                lastHealthCheck: this._lastHealthCheck.get(p) || null,
                contextOpen: this._contexts.has(p),
            };
        }
        return {
            browserActive: !!this._browser,
            platforms,
            metrics: { ...this.metrics },
            sessionDir: this._sessionDir,
        };
    }

    async shutdown() {
        for (const [platform, ctx] of this._contexts) {
            try { await ctx.close(); } catch (_) {}
        }
        this._contexts.clear();

        if (this._browser) {
            try { await this._browser.close(); } catch (_) {}
            this._browser = null;
        }
        this.logger.info('BrowserSessionManager shutdown');
    }
}

export default BrowserSessionManager;
