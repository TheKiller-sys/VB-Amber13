#!/usr/bin/env node
// scripts/login.js
// CLI helper para hacer login manual desde una máquina con display.
//
// Uso:
//   node scripts/login.js twitter
//   node scripts/login.js instagram
//   node scripts/login.js linkedin
//
// Guarda data/sessions/<platform>.enc cifrado.
// En servidores sin display, haz login localmente y copia el .enc al servidor.

import { getEnv } from '../src/config/env.js';
import { getLogger } from '../src/utils/logger.js';
import { database } from '../src/core/Database.js';
import { BrowserSessionManager } from '../src/social/browser/BrowserSessionManager.js';

const SUPPORTED = ['twitter', 'instagram', 'linkedin'];

async function main() {
    const platform = process.argv[2];

    if (!platform || !SUPPORTED.includes(platform)) {
        console.error(
            `Uso: node scripts/login.js <${SUPPORTED.join('|')}>`
        );
        process.exit(1);
    }

    const env = getEnv();
    if (env.VB_AMBER_TRANSPORT !== 'scraping') {
        console.error(
            '❌ VB_AMBER_TRANSPORT != scraping. Cambia .env para usar scraping.'
        );
        process.exit(1);
    }

    const logger = getLogger();
    database.initialize();

    const sessions = new BrowserSessionManager();
    await sessions.initialize();

    logger.info({ platform }, 'abriendo navegador para login manual');
    console.log('──────────────────────────────────────────────────────');
    console.log(`Abre la ventana del navegador que aparecerá.`);
    console.log(`Inicia sesión en ${platform} manualmente.`);
    console.log(`El sistema detectará el login automáticamente y guardará la sesión.`);
    console.log(`Timeout: ${env.VB_AMBER_SCRAPING_LOGIN_TIMEOUT_MS / 1000}s`);
    console.log('──────────────────────────────────────────────────────');

    const result = await sessions.login(platform);

    if (result.ok) {
        console.log('✅ Login OK. Sesión guardada cifrada en data/sessions/');
    } else {
        console.error('❌ Login falló:', result.error, result.detail || '');
    }

    await sessions.shutdown();
    database.close();
    process.exit(result.ok ? 0 : 1);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
