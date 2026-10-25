// src/social/adapters/index.js
// Gestor de adapters. Instancia y enruta por plataforma.

import { getLogger } from '../../utils/logger.js';
import { PLATFORMS } from '../types.js';
import TwitterAdapter from './twitter.js';
import InstagramAdapter from './instagram.js';
import LinkedInAdapter from './linkedin.js';

export class AdapterManager {
    constructor() {
        this.adapters = new Map();
        this.logger = getLogger().child({ component: 'AdapterManager' });
    }

    async initialize() {
        const instances = [
            new TwitterAdapter(),
            new InstagramAdapter(),
            new LinkedInAdapter(),
        ];

        for (const adapter of instances) {
            try {
                const ok = await adapter.initialize();
                this.adapters.set(adapter.name, adapter);
                this.logger.debug(
                    { platform: adapter.name, enabled: ok },
                    'adapter registered'
                );
            } catch (err) {
                this.logger.error(
                    { platform: adapter.name, err: err.message },
                    'adapter init failed'
                );
            }
        }
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
     */
    async ingestAll() {
        const signals = [];

        // Twitter
        const tw = this.get(PLATFORMS.TWITTER);
        if (tw?.enabled) {
            try {
                const mentions = await tw.readMentions({ maxResults: 10 });
                const dms = await tw.readDMs({ maxResults: 10 });
                signals.push(...mentions, ...dms);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'twitter ingest failed');
            }
        }

        // Instagram
        const ig = this.get(PLATFORMS.INSTAGRAM);
        if (ig?.enabled) {
            try {
                const comments = await ig.readRecentComments({ maxPosts: 3 });
                signals.push(...comments);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'instagram ingest failed');
            }
        }

        // LinkedIn
        const li = this.get(PLATFORMS.LINKEDIN);
        if (li?.enabled) {
            try {
                const comments = await li.readRecentComments({ maxShares: 3 });
                signals.push(...comments);
            } catch (err) {
                this.logger.warn({ err: err.message }, 'linkedin ingest failed');
            }
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
