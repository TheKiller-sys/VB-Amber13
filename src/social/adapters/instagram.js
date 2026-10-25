// src/social/adapters/instagram.js
// Adapter de Instagram via Meta Graph API (Instagram Business/Creator).
// Requiere: cuenta business + app aprobada + permisos.
// Instagram NO permite automatización no oficial — solo Graph API.

import { getLogger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import { withRetry } from '../../utils/retry.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../types.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export class InstagramAdapter {
    constructor() {
        this.name = PLATFORMS.INSTAGRAM;
        this.enabled = false;
        this.accessToken = null;
        this.businessAccountId = null;
        this.appSecret = null;
        this.logger = getLogger().child({ component: 'InstagramAdapter' });
    }

    async initialize() {
        const env = getEnv();
        if (!env.INSTAGRAM_ENABLED) {
            this.logger.info('Instagram deshabilitado');
            return false;
        }
        if (!env.INSTAGRAM_ACCESS_TOKEN || !env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
            this.logger.warn('credenciales de Instagram incompletas');
            return false;
        }

        this.accessToken = env.INSTAGRAM_ACCESS_TOKEN;
        this.businessAccountId = env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
        this.appSecret = env.INSTAGRAM_APP_SECRET || null;
        this.enabled = true;

        this.logger.info(
            { businessAccountId: this.businessAccountId },
            'InstagramAdapter listo'
        );
        return true;
    }

    // ============================================================
    // LECTURA
    // ============================================================

    /**
     * Lee comentarios recientes del feed del negocio.
     * Meta no expone "todos los comentarios del feed" en un endpoint único;
     * hay que iterar posts y luego sus comentarios.
     */
    async readRecentComments({ maxPosts = 5, maxCommentsPerPost = 10 } = {}) {
        if (!this.enabled) return [];

        const signals = [];

        try {
            // 1. Obtener últimos posts
            const mediaUrl = `${GRAPH_BASE}/${this.businessAccountId}/media` +
                `?fields=id,caption,timestamp,permalink,comments_count&limit=${maxPosts}` +
                `&access_token=${encodeURIComponent(this.accessToken)}`;

            const mediaRes = await withRetry(
                () => this._fetchJSON(mediaUrl),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            const posts = mediaRes?.data || [];

            for (const post of posts) {
                if (!post.id) continue;
                if ((post.comments_count || 0) === 0) continue;

                try {
                    const commentsUrl = `${GRAPH_BASE}/${post.id}/comments` +
                        `?fields=id,text,username,timestamp,from&limit=${maxCommentsPerPost}` +
                        `&access_token=${encodeURIComponent(this.accessToken)}`;

                    const commentsRes = await withRetry(
                        () => this._fetchJSON(commentsUrl),
                        { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
                    );

                    for (const c of (commentsRes?.data || [])) {
                        signals.push(makeSignal({
                            id: `ig_comment_${c.id}`,
                            platform: PLATFORMS.INSTAGRAM,
                            kind: SIGNAL_KINDS.COMMENT,
                            author: c.username || c.from?.username || c.from?.id || null,
                            text: c.text || '',
                            receivedAt: c.timestamp ? new Date(c.timestamp).getTime() : Date.now(),
                            externalId: c.id,
                            threadParentId: post.id,
                            raw: { comment: c, postId: post.id, permalink: post.permalink },
                        }));
                    }
                } catch (err) {
                    this.logger.warn(
                        { postId: post.id, err: err.message },
                        'comments fetch failed for post'
                    );
                }
            }

            this.logger.debug({ count: signals.length }, 'instagram comments fetched');
            return signals;
        } catch (err) {
            this.logger.warn({ err: err.message }, 'instagram readRecentComments failed');
            return [];
        }
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    /**
     * Publica una imagen. Instagram EXIGE imagen; no hay posts de solo texto.
     * @param {Object} opts — { imageUrl, caption }
     */
    async postImage({ imageUrl, caption } = {}) {
        if (!this.enabled) return { ok: false, error: 'instagram_disabled' };
        if (!imageUrl) return { ok: false, error: 'imageUrl_required' };

        try {
            // Paso 1: crear container
            const createUrl = `${GRAPH_BASE}/${this.businessAccountId}/media` +
                `?image_url=${encodeURIComponent(imageUrl)}` +
                `&caption=${encodeURIComponent(caption || '')}` +
                `&access_token=${encodeURIComponent(this.accessToken)}`;

            const createRes = await withRetry(
                () => this._fetchJSON(createUrl, { method: 'POST' }),
                { maxRetries: 2, baseMs: 2000, maxMs: 10000 }
            );

            const creationId = createRes?.id;
            if (!creationId) {
                return { ok: false, error: 'creation_failed', raw: createRes };
            }

            // Paso 2: publicar container
            const publishUrl = `${GRAPH_BASE}/${this.businessAccountId}/media_publish` +
                `?creation_id=${encodeURIComponent(creationId)}` +
                `&access_token=${encodeURIComponent(this.accessToken)}`;

            const publishRes = await withRetry(
                () => this._fetchJSON(publishUrl, { method: 'POST' }),
                { maxRetries: 2, baseMs: 2000, maxMs: 10000 }
            );

            const mediaId = publishRes?.id;
            this.logger.info({ mediaId, creationId }, 'instagram published');

            return {
                ok: true,
                externalId: mediaId,
                externalUrl: mediaId ? `https://instagram.com/p/${mediaId}` : null,
                raw: publishRes,
            };
        } catch (err) {
            this.logger.error({ err: err.message }, 'instagram postImage failed');
            return { ok: false, error: err.message };
        }
    }

    /**
     * Responde a un comentario.
     * @param {Object} opts — { commentId, message }
     */
    async replyToComment({ commentId, message } = {}) {
        if (!this.enabled) return { ok: false, error: 'instagram_disabled' };
        if (!commentId || !message) {
            return { ok: false, error: 'commentId_and_message_required' };
        }

        try {
            const url = `${GRAPH_BASE}/${commentId}/replies` +
                `?message=${encodeURIComponent(message)}` +
                `&access_token=${encodeURIComponent(this.accessToken)}`;

            const res = await withRetry(
                () => this._fetchJSON(url, { method: 'POST' }),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            return {
                ok: true,
                externalId: res?.id,
                raw: res,
            };
        } catch (err) {
            this.logger.warn({ err: err.message }, 'instagram replyToComment failed');
            return { ok: false, error: err.message };
        }
    }

    // ============================================================
    // WEBHOOKS
    // ============================================================

    /**
     * Verifica el challenge de Meta (webhook setup).
     */
    verifyWebhook({ mode, token, challenge }) {
        const env = getEnv();
        if (mode === 'subscribe' && token === env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
            return { ok: true, challenge };
        }
        return { ok: false };
    }

    /**
     * Procesa un payload de webhook de Meta.
     * Formato: { entry: [{ changes: [{ field, value }] }] }
     */
    async processWebhook(payload) {
        if (!this.enabled) return [];
        const signals = [];

        try {
            const entries = Array.isArray(payload?.entry) ? payload.entry : [];
            for (const entry of entries) {
                const changes = Array.isArray(entry?.changes) ? entry.changes : [];
                for (const change of changes) {
                    if (change.field !== 'comments' && change.field !== 'mentions') continue;
                    const v = change.value || {};
                    if (!v.id && !v.comment_id) continue;
                    signals.push(makeSignal({
                        id: `ig_wh_${v.id || v.comment_id}`,
                        platform: PLATFORMS.INSTAGRAM,
                        kind: v.media ? SIGNAL_KINDS.COMMENT : SIGNAL_KINDS.MENTION,
                        author: v.from?.username || v.from?.id || null,
                        text: v.text || '',
                        receivedAt: Date.now(),
                        externalId: v.id || v.comment_id,
                        threadParentId: v.media?.id || null,
                        raw: v,
                    }));
                }
            }
        } catch (err) {
            this.logger.warn({ err: err.message }, 'instagram processWebhook failed');
        }
        return signals;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    async _fetchJSON(url, opts = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        if (timer.unref) timer.unref();

        try {
            const res = await fetch(url, {
                method: opts.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
            const text = await res.text();
            if (!res.ok) {
                const err = new Error(`IG HTTP ${res.status}: ${text.substring(0, 300)}`);
                err.status = res.status;
                throw err;
            }
            return text ? JSON.parse(text) : {};
        } finally {
            clearTimeout(timer);
        }
    }

    async shutdown() {
        this.enabled = false;
        this.accessToken = null;
        this.logger.info('InstagramAdapter shutdown');
    }
}

export default InstagramAdapter;
