// src/social/adapters/index.js
// Gestor de adapters. Instancia y enruta por plataforma.
//
// Según VB_AMBER_TRANSPORT:
//   - 'api'      → adapters de API oficial (twitter-api-v2, Graph, v2)
//   - 'scraping' → adapters de Playwright con sesión cifrada
//
// La interfaz pública es idéntica en ambos casos: execute(), ingestAll(),
// isEnabled(), listEnabled(), get(), isChallengeActive(), getSessionsState().

import { getLogger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import { PLATFORMS } from '../types.js';

// Adapters de API oficial
import TwitterApiAdapter from './twitter.js';
import InstagramApiAdapter from './instagram.js';
import LinkedInApiAdapter from './linkedin.js';

// Adapters de scraping
import TwitterScrapingAdapter from './scraping/twitter.js';
import InstagramScrapingAdapter from './scraping/instagram.js';
import LinkedInScrapingAdapter from './scraping/linkedin.js';

export class AdapterManager {
    /**
     * @param {Object} deps
     *   - sessions {BrowserSessionManager|null}  obligatorio en scraping
     *   - database {DatabaseManager|null}        obligatorio en scraping
     */
    constructor({ sessions = null, database = null } = {}) {
        this.sessions = sessions;
        this.database = database;
        this.adapters = new Map();
        this.transport = null;
        this.logger = getLogger().child({ component: 'AdapterManager' });
    }

    async initialize() {
        const env = getEnv();
        this.transport = env.VB_AMBER_TRANSPORT;

        let instances;

        if (this.transport === 'scraping') {
            if (!this.sessions) {
                throw new Error(
                    'AdapterManager: transport=scraping requiere BrowserSessionManager'
                );
            }
            if (!this.database) {
                throw new Error(
                    'AdapterManager: transport=scraping requiere DatabaseManager'
                );
            }
            instances = [
                new TwitterScrapingAdapter({
                    sessions: this.sessions,
                    database: this.database,
                }),
                new InstagramScrapingAdapter({
                    sessions: this.sessions,
                    database: this.database,
                }),
                new LinkedInScrapingAdapter({
                    sessions: this.sessions,
                    database: this.database,
                }),
            ];
        } else {
            instances = [
                new TwitterApiAdapter(),
                new InstagramApiAdapter(),
                new LinkedInApiAdapter(),
            ];
        }

        for (const adapter of instances) {
            try {
                const ok = await adapter.initialize();
                this.adapters.set(adapter.name, adapter);
                this.logger.debug(
                    {
                        platform: adapter.name,
                        enabled: ok,
                        transport: this.transport,
                    },
                    'adapter registered'
                );
            } catch (err) {
                this.logger.error(
                    { platform: adapter.name, err: err.message },
                    'adapter init failed'
                );
            }
        }

        this.logger.info(
            {
                transport: this.transport,
                registered: Array.from(this.adapters.keys()),
                enabled: this.listEnabled(),
            },
            'AdapterManager listo'
        );
    }

    get(platform) {
        return this.adapters.get(platform) || null;
    }

    isEnabled(platform) {
        const a = this.adapters.get(platform);
        return !!(a && a.enabled);
    }

    listEnabled() {
        const out = [];
        for (const [name, a] of this.adapters) {
            if (a.enabled) out.push(name);
        }
        return out;
    }

    /**
     * ¿Hay un challenge activo en esta plataforma? Solo scraping.
     */
    isChallengeActive(platform) {
        return !!(this.sessions && this.sessions.isChallengeActive(platform));
    }

    /**
     * Estado de sesiones (null en modo API).
     */
    getSessionsState() {
        return this.sessions ? this.sessions.getState() : null;
    }

    /**
     * Ejecuta una acción de escritura en la plataforma correcta.
     * @param {string} action — nombre de la acción (ACTIONS.*)
     * @param {Object} params
     */
    async execute(action, params) {
        // Enrutar por acción
        if (action === 'twitter_post') {
            const a = this.get(PLATFORMS.TWITTER);
            if (!a) return { ok: false, error: 'twitter_not_configured' };
            return a.postTweet({ text: params.text });
        }

        if (action === 'twitter_reply') {
            const a = this.get(PLATFORMS.TWITTER);
            if (!a) return { ok: false, error: 'twitter_not_configured' };
            return a.replyToTweet({ text: params.text, replyTo: params.replyTo });
        }

        if (action === 'twitter_dm_reply') {
            const a = this.get(PLATFORMS.TWITTER);
            if (!a) return { ok: false, error: 'twitter_not_configured' };
            if (typeof a.sendDM !== 'function') {
                return { ok: false, error: 'dm_not_supported_by_transport' };
            }
            return a.sendDM({ text: params.text, recipientId: params.recipientId });
        }

        if (action === 'twitter_delete') {
            const a = this.get(PLATFORMS.TWITTER);
            if (!a) return { ok: false, error: 'twitter_not_configured' };
            return a.deleteTweet({ tweetId: params.tweetId });
        }

        if (action === 'instagram_post') {
            const a = this.get(PLATFORMS.INSTAGRAM);
            if (!a) return { ok: false, error: 'instagram_not_configured' };
            return a.postImage({ imageUrl: params.imageUrl, caption: params.text });
        }

        if (action === 'instagram_comment_reply') {
            const a = this.get(PLATFORMS.INSTAGRAM);
            if (!a) return { ok: false, error: 'instagram_not_configured' };
            return a.replyToComment({ commentId: params.commentId, message: params.text });
        }

        if (action === 'linkedin_post') {
            const a = this.get(PLATFORMS.LINKEDIN);
            if (!a) return { ok: false, error: 'linkedin_not_configured' };
            return a.postText({ text: params.text });
        }

        if (action === 'linkedin_comment_reply') {
            const a = this.get(PLATFORMS.LINKEDIN);
            if (!a) return { ok: false, error: 'linkedin_not_configured' };
            return a.replyToComment({ shareUrn: params.shareUrn, text: params.text });
        }

        return { ok: false, error: `unknown_action:${action}` };
    }

    /**
     * Recoge señales de todas las plataformas habilitadas.
     * En scraping, salta plataformas con challenge activo.
     */
    async ingestAll() {
        const signals = [];

        // Twitter
        const tw = this.get(PLATFORMS.TWITTER);
        if (tw?.enabled && !this.isChallengeActive(PLATFORMS.TWITTER)) {
            try {
                const mentions = await tw.readMentions({ maxResults: 10 });
                const dms = typeof tw.readDMs === 'function'
                    ? await tw.readDMs({ maxResults: 10 })
                    : [];
                signals.push(...mentions, ...dms);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'twitter ingest failed');
            }
        } else if (tw?.enabled) {
            this.logger.warn(
                { platform: PLATFORMS.TWITTER },
                'twitter ingest skipped: challenge active'
            );
        }

        // Instagram
        const ig = this.get(PLATFORMS.INSTAGRAM);
        if (ig?.enabled && !this.isChallengeActive(PLATFORMS.INSTAGRAM)) {
            try {
                const comments = await ig.readRecentComments({ maxPosts: 3 });
                signals.push(...comments);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'instagram ingest failed');
            }
        } else if (ig?.enabled) {
            this.logger.warn(
                { platform: PLATFORMS.INSTAGRAM },
                'instagram ingest skipped: challenge active'
            );
        }

        // LinkedIn
        const li = this.get(PLATFORMS.LINKEDIN);
        if (li?.enabled && !this.isChallengeActive(PLATFORMS.LINKEDIN)) {
            try {
                const comments = await li.readRecentComments({ maxShares: 3 });
                signals.push(...comments);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'linkedin ingest failed');
            }
        } else if (li?.enabled) {
            this.logger.warn(
                { platform: PLATFORMS.LINKEDIN },
                'linkedin ingest skipped: challenge active'
            );
        }

        return signals;
    }

    async shutdown() {
        for (const a of this.adapters.values()) {
            try { await a.shutdown(); } catch (_) {}
        }
    }
}

export default AdapterManager;
