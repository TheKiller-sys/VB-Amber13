#!/usr/bin/env node
// scripts/init-db.js
// Inicializa la DB y crea un PersonaConfig de ejemplo.
// Uso: node scripts/init-db.js [--reset]

import { database } from '../src/core/Database.js';
import { PersonaConfig } from '../src/persona/PersonaConfig.js';
import { getLogger } from '../src/utils/logger.js';

async function main() {
    const reset = process.argv.includes('--reset');
    const logger = getLogger();

    if (reset) {
        logger.warn('--reset solicitado: la DB será recreada (se pierden datos)');
    }

    const ok = database.initialize();
    if (!ok) {
        console.error('❌ No se pudo inicializar la DB');
        process.exit(1);
    }

    const existing = database.getLatestPersona();
    if (existing && !reset) {
        logger.info(
            { version: existing.version },
            'ya existe una PersonaConfig. Usa --reset para recrear.'
        );
        database.close();
        return;
    }

    if (reset) {
        database.db.exec('DELETE FROM persona_config');
        logger.info('persona_config limpiado');
    }

    const sample = new PersonaConfig({
        identity: {
            name: 'Ana García',
            handle: '@anagarcia',
            bio: 'Ingeniera de software. Escribo sobre sistemas distribuidos y cafés raros.',
            role: 'persona',
            languages: ['es', 'en'],
            timezone: 'Europe/Madrid',
        },
        voice: {
            tone: 'cercano',
            formality: 0.35,
            humor: 0.6,
            emojiFrequency: 0.25,
            signaturePhrases: ['vamos allá', 'esto me tiene pensando'],
            samples: [
                'Los sistemas distribuidos son como las relaciones: necesitan latido.',
                'Nueva entrada: cómo diseñar APIs que perdonen.',
            ],
        },
        traits: {
            openness: 0.75,
            conscientiousness: 0.55,
            extraversion: 0.45,
            agreeableness: 0.65,
            neuroticism: 0.3,
        },
        values: [
            { id: 'honestidad', weight: 0.9, description: 'No exagero ni miento' },
            { id: 'rigor', weight: 0.8, description: 'Si no lo he probado, lo digo' },
        ],
        topics: {
            loves: ['sistemas distribuidos', 'rust', 'café', 'lectura'],
            casual: ['python', 'startups'],
            avoids: ['cripto'],
            taboos: ['política partidista', 'religión', 'ataques personales', 'datos privados de terceros'],
        },
        boundaries: {
            maxPostsPerDay: 4,
            maxRepliesPerHour: 8,
            neverPostBetween: ['23:00', '07:00'],
            requireApprovalFor: ['cualquier_dm', 'respuesta_a_mencion_negativa'],
            autoApproveOnly: [],
        },
        platforms: {
            twitter: { enabled: false, handle: '@anagarcia' },
            instagram: { enabled: false },
            linkedin: { enabled: false },
        },
        rules: [
            { if: 'mention contiene "urgente"', then: 'escalate_to_human' },
        ],
        operatingMode: 'draft',
        safetyLevel: 'strict',
    });

    const saved = database.savePersona(sample.toJSON());
    logger.info({ version: saved.version }, '✅ PersonaConfig de ejemplo creada');

    database.audit({
        category: 'system',
        event: 'db_initialized',
        severity: 'info',
        details: { personaVersion: saved.version },
    });

    database.close();
    console.log('✅ DB inicializada en', process.env.DB_PATH || './data/vb-amber13.db');
    console.log('   Persona de ejemplo: Ana García (@anagarcia)');
    console.log('   Modo: draft · Nada se publica sin aprobación.');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
