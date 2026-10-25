// src/http/routes/persona.js
// Endpoints de la PersonaConfig.

import { Router } from 'express';
import { PersonaConfig } from '../../persona/PersonaConfig.js';
import { database } from '../../core/Database.js';
import { asyncHandler, HttpError } from '../errorHandler.js';

export function createPersonaRouter({ personaRepo }) {
    const router = Router();

    // GET /api/persona — persona vigente
    router.get('/', asyncHandler(async (_req, res) => {
        const persona = personaRepo.getLatest();
        if (!persona) throw new HttpError(404, 'no_persona', 'No hay PersonaConfig');
        res.json({ persona: persona.toJSON() });
    }));

    // GET /api/persona/state — métricas de la repo
    router.get('/state', asyncHandler(async (_req, res) => {
        res.json({ state: personaRepo.getState() });
    }));

    // GET /api/persona/history?limit=20
    router.get('/history', asyncHandler(async (req, res) => {
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const rows = database._stmt(
            'SELECT version, payload, updated_at FROM persona_config ORDER BY id DESC LIMIT ?'
        ).all(limit).map((r) => ({
            version: r.version,
            updated_at: r.updated_at,
            payload: JSON.parse(r.payload),
        }));
        res.json({ versions: rows, count: rows.length });
    }));

    // POST /api/persona — crear persona (falla si ya existe)
    router.post('/', asyncHandler(async (req, res) => {
        if (personaRepo.hasPersona()) {
            throw new HttpError(409, 'persona_exists', 'Ya existe una persona. Usa PUT.');
        }
        let persona;
        try {
            persona = new PersonaConfig(req.body);
        } catch (err) {
            throw new HttpError(400, 'invalid_persona', err.message, err.issues || null);
        }
        const saved = personaRepo.save(persona);
        res.status(201).json({ persona: saved.toJSON() });
    }));

    // PUT /api/persona — reemplazar persona (crea versión nueva)
    router.put('/', asyncHandler(async (req, res) => {
        if (!personaRepo.hasPersona()) {
            throw new HttpError(404, 'no_persona', 'Sin persona. Usa POST.');
        }
        let persona;
        try {
            persona = new PersonaConfig(req.body);
        } catch (err) {
            throw new HttpError(400, 'invalid_persona', err.message, err.issues || null);
        }
        const saved = personaRepo.save(persona);
        res.json({ persona: saved.toJSON() });
    }));

    return router;
}
