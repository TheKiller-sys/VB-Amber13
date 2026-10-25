// src/social/browser/ChallengeDetector.js
// Detecta CAPTCHA / challenge / sesión inválida en una página Playwright.
//
// Estrategias:
//   1) URL patterns (redirects a login, /challenge, /checkpoint, /suspended)
//   2) Selectores de CAPTCHA (Turnstile, reCAPTCHA, hCaptcha)
//   3) Patrones de texto en el body
//
// Si detecta challenge, el caller (adapter) DEBE parar y devolver error.
// Reintentar acelera el ban.

import { getLogger } from '../../utils/logger.js';

const URL_PATTERNS = [
    /\/challenge/i,
    /\/checkpoint/i,
    /\/i\/flow\/login/i,       // Twitter login (redirect = sesión inválida)
    /\/accounts\/login/i,      // Instagram login
    /\/login/i,                // genérico
    /\/suspended/i,
    /\/locked/i,
];

const TEXT_PATTERNS = [
    /verify you are human/i,
    /verify your identity/i,
    /unusual activity/i,
    /suspicious activity/i,
    /confirm your identity/i,
    /we('ve| have) detected unusual/i,
    /account (has been )?(suspended|locked|restricted)/i,
    /please (complete|solve) the (security )?check/i,
    /captcha/i,
    /challenge/i,
];

const SELECTOR_PATTERNS = [
    'iframe[src*="turnstile"]',
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '.g-recaptcha',
    '[data-testid="turnstile"]',
    '#challenge-running',
    '#challenge-form',
    '#captcha',
];

export class ChallengeDetector {
    constructor() {
        this.logger = getLogger().child({ component: 'ChallengeDetector' });
    }

    /**
     * Inspecciona la página actual.
     * @param {import('playwright').Page} page
     * @returns {Promise<{ challenged: boolean, reason?: string, detail?: string, url?: string }>}
     */
    async detect(page) {
        let url = '';
        try { url = page.url(); } catch (_) {}

        // 1) URL
        for (const pat of URL_PATTERNS) {
            if (pat.test(url)) {
                return {
                    challenged: true,
                    reason: 'url_pattern',
                    detail: pat.source,
                    url,
                };
            }
        }

        // 2) Selectores
        for (const sel of SELECTOR_PATTERNS) {
            try {
                const found = await page.$(sel);
                if (found) {
                    return {
                        challenged: true,
                        reason: 'selector',
                        detail: sel,
                        url,
                    };
                }
            } catch (_) {
                // Algunos selectores pueden no ser válidos en la página; ignorar.
            }
        }

        // 3) Texto del body
        try {
            const bodyText = await page.evaluate(
                () => (document.body && document.body.innerText) || ''
            );
            for (const pat of TEXT_PATTERNS) {
                if (pat.test(bodyText)) {
                    return {
                        challenged: true,
                        reason: 'text_pattern',
                        detail: pat.source,
                        url,
                    };
                }
            }
        } catch (_) {
            // Si no podemos leer el body, no marcamos como challenge.
        }

        return { challenged: false };
    }
}

export default ChallengeDetector;
