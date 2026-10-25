// src/core/Database.js
// SQLite con better-sqlite3 (síncrono, rápido, zero-deps).
// Schema mínimo: persona_config, social_actions, social_pending,
// social_signals, audit_log.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { TUNING } from '../config/tuning.js';

const MIGRATIONS = [
    {
        version: 1,
        name: 'initial_schema',
        up(db) {
            db.exec(`
                -- ============================================================
                -- CONFIGURACIÓN DE PERSONA (versionada)
                -- ============================================================
                CREATE TABLE IF NOT EXISTS persona_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_persona_updated
                    ON persona_config(updated_at DESC);

                -- ============================================================
                -- ACCIONES SOCIALES (aprobadas y publicadas)
                -- ============================================================
                CREATE TABLE IF NOT EXISTS social_actions (
                    id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    action TEXT NOT NULL,
                    text TEXT NOT NULL,
                    signal_id TEXT,
                    signal_kind TEXT,
                    signal_author TEXT,
                    approved_by TEXT,
                    published_at INTEGER NOT NULL,
                    external_id TEXT,
                    external_url TEXT,
                    raw_response TEXT,
                    metrics TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_actions_platform
                    ON social_actions(platform, published_at DESC);
                CREATE INDEX IF NOT EXISTS idx_actions_published
                    ON social_actions(published_at DESC);

                -- ============================================================
                -- ACCIONES PENDIENTES DE APROBACIÓN
                -- ============================================================
                CREATE TABLE IF NOT EXISTS social_pending (
                    id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    action TEXT NOT NULL,
                    draft TEXT NOT NULL,
                    reason TEXT,
                    classification TEXT,
                    signal_payload TEXT,
                    persona_version INTEGER,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    resolved_at INTEGER,
                    resolved_by TEXT,
                    reject_reason TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_pending_status
                    ON social_pending(status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_pending_expires
                    ON social_pending(expires_at);

                -- ============================================================
                -- SEÑALES INGERIDAS (para dedup)
                -- ============================================================
                CREATE TABLE IF NOT EXISTS social_signals (
                    id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    author TEXT,
                    text TEXT,
                    classification TEXT,
                    received_at INTEGER NOT NULL,
                    processed_at INTEGER,
                    decision TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_signals_received
                    ON social_signals(received_at DESC);
                CREATE INDEX IF NOT EXISTS idx_signals_platform
                    ON social_signals(platform, received_at DESC);

                -- ============================================================
                -- AUDIT LOG (todas las decisiones)
                -- ============================================================
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    event TEXT NOT NULL,
                    severity TEXT NOT NULL DEFAULT 'info',
                    details TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_audit_ts
                    ON audit_log(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_category
                    ON audit_log(category, timestamp DESC);

                -- ============================================================
                -- CRISIS EVENTS (historial de pausas)
                -- ============================================================
                CREATE TABLE IF NOT EXISTS crisis_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    detected_at INTEGER NOT NULL,
                    reason TEXT NOT NULL,
                    signal_ids TEXT,
                    paused_until INTEGER,
                    resumed_at INTEGER,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_crisis_detected
                    ON crisis_events(detected_at DESC);

                -- ============================================================
                -- SCHEMA VERSION
                -- ============================================================
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    applied_at INTEGER NOT NULL
                );
            `);
        },
    },
];

export class DatabaseManager {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this._statements = new Map();
        this.metrics = {
            queries: 0,
            errors: 0,
        };
    }

    initialize() {
        if (this.isInitialized) return true;

        const env = getEnv();
        const dbPath = path.resolve(env.DB_PATH);
        const dbDir = path.dirname(dbPath);

        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            getLogger().info({ dir: dbDir }, 'created db directory');
        }

        try {
            this.db = new Database(dbPath, {
                verbose: null,
            });

            this.db.pragma(`journal_mode = ${env.DB_WAL ? 'WAL' : 'DELETE'}`);
            this.db.pragma('synchronous = NORMAL');
            this.db.pragma(`cache_size = -${TUNING.DB_CACHE_KB}`);
            this.db.pragma(`busy_timeout = ${TUNING.DB_BUSY_TIMEOUT_MS}`);
            this.db.pragma('foreign_keys = ON');
            this.db.pragma('temp_store = MEMORY');

            this._runMigrations();

            this.isInitialized = true;
            getLogger().info({ path: dbPath }, 'database initialized');
            return true;
        } catch (err) {
            getLogger().error({ err: err.message }, 'database init failed');
            return false;
        }
    }

    _runMigrations() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at INTEGER NOT NULL
            )
        `);

        const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
        const currentVersion = row?.v ?? 0;

        for (const m of MIGRATIONS) {
            if (m.version <= currentVersion) continue;
            const t0 = Date.now();
            this.db.transaction(() => {
                m.up(this.db);
                this.db.prepare(
                    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)'
                ).run(m.version, m.name, Date.now());
            })();
            getLogger().info(
                { version: m.version, name: m.name, ms: Date.now() - t0 },
                'migration applied'
            );
        }
    }

    _stmt(sql) {
        let s = this._statements.get(sql);
        if (!s) {
            s = this.db.prepare(sql);
            this._statements.set(sql, s);
        }
        return s;
    }

    // ---------- PERSONA ----------

    savePersona(payload) {
        this._ensureInit();
        const now = Date.now();
        const prev = this._stmt(
            'SELECT MAX(version) AS v FROM persona_config'
        ).get();
        const version = (prev?.v ?? 0) + 1;

        this._stmt(
            'INSERT INTO persona_config (version, payload, updated_at, created_at) VALUES (?, ?, ?, ?)'
        ).run(version, JSON.stringify(payload), now, now);

        return { version, updated_at: now };
    }

    getLatestPersona() {
        this._ensureInit();
        const row = this._stmt(
            'SELECT version, payload, updated_at FROM persona_config ORDER BY id DESC LIMIT 1'
        ).get();
        if (!row) return null;
        return {
            version: row.version,
            payload: JSON.parse(row.payload),
            updated_at: row.updated_at,
        };
    }

    // ---------- ACTIONS ----------

    saveAction(action) {
        this._ensureInit();
        this._stmt(`
            INSERT OR REPLACE INTO social_actions
                (id, platform, action, text, signal_id, signal_kind, signal_author,
                 approved_by, published_at, external_id, external_url, raw_response,
                 metrics, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            action.id,
            action.platform,
            action.action,
            action.text,
            action.signal_id || null,
            action.signal_kind || null,
            action.signal_author || null,
            action.approved_by || null,
            action.published_at,
            action.external_id || null,
            action.external_url || null,
            action.raw_response ? JSON.stringify(action.raw_response) : null,
            action.metrics ? JSON.stringify(action.metrics) : null,
            Date.now()
        );
        return action.id;
    }

    listRecentActions({ platform = null, limit = 50 } = {}) {
        this._ensureInit();
        let sql = 'SELECT * FROM social_actions';
        const params = [];
        if (platform) {
            sql += ' WHERE platform = ?';
            params.push(platform);
        }
        sql += ' ORDER BY published_at DESC LIMIT ?';
        params.push(Math.min(limit, 500));

        return this._stmt(sql).all(...params).map(row => ({
            ...row,
            raw_response: row.raw_response ? JSON.parse(row.raw_response) : null,
            metrics: row.metrics ? JSON.parse(row.metrics) : null,
        }));
    }

    countActionsToday(platform = null) {
        this._ensureInit();
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const t0 = start.getTime();

        if (platform) {
            const row = this._stmt(
                'SELECT COUNT(*) AS c FROM social_actions WHERE platform = ? AND published_at >= ?'
            ).get(platform, t0);
            return row?.c ?? 0;
        }
        const row = this._stmt(
            'SELECT COUNT(*) AS c FROM social_actions WHERE published_at >= ?'
        ).get(t0);
        return row?.c ?? 0;
    }

    countActionsInWindow(platform, windowMs) {
        this._ensureInit();
        const since = Date.now() - windowMs;
        const row = this._stmt(
            'SELECT COUNT(*) AS c FROM social_actions WHERE platform = ? AND published_at >= ?'
        ).get(platform, since);
        return row?.c ?? 0;
    }

    // ---------- PENDING ----------

    savePending(pending) {
        this._ensureInit();
        this._stmt(`
            INSERT OR REPLACE INTO social_pending
                (id, platform, action, draft, reason, classification, signal_payload,
                 persona_version, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            pending.id,
            pending.platform,
            pending.action,
            pending.draft,
            pending.reason || null,
            pending.classification || null,
            pending.signal_payload ? JSON.stringify(pending.signal_payload) : null,
            pending.persona_version || null,
            pending.status || 'pending',
            pending.created_at,
            pending.expires_at
        );
        return pending.id;
    }

    getPending(id) {
        this._ensureInit();
        const row = this._stmt('SELECT * FROM social_pending WHERE id = ?').get(id);
        return row ? this._mapPending(row) : null;
    }

    listPending() {
        this._ensureInit();
        return this._stmt(
            'SELECT * FROM social_pending WHERE status = ? ORDER BY created_at DESC'
        ).all('pending').map(row => this._mapPending(row));
    }

    resolvePending(id, status, resolvedBy, rejectReason = null) {
        this._ensureInit();
        this._stmt(`
            UPDATE social_pending
            SET status = ?, resolved_at = ?, resolved_by = ?, reject_reason = ?
            WHERE id = ?
        `).run(status, Date.now(), resolvedBy, rejectReason, id);
    }

    cleanupExpiredPending() {
        this._ensureInit();
        const now = Date.now();
        const result = this._stmt(`
            UPDATE social_pending
            SET status = 'expired', resolved_at = ?
            WHERE status = 'pending' AND expires_at < ?
        `).run(now, now);
        return result.changes;
    }

    _mapPending(row) {
        return {
            ...row,
            signal_payload: row.signal_payload ? JSON.parse(row.signal_payload) : null,
        };
    }

    // ---------- SIGNALS ----------

    wasSignalSeen(signalId) {
        this._ensureInit();
        const row = this._stmt('SELECT 1 FROM social_signals WHERE id = ?').get(signalId);
        return !!row;
    }

    recordSignal(signal) {
        this._ensureInit();
        this._stmt(`
            INSERT OR IGNORE INTO social_signals
                (id, platform, kind, author, text, classification, received_at,
                 processed_at, decision, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            signal.id,
            signal.platform,
            signal.kind,
            signal.author || null,
            signal.text || null,
            signal.classification || null,
            signal.receivedAt || Date.now(),
            signal.processedAt || null,
            signal.decision || null,
            Date.now()
        );
    }

    markSignalProcessed(signalId, decision) {
        this._ensureInit();
        this._stmt(
            'UPDATE social_signals SET processed_at = ?, decision = ? WHERE id = ?'
        ).run(Date.now(), decision, signalId);
    }

    // ---------- SIGNALS (listado + reset) — admin ----------

    listSignals({ limit = 100, platform = null, decision = null, kind = null } = {}) {
        this._ensureInit();
        let sql = 'SELECT * FROM social_signals';
        const where = [];
        const params = [];
        if (platform) { where.push('platform = ?'); params.push(platform); }
        if (decision) { where.push('decision = ?'); params.push(decision); }
        if (kind) { where.push('kind = ?'); params.push(kind); }
        if (where.length) sql += ' WHERE ' + where.join(' AND ');
        sql += ' ORDER BY received_at DESC LIMIT ?';
        params.push(Math.min(limit, 500));
        return this._stmt(sql).all(...params);
    }

    getSignal(id) {
        this._ensureInit();
        return this._stmt('SELECT * FROM social_signals WHERE id = ?').get(id) || null;
    }

    countSignalsByDecision() {
        this._ensureInit();
        const rows = this._stmt(
            'SELECT decision, COUNT(*) as c FROM social_signals GROUP BY decision'
        ).all();
        const out = {};
        for (const row of rows) {
            out[row.decision || 'pending'] = row.c;
        }
        return out;
    }

    resetSignalProcessing(id) {
        this._ensureInit();
        const result = this._stmt(
            'UPDATE social_signals SET processed_at = NULL, decision = NULL WHERE id = ?'
        ).run(id);
        return result.changes > 0;
    }

    // ---------- CRISIS (listado) — admin ----------

    listCrisis({ limit = 50 } = {}) {
        this._ensureInit();
        return this._stmt(
            'SELECT * FROM crisis_events ORDER BY detected_at DESC LIMIT ?'
        ).all(Math.min(limit, 200)).map(row => ({
            ...row,
            signal_ids: row.signal_ids ? JSON.parse(row.signal_ids) : null,
        }));
    }

    // ---------- PENDING (delete duro para admin) ----------

    deletePending(id) {
        this._ensureInit();
        const result = this._stmt('DELETE FROM social_pending WHERE id = ?').run(id);
        return result.changes > 0;
    }

    // ---------- AUDIT ----------

    audit({ category, event, severity = 'info', details = null }) {
        this._ensureInit();
        this._stmt(`
            INSERT INTO audit_log (timestamp, category, event, severity, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            Date.now(),
            category,
            event,
            severity,
            details ? JSON.stringify(details) : null,
            Date.now()
        );
    }

    listAudit({ category = null, limit = 100 } = {}) {
        this._ensureInit();
        let sql = 'SELECT * FROM audit_log';
        const params = [];
        if (category) {
            sql += ' WHERE category = ?';
            params.push(category);
        }
        sql += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(Math.min(limit, 1000));
        return this._stmt(sql).all(...params).map(row => ({
            ...row,
            details: row.details ? JSON.parse(row.details) : null,
        }));
    }

    // ---------- CRISIS ----------

    recordCrisis({ reason, signalIds, pausedUntil }) {
        this._ensureInit();
        this._stmt(`
            INSERT INTO crisis_events (detected_at, reason, signal_ids, paused_until, created_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            Date.now(),
            reason,
            JSON.stringify(signalIds || []),
            pausedUntil,
            Date.now()
        );
    }

    resolveCrisis(resumedAt = Date.now()) {
        this._ensureInit();
        this._stmt(
            'UPDATE crisis_events SET resumed_at = ? WHERE resumed_at IS NULL'
        ).run(resumedAt);
    }

    // ---------- MISC ----------

    _ensureInit() {
        if (!this.isInitialized) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
    }

    getStats() {
        this._ensureInit();
        const count = (t) => {
            try {
                return this._stmt(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c ?? 0;
            } catch (_) { return 0; }
        };
        return {
            actions: count('social_actions'),
            pending: count('social_pending'),
            signals: count('social_signals'),
            audit: count('audit_log'),
            crisis: count('crisis_events'),
            queries: this.metrics.queries,
            errors: this.metrics.errors,
        };
    }

    close() {
        if (this.db) {
            try { this.db.close(); } catch (_) {}
            this.db = null;
            this.isInitialized = false;
            this._statements.clear();
        }
    }
}

export const database = new DatabaseManager();
export default database;
