// src/http/routes/admin.js
// Endpoints de administración y diagnóstico. Todos bajo /api/admin.
// Requieren la misma API key que el resto de /api.

import { Router } from 'express';
import { getEnv } from '../../config/env.js';
import { TUNING } from '../../config/tuning.js';
import { database } from '../../core/Database.js';
import { systemCore } from '../../core/SystemCore.js';
import { eventBus } from '../../core/EventBus.js';
import { PersonaConfig } from '../../persona/PersonaConfig.js';
import { makeSignal, SIGNAL_KINDS, PLATFORMS } from '../../social/types.js';
import { asyncHandler, HttpError } from '../errorHandler.js';

// Campos sensibles a redactar del env
const SECRET_FIELDS = [
    'VB_AMBER_ADMIN_API_KEY',
    'VB_AMBER_SESSION_ENCRYPTION_KEY',
    'LLM_API_KEY',
    'TWITTER_API_KEY',
    'TWITTER_API_SECRET',
    'TWITTER_ACCESS_TOKEN',
    'TWITTER_ACCESS_SECRET',
    'TWITTER_BEARER_TOKEN',
    'INSTAGRAM_ACCESS_TOKEN',
    'INSTAGRAM_APP_SECRET',
    'INSTAGRAM_WEBHOOK_VERIFY_TOKEN',
    'LINKEDIN_ACCESS_TOKEN',
    'LINKEDIN_CLIENT_SECRET',
];

function redactEnv(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        if (SECRET_FIELDS.includes(k)) {
            out[k] = v ? `••• (${String(v).length} chars)` : '';
        } else {
            out[k] = v;
        }
    }
    return out;
}

export function createAdminRouter({
    personaRepo,
    loop,
    llm,
    memory,
    classifier,
    ingester,
    crisis,
    adapterManager,
    sessions,
}) {
    const router = Router();

    // ============================================================
    // CONFIG (snapshot del entorno + tuning, con secretos redactados)
    // ============================================================
    router.get('/config', asyncHandler(async (_req, res) => {
        const env = getEnv();
        res.json({
            env: redactEnv(env),
            tuning: { ...TUNING },
            readonly: [
                'VB_AMBER_ADMIN_API_KEY',
                'VB_AMBER_SESSION_ENCRYPTION_KEY',
                'LLM_API_KEY',
                'LLM_PROVIDER',
                'LLM_MODEL',
                'VB_AMBER_TRANSPORT',
                'DB_PATH',
                'NODE_ENV',
                'PORT',
                'HOST',
            ],
            mutable: {
                via_persona: ['operatingMode', 'safetyLevel'],
                via_env_redeploy: [
                    'VB_AMBER_LOOP_INTERVAL_MS',
                    'VB_AMBER_CRISIS_NEGATIVE_THRESHOLD',
                    'VB_AMBER_CRISIS_WINDOW_MIN',
                ],
            },
        });
    }));

    // ============================================================
    // HEALTH (módulos, circuit, eventBus, DB)
    // ============================================================
    router.get('/health', asyncHandler(async (_req, res) => {
        const systemState = systemCore.getState();
        const dbStats = database.isInitialized ? database.getStats() : null;

        res.json({
            ready: database.isInitialized && systemState.running,
            uptimeMs: systemState.startedAt ? Date.now() - systemState.startedAt : 0,
            node: {
                version: process.version,
                platform: process.platform,
                pid: process.pid,
                memory: process.memoryUsage(),
                uptimeSec: Math.round(process.uptime()),
            },
            system: {
                running: systemState.running,
                cycleCount: systemState.cycleCount,
                lastCycleMs: systemState.lastCycleMs,
                metrics: systemState.metrics,
                modules: systemState.modules,
            },
            llm: llm.getStats(),
            crisis: crisis.getState(),
            ingester: ingester.getState(),
            classifier: classifier.getState(),
            memory: memory.getState(),
            eventBus: eventBus.getState(),
            db: dbStats,
            dbCounts: {
                signalsByDecision: database.isInitialized
                    ? database.countSignalsByDecision()
                    : null,
            },
            sessions: sessions ? sessions.getState() : null,
            adapters: adapterManager ? {
                transport: adapterManager.transport,
                enabled: adapterManager.listEnabled(),
            } : null,
        });
    }));

    // ============================================================
    // SEÑALES (listado, filtros, detalle, reprocess)
    // ============================================================
    router.get('/signals', asyncHandler(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const platform = req.query.platform || null;
        const decision = req.query.decision || null;
        const kind = req.query.kind || null;

        const signals = database.listSignals({ limit, platform, decision, kind });
        const counts = database.countSignalsByDecision();

        res.json({ signals, count: signals.length, counts });
    }));

    router.get('/signals/:id', asyncHandler(async (req, res) => {
        const sig = database.getSignal(req.params.id);
        if (!sig) throw new HttpError(404, 'not_found', 'Señal no existe');
        res.json({ signal: sig });
    }));

    router.post('/signals/:id/reprocess', asyncHandler(async (req, res) => {
        const sig = database.getSignal(req.params.id);
        if (!sig) throw new HttpError(404, 'not_found', 'Señal no existe');

        database.resetSignalProcessing(req.params.id);
        const result = await loop.reprocessSignalById(req.params.id);

        if (!result.ok) {
            throw new HttpError(500, result.error, 'Reprocess falló', result);
        }

        const updated = database.getSignal(req.params.id);
        res.json({ ok: true, signal: updated });
    }));

    // ============================================================
    // CRISIS (historial + control)
    // ============================================================
    router.get('/crisis', asyncHandler(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const events = database.listCrisis({ limit });
        res.json({
            events,
            count: events.length,
            current: crisis.getState(),
        });
    }));

    router.post('/crisis/force', asyncHandler(async (req, res) => {
        const reason = req.body?.reason || 'manual';
        const platform = req.body?.platform || null;

        const result = crisis.forceCrisis('manual_admin', {
            reason,
            platform,
            signalIds: [],
        });

        res.json({ ok: true, ...result, state: crisis.getState() });
    }));

    router.post('/crisis/resume', asyncHandler(async (_req, res) => {
        crisis.forceResume();
        res.json({ ok: true, state: crisis.getState() });
    }));

    // ============================================================
    // MEMORY (contexto actual que el LLM verá)
    // ============================================================
    router.get('/memory', asyncHandler(async (req, res) => {
        const platform = req.query.platform || null;
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

        const recent = memory.recentActions({ platform, limit });
        const contextBlock = memory.buildContextBlock({ platform, limit });

        res.json({
            recentActions: recent,
            contextBlock,
            count: recent.length,
            state: memory.getState(),
        });
    }));

    // ============================================================
    // LLM (preview de prompts sin consumir tokens)
    // ============================================================
    router.post('/llm/preview', asyncHandler(async (req, res) => {
        const persona = personaRepo.getLatest();
        if (!persona) throw new HttpError(404, 'no_persona', 'Sin PersonaConfig');

        const body = req.body || {};
        const platform = body.platform || PLATFORMS.TWITTER;
        const kind = body.kind || SIGNAL_KINDS.PROACTIVE_POST;

        const signal = makeSignal({
            id: `preview_${Date.now()}`,
            platform,
            kind,
            author: body.author || null,
            text: body.text || null,
        });

        const memoryBlock = memory.buildContextBlock({ platform, limit: 8 });
        const recentActions = memory.recentActions({ platform, limit: 8 });

        const preview = llm.previewPrompts({
            persona,
            signal,
            task: body.task || null,
            context: {
                recentActions,
                memory: memoryBlock,
            },
        });

        res.json(preview);
    }));

    // ============================================================
    // LLM TEST (genera un draft real, sin publicar)
    // ============================================================
    router.post('/llm/test', asyncHandler(async (req, res) => {
        const persona = personaRepo.getLatest();
        if (!persona) throw new HttpError(404, 'no_persona', 'Sin PersonaConfig');

        const body = req.body || {};
        const platform = body.platform || PLATFORMS.TWITTER;
        const kind = body.kind || SIGNAL_KINDS.PROACTIVE_POST;

        const signal = makeSignal({
            id: `test_${Date.now()}`,
            platform,
            kind,
            author: body.author || null,
            text: body.text || null,
        });

        const memoryBlock = memory.buildContextBlock({ platform, limit: 8 });
        const recentActions = memory.recentActions({ platform, limit: 8 });

        const result = await llm.testGeneration({
            persona,
            signal,
            task: body.task || null,
            context: {
                recentActions,
                memory: memoryBlock,
            },
        });

        // Guard check sobre el draft generado (sin publicar)
        let guard = null;
        if (result.ok && result.text) {
            try {
                const { PersonaGuard } = await import('../../persona/PersonaGuard.js');
                const g = new PersonaGuard({ database, repository: personaRepo });
                guard = g.validate({
                    persona,
                    draft: result.text,
                    signal,
                    action: body.action || 'twitter_post',
                });
            } catch (err) {
                guard = {
                    ok: false,
                    decision: 'error',
                    errors: [{ code: 'guard_error', detail: err.message }],
                    warnings: [],
                };
            }
        }

        res.json({
            ...result,
            guard,
            personaVersion: persona.version,
            platform,
            kind,
        });
    }));

    // ============================================================
    // PERSONA (cambios rápidos sin reescribir todo)
    // ============================================================
    router.patch('/persona/mode', asyncHandler(async (req, res) => {
        const { operatingMode, safetyLevel } = req.body || {};

        if (!operatingMode && !safetyLevel) {
            throw new HttpError(400, 'missing_fields', 'operatingMode o safetyLevel requerido');
        }
        if (operatingMode && !['draft', 'auto'].includes(operatingMode)) {
            throw new HttpError(400, 'invalid_operating_mode', 'draft | auto');
        }
        if (safetyLevel && !['strict', 'normal', 'permissive'].includes(safetyLevel)) {
            throw new HttpError(400, 'invalid_safety_level', 'strict | normal | permissive');
        }

        const current = personaRepo.getLatest();
        if (!current) throw new HttpError(404, 'no_persona');

        const json = current.toJSON();
        if (operatingMode) json.operatingMode = operatingMode;
        if (safetyLevel) json.safetyLevel = safetyLevel;

        let persona;
        try {
            persona = new PersonaConfig(json);
        } catch (err) {
            throw new HttpError(400, 'invalid_persona', err.message, err.issues || null);
        }

        const saved = personaRepo.save(persona);
        res.json({ ok: true, persona: saved.toJSON() });
    }));

    router.patch('/persona/platforms/:platform', asyncHandler(async (req, res) => {
        const platform = req.params.platform;
        if (!['twitter', 'instagram', 'linkedin', 'threads'].includes(platform)) {
            throw new HttpError(400, 'invalid_platform', 'twitter | instagram | linkedin | threads');
        }

        const enabled = !!req.body?.enabled;
        const current = personaRepo.getLatest();
        if (!current) throw new HttpError(404, 'no_persona');

        const json = current.toJSON();
        if (!json.platforms) json.platforms = {};
        if (!json.platforms[platform]) json.platforms[platform] = {};
        json.platforms[platform].enabled = enabled;

        let persona;
        try {
            persona = new PersonaConfig(json);
        } catch (err) {
            throw new HttpError(400, 'invalid_persona', err.message, err.issues || null);
        }

        const saved = personaRepo.save(persona);
        res.json({ ok: true, persona: saved.toJSON() });
    }));

    // ============================================================
    // CLEANUP (mantenimiento)
    // ============================================================
    router.post('/cleanup', asyncHandler(async (req, res) => {
        const ops = req.body || {};
        const report = {};

        if (ops.expiredPendings !== false) {
            report.expiredPendings = database.cleanupExpiredPending();
        }

        if (Array.isArray(ops.deletePendingIds)) {
            report.deleted = 0;
            for (const id of ops.deletePendingIds) {
                if (database.deletePending(id)) report.deleted++;
            }
        }

        res.json({ ok: true, report });
    }));

    // ============================================================
    // EXPORT (JSON completo de la DB para backup)
    // ============================================================
    router.get('/export', asyncHandler(async (req, res) => {
        const include = (req.query.include || 'persona,actions,pending,signals,audit,crisis')
            .split(',')
            .map(s => s.trim());

        const dump = {
            exportedAt: new Date().toISOString(),
            version: '0.2.0',
        };

        if (include.includes('persona')) {
            dump.persona = database.getLatestPersona();
            dump.personaHistory = database._stmt(
                'SELECT version, updated_at, payload FROM persona_config ORDER BY id ASC'
            ).all().map(r => ({
                version: r.version,
                updated_at: r.updated_at,
                payload: JSON.parse(r.payload),
            }));
        }
        if (include.includes('actions')) {
            dump.actions = database.listRecentActions({ limit: 5000 });
        }
        if (include.includes('pending')) {
            dump.pending = database.listPending();
        }
        if (include.includes('signals')) {
            dump.signals = database.listSignals({ limit: 5000 });
        }
        if (include.includes('audit')) {
            dump.audit = database.listAudit({ limit: 5000 });
        }
        if (include.includes('crisis')) {
            dump.crisis = database.listCrisis({ limit: 500 });
        }

        res.set('Content-Disposition',
            `attachment; filename="vb-amber13-export-${Date.now()}.json"`);
        res.set('Content-Type', 'application/json');
        res.json(dump);
    }));

    // ============================================================
    // DB STATS (para el dashboard)
    // ============================================================
    router.get('/db/stats', asyncHandler(async (_req, res) => {
        const stats = database.getStats();
        const counts = database.countSignalsByDecision();

        const tables = {};
        for (const t of [
            'social_actions',
            'social_pending',
            'social_signals',
            'audit_log',
            'crisis_events',
            'persona_config',
        ]) {
            try {
                tables[t] = database._stmt(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
            } catch (_) {
                tables[t] = 0;
            }
        }

        res.json({ stats, tables, signalsByDecision: counts });
    }));

    return router;
}

export default createAdminRouter;
