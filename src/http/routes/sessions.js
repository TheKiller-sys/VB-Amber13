// src/http/routes/sessions.js
// Endpoints para gestionar sesiones de scraping:
//   GET    /api/sessions                        → estado global
//   GET    /api/sessions/:platform              → estado de una
//   POST   /api/sessions/:platform/login        → inicia login (background)
//   GET    /api/sessions/:platform/login        → estado del login job
//   DELETE /api/sessions/:platform              → invalida sesión
//   POST   /api/sessions/:platform/healthcheck  → revalida
//   POST   /api/sessions/:platform/clear-challenge → quita cooldown
//
// Solo disponible si VB_AMBER_TRANSPORT=scraping.

import { Router } from 'express';
import { getEnv } from '../../config/env.js';
import { asyncHandler, HttpError } from '../errorHandler.js';

const SUPPORTED = ['twitter', 'instagram', 'linkedin'];

export function createSessionsRouter({ sessions }) {
    const router = Router();

    // Si no estamos en scraping, todas las rutas devuelven 503
    router.use((req, res, next) => {
        const env = getEnv();
        if (env.VB_AMBER_TRANSPORT !== 'scraping') {
            return res.status(503).json({
                error: 'scraping_disabled',
                message: 'VB_AMBER_TRANSPORT != scraping',
            });
        }
        if (!sessions) {
            return res.status(503).json({
                error: 'sessions_unavailable',
                message: 'BrowserSessionManager no inicializado',
            });
        }
        next();
    });

    function validatePlatform(req, res, next) {
        const p = req.params.platform;
        if (!SUPPORTED.includes(p)) {
            return res.status(400).json({
                error: 'unsupported_platform',
                supported: SUPPORTED,
            });
        }
        next();
    }

    // ---------- ESTADO ----------
    router.get('/', asyncHandler(async (_req, res) => {
        res.json({ state: sessions.getState() });
    }));

    router.get('/:platform', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        const hasSession = sessions.hasSession(platform);
        const challenge = sessions.getChallengeInfo(platform);
        const loginJob = sessions.getLoginStatus(platform);

        res.json({
            platform,
            hasSession,
            challenge,
            loginJob,
        });
    }));

    // ---------- LOGIN ----------
    router.post('/:platform/login', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;

        const result = sessions.startLogin(platform);
        if (!result.started) {
            return res.status(409).json({
                error: result.error || 'login_not_started',
                job: result.job,
            });
        }

        res.status(202).json({
            ok: true,
            status: 'in_progress',
            platform,
            message:
                'Login iniciado en background. La ventana del navegador se abrirá ' +
                'en la máquina del servidor. Completa el login ahí. ' +
                'Haz polling a GET /api/sessions/:platform/login para ver el estado.',
            job: result.job,
        });
    }));

    router.get('/:platform/login', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        const job = sessions.getLoginStatus(platform);
        if (!job) {
            return res.json({ platform, job: null });
        }
        res.json({ platform, job });
    }));

    // ---------- INVALIDAR ----------
    router.delete('/:platform', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        sessions.invalidate(platform);
        res.json({
            ok: true,
            platform,
            state: sessions.getState().platforms[platform],
        });
    }));

    // ---------- HEALTHCHECK ----------
    router.post('/:platform/healthcheck', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        const result = await sessions.healthCheck(platform);
        const status = result.ok ? 200 : 422;
        res.status(status).json({ platform, ...result });
    }));

    router.post('/healthcheck', asyncHandler(async (_req, res) => {
        const results = await sessions.healthCheckAll();
        const anyFail = Object.values(results).some(r => !r.ok);
        res.status(anyFail ? 207 : 200).json({ results });
    }));

    // ---------- CLEAR CHALLENGE ----------
    router.post('/:platform/clear-challenge', validatePlatform, asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        sessions.clearChallenge(platform);
        res.json({
            ok: true,
            platform,
            challenge: sessions.getChallengeInfo(platform),
        });
    }));

    return router;
}

export default createSessionsRouter;
