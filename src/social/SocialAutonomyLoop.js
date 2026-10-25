// src/social/SocialAutonomyLoop.js
// El corazón del sistema. Orquesta:
//   ingest → clasificar → decidir → generar → guardar → validar → publicar/pending

import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';
import { getEnv } from '../config/env.js';
import {
    SIGNAL_KINDS,
    CLASSIFICATIONS,
    DECISIONS,
    actionForSignal,
    makeSignal,
} from './types.js';

export class SocialAutonomyLoop {
    /**
     * @param {Object} deps
     *   - database       — DatabaseManager
     *   - personaRepo    — PersonaRepository
     *   - llm            — LLMBridge
     *   - guard          — PersonaGuard
     *   - ingester       — SignalIngester
     *   - classifier     — SignalClassifier
     *   - memory         — SocialMemory
     *   - crisis         — CrisisDetector
     *   - adapterManager — AdapterManager
     */
    constructor(deps) {
        this.database = deps.database;
        this.personaRepo = deps.personaRepo;
        this.llm = deps.llm;
        this.guard = deps.guard;
        this.ingester = deps.ingester;
        this.classifier = deps.classifier;
        this.memory = deps.memory;
        this.crisis = deps.crisis;
        this.adapterManager = deps.adapterManager;

        this.logger = getLogger().child({ component: 'SocialAutonomyLoop' });

        this._running = false;
        this._paused = false;

        this.metrics = {
            ticks: 0,
            signalsProcessed: 0,
            ignored: 0,
            escalated: 0,
            draftsGenerated: 0,
            draftsRejectedByGuard: 0,
            draftsRejectedByVC: 0,
            draftsPending: 0,
            draftsPublished: 0,
            errors: 0,
        };
    }

    async initialize() {
        this.logger.info(
            { mode: getEnv().VB_AMBER_OPERATING_MODE },
            'SocialAutonomyLoop listo'
        );
    }

    // ============================================================
    // TICK PRINCIPAL
    // ============================================================

    /**
     * Un ciclo completo. Llamado por SystemCore cada N ms.
     */
    async tick() {
        if (this._paused) {
            this.logger.debug('loop paused, skipping tick');
            return;
        }

        this.metrics.ticks++;
        const t0 = Date.now();

        try {
            // 1. Check crisis resuelta
            this.crisis.checkResume();
            if (this.crisis.isPaused()) {
                this.logger.debug('crisis pause active, skipping cycle');
                return;
            }

            // 2. Persona vigente
            const persona = this.personaRepo.getLatest();
            if (!persona) {
                this.logger.warn('sin PersonaConfig; nada que hacer');
                return;
            }

            // 3. Ingestar señales
            const signals = await this.ingester.ingest();
            if (signals.length === 0) {
                this.logger.debug('no fresh signals');
                return;
            }

            // 4. Procesar cada señal (secuencial para no saturar la API)
            for (const signal of signals.slice(0, TUNING.SIGNAL_MAX_PER_CYCLE)) {
                try {
                    await this._processSignal(signal, persona);
                } catch (err) {
                    this.metrics.errors++;
                    this.logger.error(
                        { signalId: signal.id, err: err.message },
                        'process signal failed'
                    );
                    try {
                        this.database.markSignalProcessed(signal.id, 'error');
                    } catch (_) {}
                }
            }

            this.logger.debug(
                { ms: Date.now() - t0, signals: signals.length },
                'tick complete'
            );
        } catch (err) {
            this.metrics.errors++;
            this.logger.error({ err: err.message }, 'tick failed');
        }
    }

    // ============================================================
    // PROCESAR UNA SEÑAL
    // ============================================================

    async _processSignal(signal, persona) {
        this.metrics.signalsProcessed++;

        // 1. Clasificar
        const classification = this.classifier.classify(signal);

        // 2. Crisis check (registra y puede pausar)
        const crisisResult = this.crisis.evaluate(signal, classification);
        if (crisisResult.crisis) {
            this.logger.warn(
                { signalId: signal.id, reason: crisisResult.reason },
                '🚨 crisis triggered'
            );
            return;
        }

        // 3. ¿Ignorar?
        if (this._shouldIgnore(signal, classification, persona)) {
            this.metrics.ignored++;
            this.database.markSignalProcessed(signal.id, DECISIONS.IGNORE);
            return;
        }

        // 4. ¿Escalar (sin generar draft)?
        if (this._shouldEscalateWithoutDraft(signal, classification, persona)) {
            this.metrics.escalated++;
            this._createPendingAction({
                signal,
                persona,
                action: 'escalate',
                draft: null,
                classification: classification.classification,
                reason: 'escalate_rule',
            });
            this.database.markSignalProcessed(signal.id, DECISIONS.ESCALATE);
            return;
        }

        // 5. Elegir acción
        const action = actionForSignal(signal.platform, signal.kind);
        if (!action) {
            this.logger.debug(
                { platform: signal.platform, kind: signal.kind },
                'no action mapped; ignoring'
            );
            this.metrics.ignored++;
            this.database.markSignalProcessed(signal.id, DECISIONS.IGNORE);
            return;
        }

        // 6. Generar draft con LLM
        const draft = await this._generateDraft(signal, persona, classification);
        if (!draft || !draft.text) {
            this.logger.debug({ signalId: signal.id }, 'no draft generated');
            this.database.markSignalProcessed(signal.id, DECISIONS.SKIP);
            return;
        }

        if (draft.skipped) {
            this.logger.debug({ signalId: signal.id }, 'LLM skipped');
            this.database.markSignalProcessed(signal.id, DECISIONS.SKIP);
            return;
        }

        this.metrics.draftsGenerated++;

        // 7. PersonaGuard
        const guardResult = this.guard.validate({
            persona,
            draft: draft.text,
            signal,
            action,
        });

        if (!guardResult.ok) {
            this.metrics.draftsRejectedByGuard++;
            this.logger.warn(
                {
                    signalId: signal.id,
                    errors: guardResult.errors.map(e => e.code),
                },
                'PersonaGuard rechazó draft'
            );

            // Si fue escalate, crear pending de escalate
            if (guardResult.decision === 'escalate') {
                this.metrics.escalated++;
                this._createPendingAction({
                    signal,
                    persona,
                    action,
                    draft: draft.text,
                    classification: classification.classification,
                    reason: 'guard_escalate',
                    errors: guardResult.errors,
                });
                this.database.markSignalProcessed(signal.id, DECISIONS.ESCALATE);
            } else {
                this.database.markSignalProcessed(signal.id, DECISIONS.REJECT);
            }
            return;
        }

        // 8. ¿Requiere aprobación humana?
        const needsApproval = persona.requiresApproval({
            platform: signal.platform,
            classification: classification.classification,
        });

        if (needsApproval) {
            this.metrics.draftsPending++;
            this._createPendingAction({
                signal,
                persona,
                action,
                draft: draft.text,
                classification: classification.classification,
                reason: 'requires_approval',
            });
            this.database.markSignalProcessed(signal.id, DECISIONS.PENDING);
            return;
        }

        // 9. Publicar automáticamente
        try {
            await this._publish({
                signal,
                persona,
                action,
                draft: draft.text,
                classification: classification.classification,
            });
            this.database.markSignalProcessed(signal.id, DECISIONS.PUBLISH);
        } catch (err) {
            this.metrics.errors++;
            this.logger.error(
                { signalId: signal.id, err: err.message },
                'publish failed'
            );
            this.database.markSignalProcessed(signal.id, 'error');
        }
    }

    // ============================================================
    // DECISIÓN
    // ============================================================

    _shouldIgnore(signal, classification, persona) {
        // Plataforma deshabilitada
        if (!persona.isPlatformEnabled(signal.platform)) return true;

        // SPAM en DM
        if (classification.classification === CLASSIFICATIONS.DM_SPAM) return true;

        // Autor bloqueado
        if (signal.author && persona.boundaries.neverReplyTo.length > 0) {
            const a = String(signal.author).toLowerCase();
            for (const blocked of persona.boundaries.neverReplyTo) {
                if (a === blocked.toLowerCase()) return true;
            }
        }

        return false;
    }

    _shouldEscalateWithoutDraft(signal, classification, persona) {
        // Crisis ya manejada por CrisisDetector, pero reglas custom pueden forzar
        for (const rule of persona.rules) {
            if (rule.then !== 'escalate_to_human') continue;
            if (this._ruleMatches(rule, signal)) return true;
        }
        return false;
    }

    // ============================================================
    // GENERACIÓN
    // ============================================================

    async _generateDraft(signal, persona, classification) {
        const memoryBlock = this.memory.buildContextBlock({
            platform: signal.platform,
            limit: 8,
        });

        const result = await this.llm.generateForSocial({
            persona,
            signal,
            context: {
                recentActions: this.memory.recentActions({
                    platform: signal.platform,
                    limit: 8,
                }),
                memory: memoryBlock,
            },
        });

        if (!result) return null;

        return {
            text: result.text,
            skipped: result.skipped,
            usage: result.usage,
            latencyMs: result.latencyMs,
        };
    }

    // ============================================================
    // PENDING
    // ============================================================

    _createPendingAction({ signal, persona, action, draft, classification, reason, errors = [] }) {
        const id = `pending_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
        const now = Date.now();

        const pending = {
            id,
            platform: signal.platform,
            action,
            draft: draft || '',
            reason,
            classification,
            signal_payload: {
                id: signal.id,
                kind: signal.kind,
                author: signal.author,
                text: signal.text,
                externalId: signal.externalId,
                threadParentId: signal.threadParentId,
            },
            persona_version: persona.version,
            status: 'pending',
            created_at: now,
            expires_at: now + TUNING.PENDING_ACTION_TTL_MS,
            errors,
        };

        try {
            this.database.savePending(pending);
            this.database.audit({
                category: 'social',
                event: 'pending_created',
                severity: 'info',
                details: {
                    id,
                    platform: signal.platform,
                    action,
                    reason,
                },
            });

            this.logger.info(
                {
                    id,
                    platform: signal.platform,
                    action,
                    reason,
                    draftPreview: (draft || '').substring(0, 80),
                },
                '📝 pending action created'
            );
        } catch (err) {
            this.logger.error({ err: err.message }, 'failed to save pending');
        }

        return pending;
    }

    /**
     * Aprueba y publica una pending action.
     */
    async approvePending(pendingId, { approvedBy = 'user' } = {}) {
        const pending = this.database.getPending(pendingId);
        if (!pending) return { ok: false, error: 'not_found' };
        if (pending.status !== 'pending') return { ok: false, error: `status_${pending.status}` };
        if (pending.expires_at < Date.now()) {
            this.database.resolvePending(pendingId, 'expired', 'system');
            return { ok: false, error: 'expired' };
        }

        // Si es escalate puro → solo marcar aprobado
        if (pending.action === 'escalate') {
            this.database.resolvePending(pendingId, 'approved_escalate', approvedBy);
            return { ok: true, action: 'escalate', pending };
        }

        // Guard final (revalidación con persona actual)
        const persona = this.personaRepo.getLatest();
        if (!persona) return { ok: false, error: 'no_persona' };

        const signal = makeSignal({
            id: pending.signal_payload.id,
            platform: pending.platform,
            kind: pending.signal_payload.kind,
            author: pending.signal_payload.author,
            text: pending.signal_payload.text,
            externalId: pending.signal_payload.externalId,
            threadParentId: pending.signal_payload.threadParentId,
        });

        const guardResult = this.guard.validate({
            persona,
            draft: pending.draft,
            signal,
            action: pending.action,
        });

        if (!guardResult.ok) {
            return {
                ok: false,
                error: 'guard_rejected_on_approve',
                errors: guardResult.errors,
            };
        }

        // Publicar
        try {
            const result = await this._publish({
                signal,
                persona,
                action: pending.action,
                draft: pending.draft,
                classification: pending.classification,
                approvedBy,
            });

            this.database.resolvePending(pendingId, 'approved', approvedBy);

            return { ok: true, ...result, pending };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    /**
     * Rechaza una pending action.
     */
    rejectPending(pendingId, { rejectedBy = 'user', reason = null } = {}) {
        const pending = this.database.getPending(pendingId);
        if (!pending) return { ok: false, error: 'not_found' };
        if (pending.status !== 'pending') return { ok: false, error: `status_${pending.status}` };

        this.database.resolvePending(pendingId, 'rejected', rejectedBy, reason);

        this.database.audit({
            category: 'social',
            event: 'pending_rejected',
            severity: 'info',
            details: { id: pendingId, reason },
        });

        this.logger.info(
            { id: pendingId, reason },
            '❌ pending action rejected'
        );

        return { ok: true, pending };
    }

    // ============================================================
    // PUBLICAR
    // ============================================================

    async _publish({ signal, persona, action, draft, classification, approvedBy = 'auto' }) {
        const params = this._buildActionParams({
            signal,
            action,
            draft,
        });

        const result = await this.adapterManager.execute(action, params);

        if (!result.ok) {
            this.metrics.errors++;
            this.logger.error(
                {
                    action,
                    platform: signal.platform,
                    error: result.error,
                },
                'publish failed'
            );
            throw new Error(result.error || 'publish_failed');
        }

        // Persistir acción
        const actionRecord = {
            id: `action_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
            platform: signal.platform,
            action,
            text: draft,
            signal_id: signal.id,
            signal_kind: signal.kind,
            signal_author: signal.author,
            approved_by: approvedBy,
            published_at: Date.now(),
            external_id: result.externalId || null,
            external_url: result.externalUrl || null,
            raw_response: result.raw || null,
            metrics: {
                classification,
                signalKind: signal.kind,
            },
        };

        this.database.saveAction(actionRecord);
        this.database.audit({
            category: 'social',
            event: 'published',
            severity: 'info',
            details: {
                id: actionRecord.id,
                platform: signal.platform,
                action,
                approvedBy,
            },
        });

        this.metrics.draftsPublished++;

        this.logger.info(
            {
                id: actionRecord.id,
                platform: signal.platform,
                action,
                externalUrl: result.externalUrl,
                approvedBy,
            },
            '✅ publicado'
        );

        return { actionId: actionRecord.id, ...result };
    }

    _buildActionParams({ signal, action, draft }) {
        switch (action) {
            case 'twitter_post':
                return { text: draft };
            case 'twitter_reply':
                return { text: draft, replyTo: signal.externalId };
            case 'twitter_dm_reply':
                return { text: draft, recipientId: signal.author };
            case 'instagram_post':
                // Requiere imagen. Si el signal no tiene una, falla limpiamente.
                return {
                    text: draft,
                    imageUrl: signal.raw?.imageUrl || null,
                };
            case 'instagram_comment_reply':
                return { text: draft, commentId: signal.externalId };
            case 'linkedin_post':
                return { text: draft };
            case 'linkedin_comment_reply':
                return { text: draft, shareUrn: signal.threadParentId };
            default:
                return { text: draft };
        }
    }

    // ============================================================
    // HELPERS
    // ============================================================

    _ruleMatches(rule, signal) {
        const cond = String(rule.if || '').toLowerCase();
        const text = (signal.text || '').toLowerCase();

        if (cond === 'cualquier dm' && signal.kind === SIGNAL_KINDS.DM) return true;

        const contieneMatch = cond.match(/^(\w+)\s+contiene\s+["'«](.+?)["'»]$/);
        if (contieneMatch) {
            const [, kind, kw] = contieneMatch;
            if (['mention', 'dm', 'comment'].includes(kind) && signal.kind !== kind) {
                return false;
            }
            return text.includes(kw.toLowerCase());
        }

        return false;
    }

    // ============================================================
    // PAUSA / REANUDACIÓN
    // ============================================================

    pause() {
        this._paused = true;
        this.logger.info('loop paused by user');
    }

    resume() {
        this._paused = false;
        this.logger.info('loop resumed by user');
    }

    isPaused() {
        return this._paused;
    }

    // ============================================================
    // ESTADO
    // ============================================================

    getState() {
        return {
            running: !this._paused,
            paused: this._paused,
            crisis: this.crisis.getState(),
            metrics: { ...this.metrics },
            ingester: this.ingester.getState(),
            classifier: this.classifier.getState(),
            memory: this.memory.getState(),
        };
    }

    async shutdown() {
        this._running = false;
        this.logger.info('SocialAutonomyLoop shutdown');
    }
}

export default SocialAutonomyLoop;
