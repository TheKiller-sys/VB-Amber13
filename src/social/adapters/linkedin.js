// src/social/adapters/linkedin.js
// Adapter de LinkedIn via API v2 (ugcPosts + shares).
// Requiere: app de LinkedIn aprobada + OAuth 2.0 + permiso w_member_social.

import { getLogger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import { withRetry } from '../../utils/retry.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../types.js';

const API_BASE = 'https://api.linkedin.com/v2';

export class LinkedInAdapter {
    constructor() {
        this.name = PLATFORMS.LINKEDIN;
        this.enabled = false;
        this.accessToken = null;
        this.personUrn = null;
        this.logger = getLogger().child({ component: 'LinkedInAdapter' });
    }

    async initialize() {
        const env = getEnv();
        if (!env.LINKEDIN_ENABLED) {
            this.logger.info('LinkedIn deshabilitado');
            return false;
        }
        if (!env.LINKEDIN_ACCESS_TOKEN || !env.LINKEDIN_PERSON_URN) {
            this.logger.warn('credenciales de LinkedIn incompletas');
            return false;
        }
        this.accessToken = env.LINKEDIN_ACCESS_TOKEN;
        this.personUrn = env.LINKEDIN_PERSON_URN;
        this.enabled = true;

        this.logger.info({ personUrn: this.personUrn }, 'LinkedInAdapter listo');
        return true;
    }

    // ============================================================
    // LECTURA
    // ============================================================

    /**
     * Lee comentarios del feed del usuario.
     * LinkedIn no expone un endpoint "todos los comentarios recientes"
     * de forma simple; se itera sobre shares del propio usuario.
     */
    async readRecentComments({ maxShares = 5, maxCommentsPerShare = 10 } = {}) {
        if (!this.enabled) return [];

        const signals = [];

        try {
            // Shares del usuario
            const sharesUrl = `${API_BASE}/shares?q=owners&owners=${encodeURIComponent(this.personUrn)}` +
                `&count=${maxShares}&sortBy=LAST_MODIFIED`;

            const sharesRes = await withRetry(
                () => this._fetchJSON(sharesUrl, { method: 'GET' }),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            const shares = sharesRes?.elements || [];

            for (const share of shares) {
                const shareUrn = share.id;
                if (!shareUrn) continue;

                try {
                    const commentsUrl = `${API_BASE}/socialActions/${encodeURIComponent(shareUrn)}/comments` +
                        `?count=${maxCommentsPerShare}`;

                    const commentsRes = await withRetry(
                        () => this._fetchJSON(commentsUrl, { method: 'GET' }),
                        { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
                    );

                    for (const c of (commentsRes?.elements || [])) {
                        signals.push(makeSignal({
                            id: `li_comment_${c.id}`,
                            platform: PLATFORMS.LINKEDIN,
                            kind: SIGNAL_KINDS.COMMENT,
                            author: c.actor || null,
                            text: c.message?.text || c.message || '',
                            receivedAt: c.created?.time || Date.now(),
                            externalId: c.id,
                            threadParentId: shareUrn,
                            raw: { comment: c, shareUrn },
                        }));
                    }
                } catch (err) {
                    this.logger.warn(
                        { shareUrn, err: err.message },
                        'linkedin comments fetch failed'
                    );
                }
            }

            this.logger.debug({ count: signals.length }, 'linkedin comments fetched');
            return signals;
        } catch (err) {
            this.logger.warn({ err: err.message }, 'linkedin readRecentComments failed');
            return [];
        }
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    /**
     * Publica un post de texto en el feed del usuario.
     */
    async postText({ text, visibility = 'PUBLIC' } = {}) {
        if (!this.enabled) return { ok: false, error: 'linkedin_disabled' };
        if (!text || typeof text !== 'string') {
            return { ok: false, error: 'text_required' };
        }

        try {
            const payload = {
                author: this.personUrn,
                lifecycleState: 'PUBLISHED',
                specificContent: {
                    'com.linkedin.ugc.ShareContent': {
                        shareCommentary: { text },
                        shareMediaCategory: 'NONE',
                    },
                },
                visibility: {
                    'com.linkedin.ugc.MemberNetworkVisibility': visibility,
                },
            };

            const res = await withRetry(
                () => this._fetchJSON(`${API_BASE}/ugcPosts`, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                }),
                { maxRetries: 2, baseMs: 2000, maxMs: 10000 }
            );

            const postId = res?.id;
            this.logger.info({ postId }, 'linkedin post published');

            return {
                ok: true,
                externalId: postId,
                externalUrl: postId
                    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}`
                    : null,
                raw: res,
            };
        } catch (err) {
            this.logger.error({ err: err.message }, 'linkedin postText failed');
            return { ok: false, error: err.message };
        }
    }

    /**
     * Responde a un comentario.
     */
    async replyToComment({ shareUrn, text } = {}) {
        if (!this.enabled) return { ok: false, error: 'linkedin_disabled' };
        if (!shareUrn || !text) {
            return { ok: false, error: 'shareUrn_and_text_required' };
        }

        try {
            const payload = {
                actor: this.personUrn,
                message: { text },
            };

            const res = await withRetry(
                () => this._fetchJSON(
                    `${API_BASE}/socialActions/${encodeURIComponent(shareUrn)}/comments`,
                    { method: 'POST', body: JSON.stringify(payload) }
                ),
                { maxRetries: 2, baseMs: 1500, maxMs: 8000 }
            );

            return {
                ok: true,
                externalId: res?.id,
                raw: res,
            };
        } catch (err) {
            this.logger.warn({ err: err.message }, 'linkedin replyToComment failed');
            return { ok: false, error: err.message };
        }
    }

    // ============================================================
    // WEBHOOKS
    // ============================================================

    async processWebhook(_payload) {
        this.logger.warn('LinkedIn webhook no implementado (usar polling)');
        return [];
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`,
                    'X-Restli-Protocol-Version': '2.0.0',
                },
                body: opts.body,
                signal: controller.signal,
            });

            const text = await res.text();

            if (!res.ok) {
                const err = new Error(`LI HTTP ${res.status}: ${text.substring(0, 300)}`);
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
        this.logger.info('LinkedInAdapter shutdown');
    }
}

export default LinkedInAdapter;
