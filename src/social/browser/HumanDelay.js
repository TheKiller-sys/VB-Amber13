// src/social/browser/HumanDelay.js
// Delays aleatorios y helpers de interacción "humanos".
// Objetivo: reducir la detectabilidad del bot. No garantiza invisibilidad.

import { getLogger } from '../../utils/logger.js';
import { TUNING } from '../../config/tuning.js';

export class HumanDelay {
    constructor({ minMs, maxMs } = {}) {
        this.minMs = minMs ?? TUNING.SCRAPING_HUMAN_DELAY_MIN_MS;
        this.maxMs = maxMs ?? TUNING.SCRAPING_HUMAN_DELAY_MAX_MS;
        this.logger = getLogger().child({ component: 'HumanDelay' });
    }

    _rand(extra = 0) {
        const lo = this.minMs;
        const hi = Math.max(this.maxMs, lo + 1);
        return Math.floor(lo + Math.random() * (hi - lo)) + extra;
    }

    /**
     * Espera un tiempo aleatorio entre min y max (+ extra fijo).
     * @returns {Promise<number>} ms esperados
     */
    async wait(page, extraMs = 0) {
        const ms = this._rand(extraMs);
        try {
            await page.waitForTimeout(ms);
        } catch (_) {}
        return ms;
    }

    /**
     * Navega a una URL con delay previo y posterior.
     */
    async goto(page, url) {
        await this.wait(page);
        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: TUNING.SCRAPING_NAV_TIMEOUT_MS,
        });
        await this.wait(page);
    }

    /**
     * Hace click en un selector con delay previo y posterior.
     */
    async click(page, selector) {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS });
        await this.wait(page);
        await locator.click();
        await this.wait(page);
    }

    /**
     * Escribe texto en un selector con delay por carácter.
     * Usa pressSequentially (Playwright moderno) con delay fijo aleatorio por llamada.
     */
    async type(page, selector, text) {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: 'visible', timeout: TUNING.SCRAPING_PAGE_TIMEOUT_MS });
        await this.wait(page);
        await locator.click();
        await this.wait(page, 300);

        // Delay por carácter: 50–130 ms (aleatorio por llamada, no por carácter,
        // para no incurrir en coste de muchas llamadas a waitForTimeout).
        const perCharDelay = 50 + Math.floor(Math.random() * 80);
        await locator.pressSequentially(text, { delay: perCharDelay });

        await this.wait(page);
    }

    /**
     * Scroll progresivo (simula lectura humana).
     */
    async scroll(page, times = TUNING.SCRAPING_SCROLL_ITERATIONS, px = TUNING.SCRAPING_SCROLL_PX) {
        for (let i = 0; i < times; i++) {
            try {
                await page.evaluate((y) => window.scrollBy(0, y), px);
            } catch (_) {}
            await this.wait(page, 500);
        }
    }
}

export default HumanDelay;
