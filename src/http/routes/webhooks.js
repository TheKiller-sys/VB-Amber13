// src/http/routes/webhooks.js
// Webhooks de Meta (Instagram). Requiere raw body para verificar firma.

import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getLogger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';

function verifySignature(rawBody, header, secret) {
    if (!header || !secret) return false;
    const expected = 'sha256=' + createHmac('sha256', secret)
        .update(rawBody || '')
        .digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try { return timingSafeEqual(a, b); } catch (_) { return false; }
}

export function createWebhooksRouter({ adapterManager }) {
    const router = Router();
    const logger = getLogger().child({ component: 'webhooks' });

    // GET — verificación de Meta
    router.get('/instagram', (req, res) => {
        const env = getEnv();
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
            logger.info('instagram webhook verified');
            return res.status(200).type('text/plain').send(String(challenge ?? ''));
        }
        logger.warn({ mode }, 'instagram webhook verification failed');
        return res.status(403).type('text/plain').send('forbidden');
    });

    // POST — eventos
    router.post('/instagram', async (req, res) => {
        const env = getEnv();

        // Verificación de firma (si hay secret)
        if (env.INSTAGRAM_APP_SECRET) {
            const sig = req.get('x-hub-signature-256') || '';
            if (!verifySignature(req.rawBody, sig, env.INSTAGRAM_APP_SECRET)) {
                logger.warn({ ip: req.ip }, 'instagram webhook signature mismatch');
                return res.status(403).type('text/plain').send('invalid signature');
            }
        }

        // Responder rápido a Meta (evita reintentos)
        res.status(200).type('text/plain').send('EVENT_RECEIVED');

        // Procesar async
        setImmediate(async () => {
            try {
                const ig = adapterManager.get('instagram');
                if (!ig || !ig.enabled) return;
                const signals = await ig.processWebhook(req.body);
                if (signals.length > 0) {
                    logger.info(
                        {
                            count: signals.length,
                            kinds: signals.map((s) => s.kind),
                        },
                        'instagram webhook signals received (polling will persist)'
                    );
                }
            } catch (err) {
                logger.warn({ err: err.message }, 'webhook processing failed');
            }
        });
    });

    return router;
}
