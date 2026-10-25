// src/social/adapters/twitter.js
// Adapter de Twitter/X via twitter-api-v2 (OAuth 1.0a + OAuth 2.0 Bearer).
// Funciona en modo read (mentions, DMs) y write (post, reply).

import { TwitterApi } from 'twitter-api-v2';
import { getLogger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import { withRetry } from '../../utils/retry.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../types.js';
import { shortHash } from '../../utils/hash.js';

export class TwitterAdapter {
    constructor() {
        this.name = PLATFORMS.TWITTER;
        this.enabled = false;
        this.client = null;
        this.bearerClient = null;
        this.userId = null;
        this.logger = getLogger().child({ component: 'TwitterAdapter' });
    }

    async initialize() {
        const env = getEnv();
        if (!env.TWITTER_ENABLED) {
            this.logger.info('Twitter deshabilitado');
            return false;
        }

        if (!env.TWITTER_API_KEY || !env.TWITTER_API_SECRET ||
            !env.TWITTER_ACCESS_TOKEN || !env.TWITTER_ACCESS_SECRET) {
            this.logger.warn('credenciales de Twitter incompletas; adapter deshabilitado');
            return false;
        }

        try {
            this.client = new TwitterApi({
                appKey: env.TWITTER_API_KEY,
                appSecret: env.TWITTER_API_SECRET,
                accessToken: env.TWITTER_ACCESS_TOKEN,
                accessSecret: env.TWITTER_ACCESS_SECRET,
            });

            if (env.TWITTER_BEARER_TOKEN) {
                this.bearerClient = new TwitterApi(env.TWITTER_BEARER_TOKEN);
            }

            // Resolver user ID si no está
            this.userId = env.TWITTER_USER_ID || null;
            if (!this.userId) {
                try {
                    const me = await this.client.v2.me();
                    this.userId = me.data.id;
                    this.logger.info({ userId: this.userId, handle: me.data.username }, 'Twitter user resolved');
                } catch (err) {
                    this.logger.error({ err: err.message }, 'no se pudo resolver Twitter user id');
                    return false;
                }
            }

            this.enabled = true;
            this.logger.info({ userId: this.userId }, 'TwitterAdapter listo');
            return true;
        } catch (err) {
            this.logger.error({ err: err.message }, 'Twitter init failed');
            return false;
        }
    }

    // ============================================================
    // LECTURA
    // ============================================================

    /**
     * Lee menciones recientes.
     * @param {Object} opts — { sinceId, maxResults }
     * @returns {Promise<Array<Signal>>}
     */
    async readMentions({ sinceId = null, maxResults = 10 } = {}) {
        if (!this.enabled) return [];

        try {
            const params = {
                max_results: Math.max(5, Math.min(100, maxResults)),
                'tweet.fields': ['author_id', 'created_at', 'conversation_id', 'in_reply_to_user_id', 'text'],
                'user.fields': ['username', 'name'],
                expansions: ['author_id'],
            };
            if (sinceId) params.since_id = sinceId;

            const result = await withRetry(
                () => this.client.v2.userMentionTimeline(this.userId, params),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            const users = new Map();
            for (const u of (result.includes?.users || [])) {
                users.set(u.id, u);
            }

            const signals = [];
            for (const tweet of (result.tweets || [])) {
                const author = users.get(tweet.author_id);
                signals.push(makeSignal({
                    id: `tw_mention_${tweet.id}`,
                    platform: PLATFORMS.TWITTER,
                    kind: SIGNAL_KINDS.MENTION,
                    author: author?.username || tweet.author_id,
                    text: tweet.text,
                    receivedAt: tweet.created_at ? new Date(tweet.created_at).getTime() : Date.now(),
                    externalId: tweet.id,
                    threadParentId: tweet.conversation_id,
                    raw: tweet,
                }));
            }

            this.logger.debug({ count: signals.length }, 'twitter mentions fetched');
            return signals;
        } catch (err) {
            this.logger.warn({ err: err.message }, 'twitter readMentions failed');
            return [];
        }
    }

    /**
     * Lee DMs recientes no leídos.
     */
    async readDMs({ maxResults = 10 } = {}) {
        if (!this.enabled) return [];

        try {
            const result = await withRetry(
                () => this.client.v2.listDmEvents({ max_results: maxResults }),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            const signals = [];
            for (const ev of (result.events || [])) {
                if (ev.event_type !== 'MessageCreate') continue;
                if (ev.sender_id === this.userId) continue;
                const dm = ev;
                signals.push(makeSignal({
                    id: `tw_dm_${dm.id}`,
                    platform: PLATFORMS.TWITTER,
                    kind: SIGNAL_KINDS.DM,
                    author: dm.sender_id,
                    text: dm.text || dm.message_create?.message_data?.text || '',
                    receivedAt: dm.created_at ? new Date(dm.created_at).getTime() : Date.now(),
                    externalId: dm.id,
                    raw: dm,
                }));
            }
            this.logger.debug({ count: signals.length }, 'twitter DMs fetched');
            return signals;
        } catch (err) {
            this.logger.warn({ err: err.message }, 'twitter readDMs failed');
            return [];
        }
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    /**
     * Publica un tweet.
     * @param {Object} opts — { text, replyTo }
     */
    async postTweet({ text, replyTo = null } = {}) {
        if (!this.enabled) {
            return { ok: false, error: 'twitter_disabled' };
        }
        if (!text || typeof text !== 'string') {
            return { ok: false, error: 'text_required' };
        }

        try {
            const params = {};
            if (replyTo) {
                params.reply = { in_reply_to_tweet_id: String(replyTo) };
            }

            const result = await withRetry(
                () => this.client.v2.tweet(text, params),
                {
                    maxRetries: 1,
                    baseMs: 2000,
                    maxMs: 5000,
                    retryable: (err) => {
                        const status = err?.code || err?.response?.status;
                        if (status === 429) return true;
                        if (status >= 500) return true;
                        return false;
                    },
                }
            );

            const tweetId = result.data?.id;
            this.logger.info({ tweetId, replyTo }, 'tweet published');

            return {
                ok: true,
                externalId: tweetId,
                externalUrl: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : null,
                raw: result,
            };
        } catch (err) {
            const status = err?.code || err?.response?.status;
            const isCredit = status === 402 || status === 429;
            this.logger.error({ err: err.message, status }, 'tweet publish failed');
            return {
                ok: false,
                error: err.message,
                status,
                credit: isCredit,
            };
        }
    }

    /**
     * Responde a un tweet específico.
     */
    async replyToTweet({ text, replyTo } = {}) {
        if (!replyTo) return { ok: false, error: 'replyTo_required' };
        return this.postTweet({ text, replyTo });
    }

    /**
     * Envía un DM.
     */
    async sendDM({ text, recipientId } = {}) {
        if (!this.enabled) return { ok: false, error: 'twitter_disabled' };
        if (!text || !recipientId) return { ok: false, error: 'text_and_recipient_required' };

        try {
            const result = await this.client.v2.sendDmInConversation
                ? await this.client.v2.sendDmInConversation({ text, participant_id: recipientId })
                : await this.client.v1.sendDm({ text, user_id: recipientId });

            return { ok: true, raw: result };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Borra un tweet.
     */
    async deleteTweet({ tweetId } = {}) {
        if (!this.enabled) return { ok: false, error: 'twitter_disabled' };
        try {
            await this.client.v2.deleteTweet(tweetId);
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // ============================================================
    // WEBHOOKS / STREAMING (opcional)
    // ============================================================

    /**
     * Twitter soporta Account Activity API (webhooks) pero es compleja
     * y de pago. Por defecto usamos polling en el SocialAutonomyLoop.
     *
     * Dejamos esto como hook futuro.
     */
    async processWebhook(_payload) {
        this.logger.warn('Twitter webhook no implementado (usar polling)');
        return [];
    }

    async shutdown() {
        this.enabled = false;
        this.client = null;
        this.bearerClient = null;
        this.logger.info('TwitterAdapter shutdown');
    }
}

export default TwitterAdapter;
