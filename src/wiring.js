// src/wiring.js
// Cableado de todas las piezas. Construye, registra y deja que
// SystemCore las inicialice en orden.
//
// En modo scraping se añade BrowserSessionManager ANTES que AdapterManager,
// porque el manager necesita estar inicializado para que los adapters
// sepan si hay sesión guardada.

import { database } from './core/Database.js';
import { systemCore } from './core/SystemCore.js';
import { getLogger } from './utils/logger.js';
import { getEnv } from './config/env.js';

import { PersonaRepository } from './persona/PersonaRepository.js';
import { PersonaGuard } from './persona/PersonaGuard.js';

import { LLMBridge } from './llm/LLMBridge.js';

import { SocialMemory } from './social/SocialMemory.js';
import { CrisisDetector } from './social/CrisisDetector.js';
import { SignalClassifier } from './social/SignalClassifier.js';
import { SignalIngester } from './social/SignalIngester.js';
import { SocialAutonomyLoop } from './social/SocialAutonomyLoop.js';
import { AdapterManager } from './social/adapters/index.js';
import { BrowserSessionManager } from './social/browser/BrowserSessionManager.js';

/**
 * Construye todos los servicios y los registra en SystemCore.
 * NO inicializa — SystemCore.initialize() se encarga en orden.
 */
export async function wire() {
    const env = getEnv();
    const logger = getLogger();
    logger.info({ transport: env.VB_AMBER_TRANSPORT }, 'wiring services');

    // ---- Persona ----
    const personaRepo = new PersonaRepository({ database });

    // ---- LLM ----
    const llm = new LLMBridge();

    // ---- Browser sessions (solo en scraping) ----
    let sessions = null;
    if (env.VB_AMBER_TRANSPORT === 'scraping') {
        sessions = new BrowserSessionManager();
        // Prioridad alta de shutdown: cerrar browser ANTES que adapters
        systemCore.registerModule('sessions', sessions, { shutdownPriority: 95 });
    }

    // ---- Adapters ----
    const adapterManager = new AdapterManager({ sessions, database });

    // ---- Guard ----
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

    // ---- Registro en SystemCore ----
    // El orden de inserción importa para initialize(); el de shutdownPriority
    // para shutdown (mayor prioridad = se cierra antes).
    systemCore.registerModule('persona',    personaRepo,     { shutdownPriority: 30 });
    systemCore.registerModule('llm',        llm,             { shutdownPriority: 80 });
    // sessions ya registrado arriba (si aplica), ANTES que adapters
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
        sessions,
        adapterManager,
        guard,
        memory,
        classifier,
        crisis,
        ingester,
        loop,
    };
}
