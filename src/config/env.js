// src/config/env.js
// Validación centralizada de variables de entorno con Zod.
// Falla rápido en el arranque si falta algo crítico.

import 'dotenv/config';
import { z } from 'zod';

const BOOL = z.union([z.boolean(), z.string()]).transform((v) => {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
});

const INT = (def, min = -Infinity, max = Infinity) =>
    z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(
        z.number().int().min(min).max(max)
    ).default(def);

const FLOAT = (def, min = -Infinity, max = Infinity) =>
    z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(
        z.number().min(min).max(max)
    ).default(def);

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: INT(3000, 1, 65535),
    HOST: z.string().default('0.0.0.0'),
    VB_AMBER_ADMIN_API_KEY: z.string().min(16),
    CORS_ORIGIN: z.string().default('*'),

    DB_PATH: z.string().default('./data/vb-amber13.db'),
    DB_WAL: BOOL.default(true),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    LOG_FORMAT: z.enum(['pretty', 'json']).default('json'),

    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'ollama']).default('openai'),
    LLM_MODEL: z.string().default('gpt-4o-mini'),
    LLM_API_KEY: z.string().default(''),
    LLM_BASE_URL: z.string().default(''),
    LLM_TIMEOUT_MS: INT(45000, 1000, 300000),
    LLM_MAX_OUTPUT_TOKENS: INT(800, 50, 8000),
    LLM_TEMPERATURE: FLOAT(0.85, 0, 2),

    TWITTER_ENABLED: BOOL.default(false),
    TWITTER_API_KEY: z.string().default(''),
    TWITTER_API_SECRET: z.string().default(''),
    TWITTER_ACCESS_TOKEN: z.string().default(''),
    TWITTER_ACCESS_SECRET: z.string().default(''),
    TWITTER_BEARER_TOKEN: z.string().default(''),
    TWITTER_USER_ID: z.string().default(''),

    INSTAGRAM_ENABLED: BOOL.default(false),
    INSTAGRAM_ACCESS_TOKEN: z.string().default(''),
    INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().default(''),
    INSTAGRAM_APP_SECRET: z.string().default(''),
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().default(''),

    LINKEDIN_ENABLED: BOOL.default(false),
    LINKEDIN_ACCESS_TOKEN: z.string().default(''),
    LINKEDIN_PERSON_URN: z.string().default(''),
    LINKEDIN_CLIENT_ID: z.string().default(''),
    LINKEDIN_CLIENT_SECRET: z.string().default(''),

    VB_AMBER_OPERATING_MODE: z.enum(['draft', 'auto']).default('draft'),
    VB_AMBER_SAFETY_LEVEL: z.enum(['strict', 'normal', 'permissive']).default('strict'),
    VB_AMBER_LOOP_INTERVAL_MS: INT(90000, 30000, 3600000),
    VB_AMBER_CRISIS_NEGATIVE_THRESHOLD: INT(3, 1, 100),
    VB_AMBER_CRISIS_WINDOW_MIN: INT(60, 5, 1440),
});

let cachedEnv = null;

export function loadEnv() {
    if (cachedEnv) return cachedEnv;

    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`);
        console.error('❌ Variables de entorno inválidas:\n' + issues.join('\n'));
        process.exit(1);
    }

    const env = parsed.data;

    // Validaciones condicionales
    if (env.LLM_PROVIDER === 'openai' && !env.LLM_API_KEY) {
        console.error('❌ LLM_PROVIDER=openai requiere LLM_API_KEY');
        process.exit(1);
    }
    if (env.LLM_PROVIDER === 'anthropic' && !env.LLM_API_KEY) {
        console.error('❌ LLM_PROVIDER=anthropic requiere LLM_API_KEY');
        process.exit(1);
    }
    if (env.TWITTER_ENABLED && (!env.TWITTER_API_KEY || !env.TWITTER_ACCESS_TOKEN)) {
        console.error('❌ TWITTER_ENABLED=true requiere API_KEY y ACCESS_TOKEN');
        process.exit(1);
    }
    if (env.INSTAGRAM_ENABLED && !env.INSTAGRAM_ACCESS_TOKEN) {
        console.error('❌ INSTAGRAM_ENABLED=true requiere INSTAGRAM_ACCESS_TOKEN');
        process.exit(1);
    }
    if (env.LINKEDIN_ENABLED && !env.LINKEDIN_ACCESS_TOKEN) {
        console.error('❌ LINKEDIN_ENABLED=true requiere LINKEDIN_ACCESS_TOKEN');
        process.exit(1);
    }
    if (env.NODE_ENV === 'production' && env.VB_AMBER_ADMIN_API_KEY.length < 32) {
        console.error('❌ En producción, VB_AMBER_ADMIN_API_KEY debe tener >= 32 chars');
        process.exit(1);
    }
    if (env.NODE_ENV === 'production' && env.CORS_ORIGIN === '*') {
        console.error('❌ En producción, CORS_ORIGIN no debe ser "*"');
        process.exit(1);
    }

    cachedEnv = env;
    return env;
}

export function getEnv() {
    return cachedEnv || loadEnv();
}

export function isProduction() {
    return getEnv().NODE_ENV === 'production';
}
