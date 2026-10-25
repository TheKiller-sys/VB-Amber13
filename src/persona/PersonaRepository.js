// src/persona/PersonaRepository.js
// Wrapper de persistencia con caché en memoria + versionado + eventos.

import { getLogger } from '../utils/logger.js';
import { eventBus } from '../core/EventBus.js';
import { PersonaConfig } from './PersonaConfig.js';

export class PersonaRepository {
    /**
     * @param {Object} deps
     *   - database — DatabaseManager (obligatorio)
     */
    constructor({ database }) {
        if (!database) throw new Error('PersonaRepository requiere database');
        this.database = database;
        this.logger = getLogger().child({ component: 'PersonaRepository' });

        this._cache = null;
        this._cacheVersion = 0;
        this._listeners = new Set();

        this.metrics = {
            loads: 0,
            saves: 0,
            cacheHits: 0,
            cacheMisses: 0,
        };
    }

    async initialize() {
        const latest = this.database.getLatestPersona();
        if (latest) {
            try {
                this._cache = new PersonaConfig(latest.payload);
                this._cache.version = latest.version;
                this.logger.info(
                    { version: latest.version },
                    'persona cargada desde DB'
                );
            } catch (err) {
                this.logger.error(
                    { err: err.message, version: latest.version },
                    'persona persistida es inválida (schema drift?)'
                );
                this._cache = null;
            }
        } else {
            this.logger.warn('no hay PersonaConfig persistida todavía');
        }
    }

    /**
     * Devuelve la persona vigente (cache).
     * @returns {PersonaConfig|null}
     */
    getLatest() {
        if (this._cache) {
            this.metrics.cacheHits++;
            return this._cache;
        }
        this.metrics.cacheMisses++;
        const latest = this.database.getLatestPersona();
        if (!latest) return null;
        this._cache = new PersonaConfig(latest.payload);
        this._cache.version = latest.version;
        return this._cache;
    }

    /**
     * Persiste una persona nueva. Crea versión nueva.
     * @param {PersonaConfig|Object} input
     * @returns {PersonaConfig}
     */
    save(input) {
        const persona = input instanceof PersonaConfig
            ? input
            : new PersonaConfig(input);

        const saved = this.database.savePersona(persona.toJSON());
        persona.version = saved.version;

        this._cache = persona;
        this._cacheVersion = saved.version;
        this.metrics.saves++;

        this.database.audit({
            category: 'persona',
            event: 'persona_updated',
            severity: 'info',
            details: { version: saved.version },
        });

        eventBus.emit('persona_updated', {
            version: saved.version,
            persona: persona.toJSON(),
        });

        for (const cb of this._listeners) {
            try { cb(persona); } catch (_) {}
        }

        this.logger.info({ version: saved.version }, 'persona persistida');
        return persona;
    }

    /**
     * Recarga desde DB (invalida cache).
     */
    reload() {
        this._cache = null;
        this._cacheVersion = 0;
        return this.getLatest();
    }

    /**
     * ¿Hay persona configurada?
     */
    hasPersona() {
        return !!this.getLatest();
    }

    /**
     * Suscripción a cambios de persona.
     */
    onChange(cb) {
        if (typeof cb !== 'function') return () => {};
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    getState() {
        return {
            hasPersona: !!this._cache,
            version: this._cacheVersion,
            updatedAt: this._cache?.updatedAt || null,
            metrics: { ...this.metrics },
        };
    }

    async shutdown() {
        this._listeners.clear();
    }
}

export default PersonaRepository;
