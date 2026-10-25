// src/social/adapters/scraping/instagram.js
// Adapter de Instagram por scraping.
//
// IMPORTANTE: publicar imágenes por scraping es MUY frágil y de alto riesgo.
// El flujo requiere subir un archivo (no una URL), lo que obliga a descargar
// la imagen primero. Lo implementamos pero el loop debe usar draft mode.
//
// Lectura de comentarios: también frágil; requiere navegar post a post.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScrapingAdapterBase } from './Base.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../../types.js';
import { TUNING } from '../../../config/tuning.js';

const SEL = {
    newPostButton: [
        'svg[aria-label="New post"]',
        'svg[aria-label="Nueva publicación"]',
        'a[href="/create/select/"]',
        '[aria-label="New post"]',
    ],
    fileInput: [
        'input[type="file"]',
    ],
    nextButton: [
        'button:has-text("Next")',
        'button:has-text("Siguiente")',
    ],
    shareButton: [
        'button:has-text("Share")',
        'button:has-text("Compartir")',
    ],
    captionTextarea: [
        'textarea[aria-label*="caption" i]',
        'textarea[aria-label*="Escribe" i]',
        'textarea[aria-label*="Write" i]',
        'div[role="textbox"][contenteditable="true"]',
    ],
    comments: [
        'ul ul li',
    ],
};

function firstSelector(selectors) {
    return selectors.join(', ');
}

export class InstagramScrapingAdapter extends ScrapingAdapterBase {
    constructor({ sessions, database }) {
        super({ name: PLATFORMS.INSTAGRAM, sessions, database });
    }

    // ============================================================
    // LECTURA
    // ============================================================

    async readRecentComments({ maxPosts = 3, maxCommentsPerPost = 10 } = {}) {
        if (!this.enabled) return [];

        const r = await this._execute(async (page) => {
            await this.delay.goto(page, 'https://www.instagram.com/');
            await this.delay.scroll(page, 2, 600);

            // Linkear a los últimos posts: buscamos enlaces a /p/ o /reel/
            const postLinks = await page.locator('a[href*="/p/"], a[href*="/reel/"]').all();
            const uniqueLinks = new Set();
            for (const l of postLinks) {
                const href = await l.getAttribute('href').catch(() => null);
                if (href && !uniqueLinks.has(href)) uniqueLinks.add(href);
                if (uniqueLinks.size >= maxPosts) break;
            }

            const signals = [];
            for (const href of Array.from(uniqueLinks)) {
                try {
                    await this.delay.goto(page, `https://www.instagram.com${href}`);
                    await this.delay.scroll(page, 2, 400);

                    const comments = await page.locator(firstSelector(SEL.comments)).all();
                    let taken = 0;
                    for (const c of comments) {
                        if (taken >= maxCommentsPerPost) break;
                        try {
                            const text = await c.innerText({ timeout: 1500 }).catch(() => '');
                            if (!text || text.length < 3) continue;

                            const postId = href.match(/\/p\/([^/]+)/)?.[1]
                                || href.match(/\/reel\/([^/]+)/)?.[1]
                                || 'unknown';

                            signals.push(makeSignal({
                                id: `ig_comment_${postId}_${signals.length}`,
                                platform: PLATFORMS.INSTAGRAM,
                                kind: SIGNAL_KINDS.COMMENT,
                                author: null,
                                text,
                                receivedAt: Date.now(),
                                externalId: null,
                                threadParentId: postId,
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
        this.logger.debug({ count: r.signals.length }, 'instagram comments fetched');
        return r.signals;
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    async postImage({ imageUrl, caption } = {}) {
        if (!imageUrl) return { ok: false, error: 'imageUrl_required' };

        const limit = this._checkLocalRateLimit('post');
        if (!limit.ok) return limit;

        // Instagram web exige un archivo local. Descargamos primero.
        let localPath = null;
        try {
            localPath = await this._downloadImage(imageUrl);
        } catch (err) {
            return { ok: false, error: 'image_download_failed', detail: err.message };
        }

        return this._execute(async (page) => {
            try {
                await this.delay.goto(page, 'https://www.instagram.com/');
                await this.delay.wait(page, 1000);

                // Click "+"
                let clickedNew = false;
                for (const btn of SEL.newPostButton) {
                    const n = await page.locator(btn).count().catch(() => 0);
                    if (n > 0) {
                        try { await this.delay.click(page, btn); clickedNew = true; break; }
                        catch (_) {}
                    }
                }
                if (!clickedNew) {
                    return { ok: false, error: 'new_post_button_not_found' };
                }

                // Subir archivo
                const fileInput = page.locator(firstSelector(SEL.fileInput)).first();
                await fileInput.setInputFiles(localPath, {
                    timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS,
                });
                await this.delay.wait(page, 2500);

                // Next (crop)
                for (const btn of SEL.nextButton) {
                    const n = await page.locator(btn).count().catch(() => 0);
                    if (n > 0) { try { await this.delay.click(page, btn); break; } catch (_) {} }
                }
                await this.delay.wait(page, 1500);

                // Next (filter)
                for (const btn of SEL.nextButton) {
                    const n = await page.locator(btn).count().catch(() => 0);
                    if (n > 0) { try { await this.delay.click(page, btn); break; } catch (_) {} }
                }
                await this.delay.wait(page, 1500);

                // Caption
                if (caption) {
                    const capSel = firstSelector(SEL.captionTextarea);
                    const n = await page.locator(capSel).count().catch(() => 0);
                    if (n > 0) {
                        try { await this.delay.type(page, capSel, caption); } catch (_) {}
                    }
                }

                // Share
                let shared = false;
                for (const btn of SEL.shareButton) {
                    const n = await page.locator(btn).count().catch(() => 0);
                    if (n > 0) {
                        try { await this.delay.click(page, btn); shared = true; break; }
                        catch (_) {}
                    }
                }
                if (!shared) {
                    return { ok: false, error: 'share_button_not_found' };
                }

                await this.delay.wait(page, 3000);

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
            } finally {
                try { fs.unlinkSync(localPath); } catch (_) {}
            }
        });
    }

    async replyToComment({ commentId, message } = {}) {
        // Responder comentarios por scraping requiere identificar el post
        // y hacer click en "Responder" en el DOM. Demasiado frágil.
        return { ok: false, error: 'reply_scraping_not_supported' };
    }

    // ============================================================
    // HELPERS
    // ============================================================

    async _downloadImage(url) {
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmp = path.join(
            os.tmpdir(),
            `ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
        );
        fs.writeFileSync(tmp, buf);
        return tmp;
    }
}

export default InstagramScrapingAdapter;
