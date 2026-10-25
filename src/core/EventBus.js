// src/core/EventBus.js
// Event bus tipado y minimalista con protección contra leaks.

import { getLogger } from '../utils/logger.js';

const PRIORITIES = Object.freeze({
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
});

const MAX_TYPES_TRACKED = 500;

class Subscription {
    constructor({ id, type, callback, priority, once, label }) {
        this.id = id;
        this.type = type;
        this.callback = callback;
        this.priority = PRIORITIES[priority] ?? PRIORITIES.normal;
        this.once = !!once;
        this.label = label || 'unknown';
        this.emitted = 0;
        this.errors = 0;
        this.createdAt = Date.now();
    }
}

export class EventBus {
    constructor() {
        this._subs = new Map();
        this._catchAll = [];
        this._nextId = 1;
        this._paused = false;
        this._queue = [];
        this._maxQueue = 200;

        this.metrics = {
            emitted: 0,
            delivered: 0,
            errors: 0,
            byType: new Map(),
        };
    }

    on(type, cb, opts = {}) {
        if (typeof cb !== 'function') return null;
        if (typeof type !== 'string' || type.length === 0) return null;

        const sub = new Subscription({
            id: this._nextId++,
            type,
            callback: cb,
            priority: opts.priority,
            once: opts.once,
            label: opts.label,
        });

        if (!this._subs.has(type)) this._subs.set(type, []);
        const arr = this._subs.get(type);
        arr.push(sub);
        arr.sort((a, b) => a.priority - b.priority);

        return sub.id;
    }

    once(type, cb, opts = {}) {
        return this.on(type, cb, { ...opts, once: true });
    }

    onAny(cb, opts = {}) {
        if (typeof cb !== 'function') return null;
        const sub = new Subscription({
            id: this._nextId++,
            type: '*',
            callback: cb,
            priority: opts.priority || 'low',
            once: opts.once,
            label: opts.label || 'catchAll',
        });
        this._catchAll.push(sub);
        return sub.id;
    }

    off(subId) {
        for (const arr of this._subs.values()) {
            const idx = arr.findIndex(s => s.id === subId);
            if (idx >= 0) { arr.splice(idx, 1); return true; }
        }
        const idx = this._catchAll.findIndex(s => s.id === subId);
        if (idx >= 0) { this._catchAll.splice(idx, 1); return true; }
        return false;
    }

    emit(type, data = {}) {
        if (!type) return 0;
        if (this._paused) {
            this._queue.push({ type, data });
            if (this._queue.length > this._maxQueue) this._queue.shift();
            return 0;
        }

        const t0 = Date.now();
        let delivered = 0;

        const directSubs = this._subs.get(type);
        if (directSubs && directSubs.length > 0) {
            delivered += this._notify(directSubs, type, data);
        }

        if (this._catchAll.length > 0) {
            delivered += this._notify(this._catchAll, type, data);
        }

        this.metrics.emitted++;
        this.metrics.delivered += delivered;

        if (this.metrics.byType.size < MAX_TYPES_TRACKED) {
            const entry = this.metrics.byType.get(type) || { emitted: 0, delivered: 0 };
            entry.emitted++;
            entry.delivered += delivered;
            this.metrics.byType.set(type, entry);
        }

        const elapsed = Date.now() - t0;
        if (elapsed > 50) {
            getLogger().warn({ event: type, elapsedMs: elapsed }, 'slow event');
        }

        return delivered;
    }

    _notify(subs, type, data) {
        let delivered = 0;
        const snapshot = subs.slice();
        for (const sub of snapshot) {
            try {
                sub.callback({ type, data, at: Date.now() });
                sub.emitted++;
                delivered++;
            } catch (err) {
                sub.errors++;
                this.metrics.errors++;
                getLogger().error(
                    { event: type, label: sub.label, err: err.message },
                    'event listener error'
                );
            }
            if (sub.once) this.off(sub.id);
        }
        return delivered;
    }

    pause() { this._paused = true; }

    resume(flush = true) {
        this._paused = false;
        if (flush && this._queue.length > 0) {
            const q = this._queue.slice();
            this._queue.length = 0;
            for (const e of q) this.emit(e.type, e.data);
        }
    }

    getState() {
        let totalSubs = 0;
        for (const arr of this._subs.values()) totalSubs += arr.length;
        totalSubs += this._catchAll.length;

        return {
            emitted: this.metrics.emitted,
            delivered: this.metrics.delivered,
            errors: this.metrics.errors,
            typeCount: this._subs.size,
            subscriptionCount: totalSubs,
            paused: this._paused,
            queueSize: this._queue.length,
        };
    }

    reset() {
        this._subs.clear();
        this._catchAll = [];
        this._queue = [];
        this.metrics.emitted = 0;
        this.metrics.delivered = 0;
        this.metrics.errors = 0;
        this.metrics.byType.clear();
        this._paused = false;
    }
}

export const eventBus = new EventBus();
export default eventBus;
