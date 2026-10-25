// src/http/routes/health.js
// Health probes: /health, /health/livez, /health/readyz.

import { Router } from 'express';
import { database } from '../../core/Database.js';
import { systemCore } from '../../core/SystemCore.js';
import { eventBus } from '../../core/EventBus.js';

const START = Date.now();

export function createHealthRouter() {
    const router = Router();

    router.get('/', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'vb-amber13',
            uptimeMs: Date.now() - START,
            pid: process.pid,
            memory: process.memoryUsage(),
        });
    });

    router.get('/livez', (_req, res) => {
        res.json({ live: true });
    });

    router.get('/readyz', (_req, res) => {
        const state = systemCore.getState();
        const ready = database.isInitialized && state.running;
        res.status(ready ? 200 : 503).json({
            ready,
            db: database.isInitialized,
            running: state.running,
            cycleCount: state.cycleCount,
            modules: state.modules,
            eventBus: eventBus.getState(),
        });
    });

    return router;
}
