// src/persona/PersonaConfig.js
// Schema canónico de la persona + validación Zod + helpers.
// Este es el archivo que define QUÉ PERSONA ES EL AGENTE.

import { z } from 'zod';
import { TUNING } from '../config/tuning.js';

// ============================================================
// HELPERS DE VALIDACIÓN
// ============================================================

const TZ_VALID = (tz) => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ============================================================
// ESQUEMA ZOD
// ============================================================

const IdentitySchema = z.object({
    name: z.string().min(1).max(100),
    handle: z.string().min(1).max(50),
    bio: z.string().max(500).default(''),
    role: z.string().max(60).default('persona'),
    languages: z.array(z.string().min(2).max(8)).min(1).max(10).default(['es']),
    timezone: z.string()
        .refine(TZ_VALID, { message: 'Invalid IANA timezone' })
        .default('UTC'),
});

const VoiceSchema = z.object({
    tone: z.enum([
        'cercano', 'formal', 'casual', 'técnico', 'poético', 'directo',
        'cálido', 'irónico', 'juguetón', 'reflexivo',
    ]).default('cercano'),
    formality: z.number().min(0).max(1).default(0.5),
    humor: z.number().min(0).max(1).default(0.5),
    emojiFrequency: z.number().min(0).max(1).default(0.3),
    sentenceLength: z.enum(['corta', 'media', 'larga']).default('media'),
    punctuation: z.enum(['normal', 'expresiva', 'minima']).default('normal'),
    signaturePhrases: z.array(z.string().min(1).max(100)).max(20).default([]),
    bannedPhrases: z.array(z.string().min(1).max(150)).max(100).default([
        'como modelo de lenguaje',
        'como IA',
        'estoy aquí para ayudarte',
        'soy un asistente',
        'no soy un humano',
        'fui entrenado para',
    ]),
    samples: z.array(z.string().min(1).max(500)).max(30).default([]),
});

const TraitsSchema = z.object({
    openness: z.number().min(0).max(1).default(0.5),
    conscientiousness: z.number().min(0).max(1).default(0.5),
    extraversion: z.number().min(0).max(1).default(0.5),
    agreeableness: z.number().min(0).max(1).default(0.5),
    neuroticism: z.number().min(0).max(1).default(0.5),
});

const ValueSchema = z.object({
    id: z.string().min(1).max(60),
    weight: z.number().min(0).max(1).default(0.5),
    description: z.string().max(300).default(''),
});

const TopicsSchema = z.object({
    loves: z.array(z.string().min(1).max(80)).max(30).default([]),
    casual: z.array(z.string().min(1).max(80)).max(30).default([]),
    avoids: z.array(z.string().min(1).max(80)).max(30).default([]),
    taboos: z.array(z.string().min(1).max(120)).max(50).default([
        'política partidista',
        'religión',
        'ataques personales',
        'información privada de terceros',
    ]),
});

const BoundariesSchema = z.object({
    neverDmFirst: z.boolean().default(false),
    neverReplyTo: z.array(z.string().min(1).max(100)).max(100).default([]),
    neverPostBetween: z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)])
        .nullable()
        .default(['23:00', '07:00']),
    requireApprovalFor: z.array(z.string().min(1).max(80)).max(50).default([
        'cualquier_dm',
        'respuesta_a_mencion_negativa',
        'post_con_mas_de_280_chars',
        'nuevo_tema',
    ]),
    autoApproveOnly: z.array(z.string().min(1).max(80)).max(50).default([]),
    maxPostsPerDay: z.number().int().min(0).max(50).default(5),
    maxRepliesPerHour: z.number().int().min(0).max(120).default(10),
    minMsBetweenProactivePosts: z.number().int().min(0).max(24 * 3600 * 1000)
        .default(TUNING.MIN_MS_BETWEEN_PROACTIVE_POSTS),
});

const PlatformConfigSchema = z.object({
    enabled: z.boolean().default(false),
    handle: z.string().max(100).default(''),
    styleOverride: z.object({
        tone: z.string().max(40).optional(),
        formality: z.number().min(0).max(1).optional(),
        maxLength: z.number().int().min(10).max(10000).optional(),
    }).nullable().default(null),
});

const PlatformsSchema = z.object({
    twitter: PlatformConfigSchema.default({}),
    instagram: PlatformConfigSchema.default({}),
    linkedin: PlatformConfigSchema.default({}),
    threads: PlatformConfigSchema.default({}),
});

const RuleSchema = z.object({
    if: z.string().min(1).max(300),
    then: z.enum([
        'escalate_to_human',
        'avoid',
        'skip',
        'use_template',
        'force_approval',
    ]).or(z.string().max(120)),
});

const PersonaSchema = z.object({
    identity: IdentitySchema,
    voice: VoiceSchema.default({}),
    traits: TraitsSchema.default({}),
    values: z.array(ValueSchema).max(50).default([]),
    topics: TopicsSchema.default({}),
    boundaries: BoundariesSchema.default({}),
    platforms: PlatformsSchema.default({}),
    rules: z.array(RuleSchema).max(100).default([]),
    operatingMode: z.enum(['draft', 'auto']).default('draft'),
    safetyLevel: z.enum(['strict', 'normal', 'permissive']).default('strict'),
});

export const PERSONA_SCHEMA_VERSION = 1;

// ============================================================
// PERSONA CONFIG
// ============================================================

export class PersonaConfig {
    /**
     * Crea una PersonaConfig validada.
     * @param {Object} raw — objeto plano tal como llega de la API o DB.
     * @throws {Error} si la validación Zod falla.
     */
    constructor(raw = {}) {
        const parsed = PersonaSchema.safeParse(raw);
        if (!parsed.success) {
            const issues = parsed.error.issues
                .map(i => `${i.path.join('.')}: ${i.message}`)
                .join('; ');
            const err = new Error(`PersonaConfig inválida: ${issues}`);
            err.issues = parsed.error.issues;
            throw err;
        }

        const d = parsed.data;
        this.version = PERSONA_SCHEMA_VERSION;
        this.updatedAt = Date.now();

        this.identity = { ...d.identity };
        this.voice = { ...d.voice };
        this.traits = { ...d.traits };
        this.values = d.values.map(v => ({ ...v }));
        this.topics = {
            loves: [...d.topics.loves],
            casual: [...d.topics.casual],
            avoids: [...d.topics.avoids],
            taboos: [...d.topics.taboos],
        };
        this.boundaries = { ...d.boundaries };
        this.platforms = JSON.parse(JSON.stringify(d.platforms));
        this.rules = d.rules.map(r => ({ ...r }));
        this.operatingMode = d.operatingMode;
        this.safetyLevel = d.safetyLevel;
    }

    // ============================================================
    // SERIALIZACIÓN
    // ============================================================

    toJSON() {
        return {
            version: this.version,
            updatedAt: this.updatedAt,
            identity: { ...this.identity },
            voice: { ...this.voice },
            traits: { ...this.traits },
            values: this.values.map(v => ({ ...v })),
            topics: {
                loves: [...this.topics.loves],
                casual: [...this.topics.casual],
                avoids: [...this.topics.avoids],
                taboos: [...this.topics.taboos],
            },
            boundaries: {
                ...this.boundaries,
                neverPostBetween: this.boundaries.neverPostBetween
                    ? [...this.boundaries.neverPostBetween]
                    : null,
            },
            platforms: JSON.parse(JSON.stringify(this.platforms)),
            rules: this.rules.map(r => ({ ...r })),
            operatingMode: this.operatingMode,
            safetyLevel: this.safetyLevel,
        };
    }

    // ============================================================
    // BLOQUE PARA EL LLM
    // ============================================================

    /**
     * Bloque de prompt con TODO lo que el LLM necesita para hablar
     * como esta persona. Se inyecta al inicio del system prompt.
     */
    toPromptBlock() {
        const lines = [];
        const b = this.boundaries;

        lines.push('=== QUIÉN ERES (DEFINIDO POR EL USUARIO) ===');
        lines.push(`Eres "${this.identity.name}", escribiendo como ${this.identity.handle}.`);
        if (this.identity.bio) lines.push(`Bio: ${this.identity.bio}`);
        lines.push(`Idiomas: ${this.identity.languages.join(', ')}.`);
        lines.push('');

        lines.push('=== TU VOZ ===');
        lines.push(`• Tono: ${this.voice.tone}.`);
        lines.push(`• Formalidad: ${this._label(this.voice.formality)}.`);
        lines.push(`• Humor: ${this._label(this.voice.humor)}.`);
        lines.push(`• Emojis: ${this._label(this.voice.emojiFrequency)}.`);
        lines.push(`• Longitud de frase: ${this.voice.sentenceLength}.`);
        lines.push(`• Puntuación: ${this.voice.punctuation}.`);
        if (this.voice.signaturePhrases.length > 0) {
            lines.push(`• Frases firma: ${this.voice.signaturePhrases.join(', ')}.`);
        }
        if (this.voice.bannedPhrases.length > 0) {
            lines.push(`• PROHIBIDO decir: ${this.voice.bannedPhrases.join('; ')}.`);
        }
        if (this.voice.samples.length > 0) {
            lines.push('');
            lines.push('Ejemplos de tu escritura real (imita este estilo):');
            for (const s of this.voice.samples.slice(0, 3)) {
                lines.push(`  – "${s}"`);
            }
        }
        lines.push('');

        if (this.values.length > 0) {
            lines.push('=== TUS VALORES ===');
            for (const v of this.values) {
                const w = v.weight >= 0.7 ? ' [FUERTE]' : '';
                lines.push(`• ${v.id} (${v.weight.toFixed(2)})${w}: ${v.description}`);
            }
            lines.push('');
        }

        lines.push('=== TEMAS ===');
        if (this.topics.loves.length > 0) {
            lines.push(`• Te apasiona: ${this.topics.loves.join(', ')}.`);
        }
        if (this.topics.casual.length > 0) {
            lines.push(`• Tocas si viene al caso: ${this.topics.casual.join(', ')}.`);
        }
        if (this.topics.avoids.length > 0) {
            lines.push(`• Evitas: ${this.topics.avoids.join(', ')}.`);
        }
        if (this.topics.taboos.length > 0) {
            lines.push(`• NUNCA tocas (tabú absoluto): ${this.topics.taboos.join(', ')}.`);
        }
        lines.push('');

        lines.push('=== REGLAS DURAS ===');
        if (b.maxPostsPerDay > 0) {
            lines.push(`• Máximo ${b.maxPostsPerDay} publicaciones al día.`);
        }
        if (b.maxRepliesPerHour > 0) {
            lines.push(`• Máximo ${b.maxRepliesPerHour} respuestas por hora.`);
        }
        if (b.neverPostBetween) {
            lines.push(`• Nunca publiques entre ${b.neverPostBetween[0]} y ${b.neverPostBetween[1]} (${this.identity.timezone}).`);
        }
        if (b.neverDmFirst) {
            lines.push('• Nunca inicies un DM; solo responde si te escriben primero.');
        }
        for (const rule of this.rules) {
            lines.push(`• SI ${rule.if} → ${rule.then}.`);
        }
        lines.push('');

        lines.push('=== REGLAS DE FORMATO (CRÍTICAS) ===');
        lines.push('• Devuelve SOLO el texto que se va a publicar.');
        lines.push('• Sin comillas envolventes, sin prefijos ("Tuit:", "Respuesta:"), sin markdown.');
        lines.push('• Sin explicaciones ni meta-comentario sobre tu proceso.');
        lines.push('• Si el tema es tabú o no puedes responder con integridad, devuelve exactamente: [SKIP]');
        lines.push('• Nunca menciones que eres una IA, un bot, un modelo de lenguaje, ni que estás "programado".');
        lines.push('• Nunca inventes datos, cifras, hechos o noticias que no aparezcan en el contexto.');
        lines.push('• Escribe en el idioma del usuario o, si es un post proactivo, en el idioma principal de tu bio.');

        return lines.join('\n');
    }

    _label(v) {
        if (v < 0.3) return 'bajo';
        if (v > 0.7) return 'alto';
        return 'medio';
    }

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Devuelve la config de una plataforma concreta.
     */
    getPlatformConfig(platform) {
        return this.platforms[platform] || null;
    }

    /**
     * ¿Está habilitada esta plataforma?
     */
    isPlatformEnabled(platform) {
        return !!(this.platforms[platform]?.enabled);
    }

    /**
     * Límite de caracteres por plataforma (con override de persona).
     */
    getMaxLength(platform) {
        const override = this.platforms[platform]?.styleOverride?.maxLength;
        if (typeof override === 'number') return override;

        switch (platform) {
            case 'twitter':   return TUNING.DRAFT_MAX_LENGTH_TWITTER;
            case 'linkedin':  return TUNING.DRAFT_MAX_LENGTH_LINKEDIN;
            case 'instagram': return TUNING.DRAFT_MAX_LENGTH_INSTAGRAM;
            default:          return TUNING.DRAFT_MAX_LENGTH_TWITTER;
        }
    }

    /**
     * ¿Requiere aprobación humana esta clasificación en esta plataforma?
     * En `strict`, TODO requiere aprobación salvo que esté en autoApproveOnly.
     * En `permissive`, solo lo que explícitamente esté en requireApprovalFor.
     */
    requiresApproval({ platform, classification }) {
        const b = this.boundaries;

        // Draft mode: siempre
        if (this.operatingMode === 'draft') return true;

        // Auto mode
        if (this.safetyLevel === 'strict') {
            return !b.autoApproveOnly.includes(classification);
        }

        if (this.safetyLevel === 'normal') {
            return b.requireApprovalFor.includes(classification);
        }

        // permissive
        return b.requireApprovalFor.includes(classification);
    }

    /**
     * ¿Estamos en horario permitido para publicar?
     * Respeta `neverPostBetween` en la timezone de la persona.
     */
    isWithinPostingHours(now = new Date()) {
        const window = this.boundaries.neverPostBetween;
        if (!window) return true;

        const [startStr, endStr] = window;
        const tz = this.identity.timezone;

        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);

        const hh = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
        const mm = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
        const nowMin = hh * 60 + mm;

        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;

        // Ventana que cruza medianoche (23:00 → 07:00)
        if (startMin > endMin) {
            return !(nowMin >= startMin || nowMin < endMin);
        }
        // Ventana normal (13:00 → 15:00)
        return !(nowMin >= startMin && nowMin < endMin);
    }

    /**
     * Combina la voz global con override de plataforma.
     */
    getEffectiveVoice(platform) {
        const override = this.platforms[platform]?.styleOverride;
        if (!override) return { ...this.voice };
        return {
            ...this.voice,
            tone: override.tone || this.voice.tone,
            formality: typeof override.formality === 'number'
                ? override.formality
                : this.voice.formality,
        };
    }
}

export const personaSchema = PersonaSchema;

export default PersonaConfig;
