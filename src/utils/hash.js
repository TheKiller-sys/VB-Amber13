// src/utils/hash.js
// Hash determinista (FNV-1a 32-bit + SHA-1 hex).
// FNV para firmas cortas, SHA-1 para deduplicación.

import { createHash } from 'node:crypto';

/**
 * FNV-1a 32-bit. Rápido, estable, no criptográfico.
 * Devuelve un entero sin signo.
 */
export function fnv1a(str) {
    if (typeof str !== 'string') str = String(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/**
 * SHA-1 hex. Para deduplicación robusta.
 * NUNCA usar para seguridad — solo para hashing de contenido.
 */
export function sha1(str) {
    if (typeof str !== 'string') str = String(str);
    return createHash('sha1').update(str).digest('hex');
}

/**
 * Hash corto (12 chars) para IDs legibles.
 */
export function shortHash(str) {
    return sha1(str).substring(0, 12);
}

/**
 * Genera un ID único corto: `prefix_<timestamp>_<hash6>`.
 */
export function makeId(prefix = 'id') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${ts}_${rand}`;
}
