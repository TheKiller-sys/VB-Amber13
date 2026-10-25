// src/http/routes/social.js
// Endpoints de operación social: pending, actions, audit, tick, pause.

import { Router } from 'express';
import { database } from '../../core/Database.js';
import { asyncHandler, HttpError } from '../errorHandler.js';

export function createSocialRouter({ loop }) {
    const router = Router();

    // ---------- STATE ----------
    router.get('/state', asyncHandler(async (_req, res) => {
        res.json({ state: loop.getState() });
    }));

    // ---------- PENDING ----------
    router.get('/pending', asyncHandler(async (_req, res) => {
        const items = database.listPending();
        res.json({ pending: items, count: items.length });
    }));

    router.get('/pending/:id', asyncHandler(async (req, res) => {
        const item = database.getPending(req.params.id);
        if (!item) throw new HttpError(404, 'not_found', 'Pending no existe');
        res.json({ pending: item });
    }));

    router.post('/pending/:id/approve', asyncHandler(async (req, res) => {
        const approvedBy = req.body?.approvedBy || 'api';
        const result = await loop.approvePending(req.params.id, { approvedBy });
        if (!result.ok) {
            const map = {
                not_found: [404, 'not_found'],
                expired: [410, 'expired'],
                no_persona: [503, 'no_persona'],
                guard_rejected_on_approve: [422, 'guard_rejected'],
            };
            let status = 400;
            let code = result.error || 'approve_failed';
            if (map[result.error]) [status, code] = map[result.error];
            else if (String(result.error).startsWith('status_')) { status = 409; }
            throw new HttpError(status, code, result.error, result.errors || null);
        }
        res.json(result);
    }));

    router.post('/pending/:id/reject', asyncHandler(async (req, res) => {
        const rejectedBy = req.body?.rejectedBy || 'api';
        const reason = req.body?.reason ?? null;
        const result = loop.rejectPending(req.params.id, { rejectedBy, reason });
        if (!result.ok) {
            const status = result.error === 'not_found' ? 404 : 409;
            throw new HttpError(status, result.error, result.error);
        }
        res.json(result);
    }));

    // ---------- ACTIONS ----------
    router.get('/actions', asyncHandler(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
        const platform = req.query.platform || null;
        const actions = database.listRecentActions({ platform, limit });
        res.json({ actions, count: actions.length });
    }));

    // ---------- AUDIT ----------
    router.get('/audit', asyncHandler(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
        const category = req.query.category || null;
        const items = database.listAudit({ category, limit });
        res.json({ audit: items, count: items.length });
    }));

    // ---------- MANUAL CONTROL ----------
    router.post('/tick', asyncHandler(async (_req, res) => {
        await loop.tick();
        res.json({ ok: true, state: loop.getState() });
    }));

    router.post('/pause', asyncHandler(async (_req, res) => {
        loop.pause();
        res.json({ ok: true, paused: true });
    }));

    router.post('/resume', asyncHandler(async (_req, res) => {
        loop.resume();
        res.json({ ok: true, paused: false });
    }));

    router.post('/crisis/resume', asyncHandler(async (_req, res) => {
        loop.crisis.forceResume();
        res.json({ ok: true, crisis: loop.crisis.getState() });
    }));

    return router;
}
