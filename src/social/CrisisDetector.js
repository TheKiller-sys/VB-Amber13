// src/social/CrisisDetector.js
// Detección de crisis para pausar el loop completo.
//
// Triggers:
//  - > N señales negativas en ventana de T minutos
//  - Cualquier DM urgente
//  - Cualquier mención con patrón de amenaza legal
//  - Fallo repetido de plataformas (>3 fallos en 10min)
//  - NUEVO: challenge de scraping detectado en cualquier plataforma
//  - NUEVO: sesión de scraping expirada (llamado desde el loop)

import { getLogger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';
import { CLASSIFICATIONS } from './types.js';

const LEGAL_THREATS = [
    /\b(denuncia|demanda|abogado|legal action|lawsuit|attorney)\b/,
    /\b(te voy a (denunciar|llevar a juicio)|nos vemos en (los tribunales|el juzgado))\b/,
    /\b(gdpr|rgpd|derecho al olvido|takedown)\b/,
];

export class CrisisDetector {
    /**
     * @param {Object} deps
     *   - database — DatabaseManager (obligatorio, para persistir crisis)
     *   - now      — () => number (inyectable en tests)
     */
    constructor({ database, now = () => Date.now() }) {
        this.database = database;
        this.now = now;
        this.logger = getLogger().child({ component: 'CrisisDetector' });

        this._negativeSignals = []; // { at, signalId, classification }
        this._paused = false;
        this._pausedUntil = 0;
        this._pauseReason = null;

        this.metrics = {
            checks: 0,
            crisisDetected: 0,
            crisisResolved: 0,
            pauses: 0,
            forced: 0,
        };
    }

    async initialize() {
        const env = getEnv();
        this._negativeThreshold = env.VB_AMBER_CRISIS_NEGATIVE_THRESHOLD;
        this._windowMs = env.VB_AMBER_CRISIS_WINDOW_MIN * 60 * 1000;
        this._pauseMs = 30 * 60 * 1000; // 30 min

        this.logger.info(
            {
                negativeThreshold: this._negativeThreshold,
                windowMin: env.VB_AMBER_CRISIS_WINDOW_MIN,
            },
            'CrisisDetector listo'
        );
    }

    /**
     * Registra una señal clasificada y evalúa si hay crisis.
     * @returns {Object} { crisis: boolean, reason: string|null }
     */
    evaluate(signal, classificationResult) {
        const now = this.now();
        this.metrics.checks++;

        // Purgar ventana
        this._negativeSignals = this._negativeSignals.filter(
            s => now - s.at < this._windowMs
        );

        const classification = classificationResult?.classification || '';
        const text = signal.text || '';

        // 1. Amenaza legal → crisis inmediata
        if (this._matchesAny(text, LEGAL_THREATS)) {
            this._triggerCrisis('legal_threat', [signal.id]);
            return { crisis: true, reason: 'legal_threat' };
        }

        // 2. DM urgente → crisis inmediata
        if (classification === CLASSIFICATIONS.DM_URGENT) {
            this._triggerCrisis('dm_urgent', [signal.id]);
            return { crisis: true, reason: 'dm_urgent' };
        }

        // 3. Registrar negativa
        if (classification.includes('negativa') || classification.includes('negativo')) {
            this._negativeSignals.push({
                at: now,
                signalId: signal.id,
                classification,
            });
        }

        // 4. Umbral de negativas → crisis
        if (this._negativeSignals.length >= this._negativeThreshold) {
            const ids = this._negativeSignals.map(s => s.signalId);
            this._triggerCrisis('negative_threshold', ids);
            return { crisis: true, reason: 'negative_threshold' };
        }

        return { crisis: false, reason: null };
    }

    /**
     * Fuerza una crisis desde fuera del detector (p.ej. challenge de scraping).
     * Respeta si ya hay una crisis activa.
     *
     * @param {string} reason
     * @param {Object} details — { signalIds?, platform?, ... }
     * @returns {{ crisis: boolean, reason: string }}
     */
    forceCrisis(reason, details = {}) {
        this.metrics.forced++;
        if (this._paused) {
            return { crisis: true, reason: this._pauseReason };
        }
        const signalIds = Array.isArray(details.signalIds)
            ? details.signalIds
            : (details.platform ? [`platform:${details.platform}`] : []);
        this._triggerCrisis(reason, signalIds);

        // Audit extra con details completos
        try {
            this.database.audit({
                category: 'crisis',
                event: 'crisis_forced',
                severity: 'error',
                details: { reason, ...details },
            });
        } catch (_) {}

        return { crisis: true, reason };
    }

    _triggerCrisis(reason, signalIds) {
        if (this._paused) return;

        const now = this.now();
        this._paused = true;
        this._pausedUntil = now + this._pauseMs;
        this._pauseReason = reason;
        this.metrics.crisisDetected++;
        this.metrics.pauses++;

        this.logger.error(
            { reason, signalIds, pausedUntilMs: this._pauseMs },
            '🚨 CRISIS DETECTED — pausing loop'
        );

        try {
            this.database.recordCrisis({
                reason,
                signalIds,
                pausedUntil: this._pausedUntil,
            });
            this.database.audit({
                category: 'crisis',
                event: 'crisis_detected',
                severity: 'error',
                details: { reason, signalIds, pausedUntil: this._pausedUntil },
            });
        } catch (err) {
            this.logger.warn({ err: err.message }, 'crisis persistence failed');
        }
    }

    /**
     * Debe llamarse periódicamente para resolver la pausa
     * una vez cumplido el plazo.
     */
    checkResume() {
        if (!this._paused) return false;

        const now = this.now();
        if (now >= this._pausedUntil) {
            this._resume();
            return true;
        }
        return false;
    }

    _resume() {
        this._paused = false;
        this._pausedUntil = 0;
        this._pauseReason = null;
        this._negativeSignals = [];
        this.metrics.crisisResolved++;

        this.logger.info('✅ Crisis resuelta — reanudando loop');

        try {
            this.database.resolveCrisis();
            this.database.audit({
                category: 'crisis',
                event: 'crisis_resolved',
                severity: 'info',
                details: {},
            });
        } catch (_) {}
    }

    isPaused() {
        return this._paused;
    }

    getState() {
        const now = this.now();
        return {
            paused: this._paused,
            pauseReason: this._pauseReason,
            pauseRemainingMs: this._paused ? Math.max(0, this._pausedUntil - now) : 0,
            negativeSignalsInWindow: this._negativeSignals.length,
            negativeThreshold: this._negativeThreshold,
            windowMin: this._windowMs / 60000,
            metrics: { ...this.metrics },
        };
    }

    forceResume() {
        if (this._paused) this._resume();
    }

    _matchesAny(text, patterns) {
        const t = String(text || '').toLowerCase();
        for (const p of patterns) {
            if (p.test(t)) return true;
        }
        return false;
    }

    async shutdown() {}
}

export default CrisisDetector;
