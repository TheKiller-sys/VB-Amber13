// src/social/browser/SessionEncryption.js
// Cifrado AES-256-GCM para storage_state de Playwright.
//
// Formato del payload cifrado:
//   [MAGIC 4B "VSES"] [VERSION 1B=1] [SALT 16B] [IV 12B] [TAG 16B] [CIPHERTEXT]
//
// La clave maestra viene de VB_AMBER_SESSION_ENCRYPTION_KEY.
// Se deriva una subclave por fichero con PBKDF2 (100k iter, SHA-256) usando el SALT.
// Así, aunque dos plataformas usen la misma master key, sus claves efectivas son distintas.

import {
    createCipheriv,
    createDecipheriv,
    pbkdf2Sync,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

const MAGIC = Buffer.from('VSES', 'ascii'); // 4 bytes
const VERSION = 1;                            // 1 byte
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PBKDF2_ITER = 100_000;
const PBKDF2_DIGEST = 'sha256';

export class SessionEncryption {
    /**
     * @param {string} masterKey — clave maestra (>= 32 chars).
     */
    constructor(masterKey) {
        if (typeof masterKey !== 'string' || masterKey.length < 32) {
            throw new Error(
                'SessionEncryption: masterKey debe ser string de >= 32 caracteres'
            );
        }
        this._master = Buffer.from(masterKey, 'utf8');
    }

    /**
     * Cifra un objeto (o string). Devuelve Buffer.
     * @param {Object|string} plaintext
     * @returns {Buffer}
     */
    encrypt(plaintext) {
        const data = typeof plaintext === 'string'
            ? plaintext
            : JSON.stringify(plaintext);

        const salt = randomBytes(SALT_LEN);
        const iv = randomBytes(IV_LEN);
        const key = pbkdf2Sync(this._master, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_DIGEST);

        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return Buffer.concat([
            MAGIC,
            Buffer.from([VERSION]),
            salt,
            iv,
            tag,
            ct,
        ]);
    }

    /**
     * Descifra un Buffer producido por encrypt(). Devuelve el string plano.
     * @param {Buffer} buffer
     * @returns {string}
     */
    decrypt(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('SessionEncryption.decrypt: buffer requerido');
        }

        const headerLen = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;
        if (buffer.length < headerLen) {
            throw new Error('SessionEncryption.decrypt: buffer demasiado corto');
        }

        const magic = buffer.subarray(0, MAGIC.length);
        if (!timingSafeEqual(magic, MAGIC)) {
            throw new Error('SessionEncryption.decrypt: magic inválido');
        }

        const version = buffer[MAGIC.length];
        if (version !== VERSION) {
            throw new Error(
                `SessionEncryption.decrypt: versión no soportada (${version})`
            );
        }

        let off = MAGIC.length + 1;
        const salt = buffer.subarray(off, off + SALT_LEN); off += SALT_LEN;
        const iv = buffer.subarray(off, off + IV_LEN); off += IV_LEN;
        const tag = buffer.subarray(off, off + TAG_LEN); off += TAG_LEN;
        const ct = buffer.subarray(off);

        const key = pbkdf2Sync(this._master, salt, PBKDF2_ITER, KEY_LEN, PBKDF2_DIGEST);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);

        try {
            const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
            return pt.toString('utf8');
        } catch (_) {
            throw new Error(
                'SessionEncryption.decrypt: autenticación fallida (clave incorrecta o fichero corrupto)'
            );
        }
    }
}

export default SessionEncryption;
