// src/social/adapters/scraping/twitter.js
// Adapter de Twitter/X por scraping. Playwright + sesión guardada.
//
// Selectores verificados contra x.com (2024-2025). Son FRÁGILES y
// cambian con frecuencia. Cada interacción usa listas de fallback.

import { ScrapingAdapterBase } from './Base.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../../types.js';
import { TUNING } from '../../../config/tuning.js';

// ============================================================
// SELECTORES
// ============================================================

const SEL = {
    composerTextarea: [
        '[data-testid="tweetTextarea_0"]',
        '[data-testid="tweetTextarea_0RichTextInput"]',
        'div[role="textbox"][aria-label*="Post" i]',
        'div[role="textbox"][aria-label*="Publicar" i]',
        'div[role="textbox"]',
    ],
    postButton: [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        'button[data-testid="tweetButtonInline"]',
    ],
    composeButton: [
        '[data-testid="SideNav_NewTweet_Button"]',
        '[data-testid="FloatingActionButtons_Tweet_Button"]',
        'a[href="/compose/post"]',
    ],
    tweets: [
        'article[data-testid="tweet"]',
        'article',
    ],
    tweetText: [
        '[data-testid="tweetText"]',
    ],
    userName: [
        '[data-testid="User-Name"]',
    ],
    replyBox: [
        '[data-testid="tweetTextarea_0"]',
    ],
};

function firstSelector(selectors) {
    return selectors.join(', ');
}

// ============================================================
// ADAPTER
// ============================================================

export class TwitterScrapingAdapter extends ScrapingAdapterBase {
    constructor({ sessions, database }) {
        super({ name: PLATFORMS.TWITTER, sessions, database });
    }

    // ============================================================
    // LECTURA
    // ============================================================

    async readMentions({ maxResults = TUNING.SCRAPING_READ_MAX_ITEMS } = {}) {
        if (!this.enabled) return [];

        const r = await this._execute(async (page) => {
            await this.delay.goto(page, 'https://x.com/notifications/mentions');
            await this.delay.scroll(page, 1, 400);

            const selector = firstSelector(SEL.tweets);
            const articles = await page.locator(selector).all();
            const signals = [];

            for (const article of articles.slice(0, maxResults)) {
                try {
                    const textEl = article.locator(firstSelector(SEL.tweetText)).first();
                    const text = await textEl.innerText({ timeout: 2000 }).catch(() => '');

                    const nameEl = article.locator(firstSelector(SEL.userName)).first();
                    const authorRaw = await nameEl.innerText({ timeout: 2000 }).catch(() => '');

                    // authorRaw típicamente "Display Name\n@handle\n·\n2h"
                    const handleMatch = authorRaw.match(/@([A-Za-z0-9_]+)/);
                    const author = handleMatch ? handleMatch[1] : null;

                    // id desde href del status
                    let externalId = null;
                    try {
                        const linkEl = article.locator('a[href*="/status/"]').first();
                        const href = await linkEl.getAttribute('href', { timeout: 1500 });
                        const m = href && href.match(/\/status\/(\d+)/);
                        if (m) externalId = m[1];
                    } catch (_) {}

                    if (!externalId) {
                        externalId = `tw_m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    }
                    if (!text) continue;

                    signals.push(makeSignal({
                        id: `tw_mention_${externalId}`,
                        platform: PLATFORMS.TWITTER,
                        kind: SIGNAL_KINDS.MENTION,
                        author,
                        text,
                        receivedAt: Date.now(),
                        externalId,
                    }));
                } catch (_) {}
            }

            return { ok: true, signals };
        });

        if (!r.ok) {
            this.logger.warn({ err: r.error }, 'readMentions falló');
            return [];
        }
        this.logger.debug({ count: r.signals.length }, 'twitter mentions fetched');
        return r.signals;
    }

    async readDMs({ maxResults = TUNING.SCRAPING_READ_MAX_ITEMS } = {}) {
        // Scraping de DMs es MUY frágil y de alto riesgo (X detecta rápido).
        // Lo dejamos como no-implementado por seguridad. El loop lo ignora.
        return [];
    }

    // ============================================================
    // ESCRITURA
    // ============================================================

    async postTweet({ text, replyTo = null } = {}) {
        if (!text || typeof text !== 'string') {
            return { ok: false, error: 'text_required' };
        }

        const kind = replyTo ? 'reply' : 'post';
        const limit = this._checkLocalRateLimit(kind);
        if (!limit.ok) {
            this.logger.warn(limit, 'rate limit local');
            return limit;
        }

        return this._execute(async (page) => {
            if (replyTo) {
                await this.delay.goto(page, `https://x.com/i/status/${replyTo}`);
                await this.delay.wait(page, 800);
                const replyBtn = page.locator('[data-testid="reply"]').first();
                await replyBtn.waitFor({ state: 'visible', timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS });
                await this.delay.click(page, '[data-testid="reply"]');
            } else {
                await this.delay.goto(page, 'https://x.com/compose/post');
            }

            const textareaSel = firstSelector(SEL.composerTextarea);
            await page.locator(textareaSel).first().waitFor({
                state: 'visible',
                timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS,
            });
            await this.delay.type(page, textareaSel, text);

            // Botón post (múltiples fallbacks)
            let clicked = false;
            for (const btn of SEL.postButton) {
                const n = await page.locator(btn).count().catch(() => 0);
                if (n > 0) {
                    try {
                        await this.delay.click(page, btn);
                        clicked = true;
                        break;
                    } catch (_) {}
                }
            }
            if (!clicked) {
                return { ok: false, error: 'post_button_not_found' };
            }

            await this.delay.wait(page, 2000);

            // Verificar challenge post-publicación
            const ch = await this.sessions.checkChallenge(page);
            if (ch.challenged) {
                this.sessions.markChallenge(this.name, ch);
                return { ok: false, error: 'challenge_detected', detail: ch };
            }

            return {
                ok: true,
                externalId: null,           // X no expone ID post-publicación
                externalUrl: null,
                raw: { via: 'scraping', replyTo },
            };
        });
    }

    async replyToTweet({ text, replyTo } = {}) {
        if (!replyTo) return { ok: false, error: 'replyTo_required' };
        return this.postTweet({ text, replyTo });
    }

    async sendDM() {
        // No implementado por seguridad (X detecta DMs automatizados muy rápido).
        return { ok: false, error: 'dm_scraping_not_supported' };
    }

    async deleteTweet() {
        return { ok: false, error: 'delete_not_supported' };
    }
}

export default TwitterScrapingAdapter;
