// src/social/adapters/scraping/linkedin.js
// Adapter de LinkedIn por scraping.
// Publicar texto es la operación más estable; comentarios son frágiles.

import { ScrapingAdapterBase } from './Base.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../../types.js';
import { TUNING } from '../../../config/tuning.js';

const SEL = {
    startPost: [
        'button.share-box-feed-entry__trigger',
        'button[aria-label*="Start a post" i]',
        'button[aria-label*="Crear publicación" i]',
        'div[role="button"]:has-text("Start a post")',
        'div[role="button"]:has-text("Empezar una publicación")',
    ],
    editor: [
        'div[role="textbox"][contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
        'div.ql-editor',
    ],
    postButton: [
        'button.share-actions__primary-action',
        'button[aria-label*="Post" i]:not([disabled])',
        'button:has-text("Post")',
        'button:has-text("Publicar")',
    ],
    feedPosts: [
        'div.feed-shared-update-v2',
        'div[data-urn*="urn:li:activity"]',
    ],
    commentText: [
        'span.comments-comment-item__main-content',
        'div.comments-comment-item-content-body',
        'article.comments-comment-entity span[dir="ltr"]',
    ],
};

function firstSelector(selectors) {
    return selectors.join(', ');
}

export class LinkedInScrapingAdapter extends ScrapingAdapterBase {
    constructor({ sessions, database }) {
        super({ name: PLATFORMS.LINKEDIN, sessions, database });
    }

    // ============================================================
    // LECTURA
    // ============================================================

    async readRecentComments({ maxShares = 3, maxCommentsPerShare = 10 } = {}) {
        if (!this.enabled) return [];

        const r = await this._execute(async (page) => {
            await this.delay.goto(page, 'https://www.linkedin.com/feed/');
            await this.delay.scroll(page, 2, 700);

            const posts = await page.locator(firstSelector(SEL.feedPosts)).all();
            const signals = [];

            for (const post of posts.slice(0, maxShares)) {
                try {
                    let urn = await post.getAttribute('data-urn').catch(() => null);
                    if (!urn) {
                        urn = await post.getAttribute('data-id').catch(() => null);
                    }
                    if (!urn) urn = `li_post_${signals.length}_${Date.now()}`;

                    // Expandir comentarios
                    try {
                        const expand = post.locator('button[aria-label*="comment" i], button[aria-label*="comentario" i]').first();
                        const n = await expand.count().catch(() => 0);
                        if (n > 0) {
                            await expand.click({ timeout: 2000 }).catch(() => {});
                            await this.delay.wait(page, 1200);
                        }
                    } catch (_) {}

                    const comments = await post.locator(firstSelector(SEL.commentText)).all();
                    let taken = 0;
                    for (const c of comments) {
                        if (taken >= maxCommentsPerShare) break;
                        try {
                            const text = await c.innerText({ timeout: 1500 }).catch(() => '');
                            if (!text || text.length < 3) continue;

                            signals.push(makeSignal({
                                id: `li_comment_${urn}_${signals.length}`,
                                platform: PLATFORMS.LINKEDIN,
                                kind: SIGNAL_KINDS.COMMENT,
                                author: null,
                                text,
                                receivedAt: Date.now(),
                                externalId: null,
                                threadParentId: urn,
                            }));
                            taken++;
                        } catch (_) {}
                    }
                } catch (_) {}
            }

            return { ok: true, signals };
        });

        if (!r.ok) {
            this.logger.warn({ err: r.error }, 'readRecentComments falló');
            return [];
        }
        this.logger.debug({ count: r.signals.length }, 'linkedin comments fetched');
        return r.signals;
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    async postText({ text } = {}) {
        if (!text || typeof text !== 'string') {
            return { ok: false, error: 'text_required' };
        }

        const limit = this._checkLocalRateLimit('post');
        if (!limit.ok) return limit;

        return this._execute(async (page) => {
            await this.delay.goto(page, 'https://www.linkedin.com/feed/');
            await this.delay.wait(page, 1500);

            // Abrir modal de post
            let opened = false;
            for (const btn of SEL.startPost) {
                const n = await page.locator(btn).count().catch(() => 0);
                if (n > 0) {
                    try { await this.delay.click(page, btn); opened = true; break; }
                    catch (_) {}
                }
            }
            if (!opened) {
                return { ok: false, error: 'start_post_button_not_found' };
            }

            await this.delay.wait(page, 1200);

            // Escribir
            const editorSel = firstSelector(SEL.editor);
            await page.locator(editorSel).first().waitFor({
                state: 'visible',
                timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS,
            });
            await this.delay.type(page, editorSel, text);
            await this.delay.wait(page, 1200);

            // Publicar
            let posted = false;
            for (const btn of SEL.postButton) {
                const n = await page.locator(btn).count().catch(() => 0);
                if (n > 0) {
                    try { await this.delay.click(page, btn); posted = true; break; }
                    catch (_) {}
                }
            }
            if (!posted) {
                return { ok: false, error: 'post_button_not_found' };
            }

            await this.delay.wait(page, 2500);

            const ch = await this.sessions.checkChallenge(page);
            if (ch.challenged) {
                this.sessions.markChallenge(this.name, ch);
                return { ok: false, error: 'challenge_detected', detail: ch };
            }

            return {
                ok: true,
                externalId: null,
                externalUrl: null,
                raw: { via: 'scraping' },
            };
        });
    }

    async replyToComment() {
        return { ok: false, error: 'reply_scraping_not_supported' };
    }
}

export default LinkedInScrapingAdapter;
