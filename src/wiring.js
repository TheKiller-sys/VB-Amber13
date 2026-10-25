// src/wiring.js
// Cableado de todas las piezas. Construye, registra y deja que
// SystemCore las inicialice en orden.

import { database } from './core/Database.js';
import { systemCore } from './core/SystemCore.js';
import { getLogger } from './utils/logger.js';

import { PersonaRepository } from './persona/PersonaRepository.js';
import { PersonaGuard } from './persona/PersonaGuard.js';

import { LLMBridge } from './llm/LLMBridge.js';

import { SocialMemory } from './social/SocialMemory.js';
import { CrisisDetector } from './social/CrisisDetector.js';
import { SignalClassifier } from './social/SignalClassifier.js';
import { SignalIngester } from './social/SignalIngester.js';
import { SocialAutonomyLoop } from './social/SocialAutonomyLoop.js';
import { AdapterManager } from './social/adapters/index.js';

/**
 * Construye todos los servicios y los registra en SystemCore.
 * NO inicializa — SystemCore.initialize() se encarga en orden.
 */
export async function wire() {
    const logger = getLogger();
    logger.info('wiring services');

    // ---- Persona ----
    const personaRepo = new PersonaRepository({ database });

    // ---- LLM ----
    const llm = new LLMBridge();

    // ---- Adapters (Twitter / Instagram / LinkedIn) ----
    const adapterManager = new AdapterManager();

    // ---- Guard (última línea de defensa) ----
    const guard = new PersonaGuard({ database, repository: personaRepo });

    // ---- Soporte social ----
    const memory = new SocialMemory({ database });
    const classifier = new SignalClassifier();
    const crisis = new CrisisDetector({ database });
    const ingester = new SignalIngester({
        database,
        adapterManager,
        personaRepo,
    });

    // ---- Loop ----
    const loop = new SocialAutonomyLoop({
        database,
        personaRepo,
        llm,
        guard,
        ingester,
        classifier,
        memory,
        crisis,
        adapterManager,
    });

    // ---- Registro en SystemCore (prioridad = orden de shutdown, alto = antes) ----
    systemCore.registerModule('persona',    personaRepo,     { shutdownPriority: 30 });
    systemCore.registerModule('llm',        llm,             { shutdownPriority: 80 });
    systemCore.registerModule('adapters',   adapterManager,  { shutdownPriority: 90 });
    systemCore.registerModule('guard',      guard);
    systemCore.registerModule('memory',     memory,          { shutdownPriority: 40 });
    systemCore.registerModule('classifier', classifier,      { shutdownPriority: 50 });
    systemCore.registerModule('crisis',     crisis,          { shutdownPriority: 60 });
    systemCore.registerModule('ingester',   ingester,        { shutdownPriority: 70 });
    systemCore.registerModule('social',     loop,            { shutdownPriority: 100 });

    return {
        personaRepo,
        llm,
        adapterManager,
        guard,
        memory,
        classifier,
        crisis,
        ingester,
        loop,
    };
}
