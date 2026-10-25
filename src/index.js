// src/index.js
// Entry point: wiring → SystemCore → HTTP → loop → señales.

import { getEnv } from './config/env.js';
import { getLogger } from './utils/logger.js';
import { systemCore } from './core/SystemCore.js';
import { wire } from './wiring.js';
import { createApp, startServer } from './http/index.js';

const VERSION = '0.2.0';

async function main() {
    const env = getEnv();               // valida y falla rápido si falta algo
    const logger = getLogger();

    logger.info(
        { version: VERSION, env: env.NODE_ENV, transport: env.VB_AMBER_TRANSPORT },
        'starting vb-amber13'
    );

    let httpServer = null;
    let shuttingDown = false;

    const shutdown = async (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, 'shutdown requested');

        const timeout = setTimeout(() => {
            logger.fatal('shutdown timeout — exiting hard');
            process.exit(1);
        }, 20_000);
        if (timeout.unref) timeout.unref();

        try {
            if (httpServer) {
                await new Promise((resolve) => httpServer.close(resolve));
                logger.info('http server closed');
            }
            await systemCore.shutdown(signal);
        } catch (err) {
            logger.error({ err: err.message }, 'shutdown error');
        } finally {
            clearTimeout(timeout);
            logger.info('bye');
            process.exit(0);
        }
    };

    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
        logger.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
        shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
        logger.error(
            { reason: reason instanceof Error ? reason.message : String(reason) },
            'unhandled rejection'
        );
    });

    try {
        // 1. Construir y registrar
        const services = await wire();

        // 2. Inicializar todo (DB + módulos en orden)
        await systemCore.initialize();

        // 3. Aviso si scraping y no hay sesiones
        if (env.VB_AMBER_TRANSPORT === 'scraping') {
            const sessionsState = services.sessions?.getState?.();
            if (sessionsState) {
                const withSession = Object.entries(sessionsState.platforms)
                    .filter(([, s]) => s.hasSession)
                    .map(([p]) => p);
                if (withSession.length === 0) {
                    logger.warn(
                        '⚠️  Scraping activo pero no hay sesiones guardadas. ' +
                        'Usa POST /api/sessions/:platform/login o `npm run login <platform>`.'
                    );
                } else {
                    logger.info(
                        { platforms: withSession },
                        'scraping sessions disponibles'
                    );
                }
            }
        }

        // 4. HTTP
        const app = createApp({
            personaRepo: services.personaRepo,
            loop: services.loop,
            adapterManager: services.adapterManager,
            sessions: services.sessions,
        });
        httpServer = await startServer(app, { port: env.PORT, host: env.HOST });

        // 5. Loop autónomo
        systemCore.start();

        logger.info(
            {
                port: env.PORT,
                mode: env.VB_AMBER_OPERATING_MODE,
                safety: env.VB_AMBER_SAFETY_LEVEL,
                transport: env.VB_AMBER_TRANSPORT,
            },
            '✅ vb-amber13 ready'
        );
    } catch (err) {
        logger.fatal({ err: err.message, stack: err.stack }, 'startup failed');
        process.exit(1);
    }
}

main();
