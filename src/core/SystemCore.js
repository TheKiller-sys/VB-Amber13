// src/core/SystemCore.js
// Orquestador central minimalista. Registra módulos, valida
// dependencias, arranca el loop principal, maneja shutdown limpio.

import { getLogger } from '../utils/logger.js';
import { eventBus } from './EventBus.js';
import { database } from './Database.js';
import { getEnv } from '../config/env.js';
import { TUNING } from '../config/tuning.js';

const SHUTDOWN_TIMEOUT_MS = 15000;

export class SystemCore {
    constructor() {
        this.modules = new Map();
        this.isRunning = false;
        this.isShuttingDown = false;
        this.startedAt = null;
        this.cycleCount = 0;
        this._loopTimer = null;
        this._shutdownHandlers = [];
        this._moduleShutdownOrder = [];
        this._lastCycleDurationMs = 0;

        this.metrics = {
            totalCycles: 0,
            failedCycles: 0,
            avgCycleMs: 0,
        };
    }

    // ============================================================
    // REGISTRO DE MÓDULOS
    // ============================================================

    registerModule(name, instance, opts = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('registerModule: name required');
        }
        if (!instance) {
            throw new Error(`registerModule(${name}): instance required`);
        }
        if (this.modules.has(name)) {
            getLogger().warn({ module: name }, 'module already registered, overwriting');
        }

        this.modules.set(name, instance);

        // Guardar orden de shutdown si el módulo lo pide
        if (opts.shutdownPriority !== undefined) {
            this._moduleShutdownOrder.push({ name, priority: opts.shutdownPriority });
            this._moduleShutdownOrder.sort((a, b) => b.priority - a.priority);
        }

        getLogger().debug({ module: name }, 'module registered');
        return instance;
    }

    getModule(name) {
        return this.modules.get(name) || null;
    }

    hasModule(name) {
        return this.modules.has(name);
    }

    // ============================================================
    // CICLO DE VIDA
    // ============================================================

    async initialize() {
        const t0 = Date.now();
        getLogger().info({ env: getEnv().NODE_ENV }, 'SystemCore initializing');

        // 1. DB
        if (!database.initialize()) {
            throw new Error('Database initialization failed');
        }

        // 2. Init de cada módulo (en orden de registro)
        for (const [name, instance] of this.modules) {
            if (instance && typeof instance.initialize === 'function') {
                try {
                    await instance.initialize();
                    getLogger().debug({ module: name }, 'module initialized');
                } catch (err) {
                    getLogger().error(
                        { module: name, err: err.message },
                        'module init failed'
                    );
                    throw new Error(`Module ${name} init failed: ${err.message}`);
                }
            }
        }

        // 3. Verificar módulos críticos
        this._verifyRequiredModules();

        // 4. Auditoría inicial
        database.audit({
            category: 'system',
            event: 'system_initialized',
            severity: 'info',
            details: {
                modules: Array.from(this.modules.keys()),
                elapsedMs: Date.now() - t0,
            },
        });

        this.startedAt = Date.now();
        this.isRunning = true;

        eventBus.emit('system_initialized', {
            modules: Array.from(this.modules.keys()),
            elapsedMs: Date.now() - t0,
        });

        getLogger().info(
            { ms: Date.now() - t0, modules: this.modules.size },
            'SystemCore initialized'
        );
    }

    _verifyRequiredModules() {
        const required = ['persona', 'llm', 'social'];
        for (const name of required) {
            if (!this.modules.has(name)) {
                throw new Error(`Required module missing: ${name}`);
            }
        }
    }

    start() {
        if (!this.isRunning) {
            throw new Error('Cannot start: SystemCore not initialized');
        }
        if (this._loopTimer) {
            getLogger().warn('loop already running');
            return;
        }

        const env = getEnv();
        const intervalMs = env.VB_AMBER_LOOP_INTERVAL_MS;

        getLogger().info({ intervalMs }, 'starting main loop');

        const tick = async () => {
            if (this.isShuttingDown) return;
            try {
                await this._runCycle();
            } catch (err) {
                this.metrics.failedCycles++;
                getLogger().error({ err: err.message }, 'cycle failed');
                database.audit({
                    category: 'system',
                    event: 'cycle_failed',
                    severity: 'error',
                    details: { err: err.message },
                });
            }
            if (!this.isShuttingDown) {
                this._loopTimer = setTimeout(tick, intervalMs);
                if (this._loopTimer.unref) this._loopTimer.unref();
            }
        };

        // Primer tick inmediato
        this._loopTimer = setTimeout(tick, 1000);
        if (this._loopTimer.unref) this._loopTimer.unref();
    }

    async _runCycle() {
        const t0 = Date.now();
        this.cycleCount++;
        this.metrics.totalCycles++;

        const social = this.modules.get('social');
        if (social && typeof social.tick === 'function') {
            await social.tick();
        }

        const elapsed = Date.now() - t0;
        this._lastCycleDurationMs = elapsed;
        const n = this.metrics.totalCycles;
        this.metrics.avgCycleMs = this.metrics.avgCycleMs * ((n - 1) / n) + elapsed * (1 / n);
    }

    async shutdown(reason = 'manual') {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        getLogger().info({ reason }, 'SystemCore shutting down');

        if (this._loopTimer) {
            clearTimeout(this._loopTimer);
            this._loopTimer = null;
        }

        const timeoutPromise = new Promise((_, reject) => {
            const t = setTimeout(
                () => reject(new Error('shutdown timeout')),
                SHUTDOWN_TIMEOUT_MS
            );
            if (t.unref) t.unref();
        });

        const shutdownPromise = (async () => {
            // 1. Módulos por prioridad
            for (const { name } of this._moduleShutdownOrder) {
                const instance = this.modules.get(name);
                if (instance && typeof instance.shutdown === 'function') {
                    try {
                        await instance.shutdown();
                        getLogger().debug({ module: name }, 'module shutdown');
                    } catch (err) {
                        getLogger().warn(
                            { module: name, err: err.message },
                            'module shutdown failed'
                        );
                    }
                }
            }

            // 2. Resto de módulos
            for (const [name, instance] of this.modules) {
                if (this._moduleShutdownOrder.some(m => m.name === name)) continue;
                if (instance && typeof instance.shutdown === 'function') {
                    try {
                        await instance.shutdown();
                    } catch (_) {}
                }
            }

            // 3. Audit final
            try {
                database.audit({
                    category: 'system',
                    event: 'system_shutdown',
                    severity: 'info',
                    details: {
                        reason,
                        uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
                        cycles: this.cycleCount,
                    },
                });
            } catch (_) {}

            // 4. Cerrar DB
            database.close();
        })();

        try {
            await Promise.race([shutdownPromise, timeoutPromise]);
        } catch (err) {
            getLogger().error({ err: err.message }, 'shutdown error');
        }

        this.isRunning = false;
        getLogger().info('SystemCore shutdown complete');
    }

    getState() {
        return {
            running: this.isRunning,
            startedAt: this.startedAt,
            uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
            cycleCount: this.cycleCount,
            lastCycleMs: this._lastCycleDurationMs,
            modules: Array.from(this.modules.keys()),
            metrics: { ...this.metrics },
            db: database.isInitialized ? database.getStats() : null,
            eventBus: eventBus.getState(),
        };
    }
}

export const systemCore = new SystemCore();
export default systemCore;
