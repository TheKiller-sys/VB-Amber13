// src/http/static/app.js
// SPA vanilla del dashboard. Sin dependencias. Hash routing.

const LS_KEY = 'vb_amber_api_key';
const REFRESH_MS = 15000;
const HEALTH_MS = 5000;

const state = {
  apiKey: localStorage.getItem(LS_KEY) || '',
  route: 'overview',
  viewData: {},
  refreshing: false,
  timers: {},
  lastHealth: null,
  config: {
    transport: 'unknown',
    mode: 'unknown',
    safety: 'unknown',
  },
};

// ============================================================
// API CLIENT
// ============================================================

async function api(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (state.apiKey) headers['x-api-key'] = state.apiKey;

  const res = await fetch(path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    showApiKeyModal();
    throw new Error('auth_required');
  }

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ============================================================
// HELPERS
// ============================================================

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rel(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'justo ahora';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
  return `hace ${Math.floor(diff / 86_400_000)}d`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(s, n = 100) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
};

// ============================================================
// TOASTS
// ============================================================

function toast(message, type = 'info', timeout = 4000) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${ICONS[type] || ICONS.info}</div>
    <div class="toast-body">${esc(message)}</div>
  `;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

// ============================================================
// MODAL
// ============================================================

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function openModal(html) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop">${html}</div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
}

function showApiKeyModal() {
  openModal(`
    <div class="modal">
      <div class="modal-head">
        <div class="modal-title">API Key requerida</div>
        <div class="modal-desc">Introduce tu VB_AMBER_ADMIN_API_KEY para acceder al dashboard.</div>
      </div>
      <div class="modal-body">
        <label class="label">API Key</label>
        <input class="input" id="api-key-input" type="password" placeholder="64 caracteres hex…" autocomplete="off" value="${esc(state.apiKey)}">
        <div class="text-xs muted mt-8">Se guarda en localStorage de este navegador. Nunca se envía a terceros.</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" id="api-key-save">Guardar</button>
      </div>
    </div>
  `);
  setTimeout(() => document.getElementById('api-key-input')?.focus(), 50);
  document.getElementById('api-key-save').addEventListener('click', saveApiKey);
  document.getElementById('api-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveApiKey();
  });
}

async function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const key = input.value.trim();
  if (!key) {
    toast('La API key no puede estar vacía', 'error');
    return;
  }
  state.apiKey = key;
  localStorage.setItem(LS_KEY, key);
  closeModal();
  try {
    await api('/api/persona').catch((e) => {
      if (e.status === 404) return; // sin persona aún, ok
      throw e;
    });
    toast('API Key guardada', 'success');
    render();
  } catch (err) {
    toast('API Key inválida', 'error');
    state.apiKey = '';
    localStorage.removeItem(LS_KEY);
    showApiKeyModal();
  }
}

// Exponer al inline onclick
window.closeModal = closeModal;

// ============================================================
// HEALTH POLLING
// ============================================================

async function pollHealth() {
  try {
    const data = await fetch('/health/readyz').then(r => r.json());
    state.lastHealth = data;
    updateSidebarStatus(data);
    updateLiveIndicator(data);
  } catch (_) {
    updateSidebarStatus(null);
    updateLiveIndicator(null);
  }
}

function updateSidebarStatus(data) {
  const el = document.getElementById('sidebar-status');
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  const text = el.querySelector('.status-text');
  el.classList.remove('ok', 'err', 'warn');
  if (!data) {
    text.textContent = 'Desconectado';
    el.classList.add('err');
  } else if (data.ready) {
    text.textContent = 'Operativo';
    el.classList.add('ok');
  } else {
    text.textContent = data.db ? 'Degradado' : 'DB offline';
    el.classList.add('warn');
  }
}

function updateLiveIndicator(data) {
  const el = document.getElementById('live-indicator');
  if (!el) return;
  if (data?.ready) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

// ============================================================
// NAVIGATION
// ============================================================

const ROUTES = {
  overview: { title: 'Overview', sub: 'Estado general del agente' },
  persona: { title: 'Persona', sub: 'Configuración de identidad y voz' },
  pending: { title: 'Pending', sub: 'Acciones esperando aprobación' },
  actions: { title: 'Actions', sub: 'Historial de acciones publicadas' },
  sessions: { title: 'Sessions', sub: 'Gestión de sesiones de scraping' },
  audit: { title: 'Audit', sub: 'Log de auditoría de decisiones' },
  settings: { title: 'Settings', sub: 'Configuración del sistema' },
};

function navigate(route) {
  if (!ROUTES[route]) route = 'overview';
  state.route = route;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });

  const meta = ROUTES[route];
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-sub').textContent = meta.sub;

  stopRouteTimers();
  render();
  startRouteTimers();
}

function render() {
  const content = document.getElementById('content');
  content.innerHTML = '';
  const fn = VIEWS[state.route];
  if (fn) fn.render(content);
}

function stopRouteTimers() {
  if (state.timers.route) {
    clearInterval(state.timers.route);
    state.timers.route = null;
  }
}

function startRouteTimers() {
  const fn = VIEWS[state.route];
  if (fn && fn.refresh) {
    state.timers.route = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fn.refresh();
    }, REFRESH_MS);
  }
}

// ============================================================
// VIEW: OVERVIEW
// ============================================================

const VIEWS = {};

VIEWS.overview = {
  render(root) {
    root.innerHTML = `
      <div class="metrics-grid" id="ov-metrics">
        ${this.skeletonMetric('Uptime')}
        ${this.skeletonMetric('Ciclos')}
        ${this.skeletonMetric('Pending')}
        ${this.skeletonMetric('Acciones')}
      </div>
      <div class="card mb-16" id="ov-system">
        <div class="skeleton skeleton-line" style="width: 40%"></div>
        <div class="skeleton skeleton-line" style="width: 70%"></div>
      </div>
      <div class="card" id="ov-controls">
        <div class="card-header">
          <div>
            <div class="card-title">Control manual</div>
            <div class="card-sub">Acciones puntuales sobre el loop</div>
          </div>
        </div>
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <button class="btn btn-secondary" id="btn-tick">${ICONS.refresh} Ejecutar ciclo</button>
          <button class="btn btn-secondary" id="btn-toggle-pause">${ICONS.pause} Pausar</button>
          <button class="btn btn-danger" id="btn-resume-crisis">${ICONS.warning} Resolver crisis</button>
        </div>
      </div>
    `;
    this.load();
    this.bind(root);
  },

  skeletonMetric(label) {
    return `
      <div class="metric">
        <div class="metric-label">${label}</div>
        <div class="skeleton" style="height: 30px; width: 60%; margin-top: 8px;"></div>
      </div>
    `;
  },

  async load() {
    try {
      const [stateRes, pendingRes, actionsRes] = await Promise.all([
        api('/api/social/state').catch(() => null),
        api('/api/social/pending').catch(() => ({ pending: [] })),
        api('/api/social/actions?limit=1').catch(() => ({ actions: [] })),
      ]);

      state.viewData.overview = {
        state: stateRes?.state || null,
        pending: pendingRes.pending || [],
        actions: actionsRes.actions || [],
      };

      if (stateRes?.state) {
        state.config.transport = stateRes.state.transport || 'unknown';
        const p = stateRes.state.metrics?.draftsPublished;
        // config.mode viene de state
      }

      this.paint();
      this.updatePendingBadge(pendingRes.pending?.length || 0);
    } catch (err) {
      if (err.message !== 'auth_required') {
        toast(err.message, 'error');
      }
    }
  },

  refresh() { this.load(); },

  paint() {
    const data = state.viewData.overview || {};
    const s = data.state;
    const health = state.lastHealth;

    // Métricas
    const metrics = document.getElementById('ov-metrics');
    if (!metrics) return;

    const uptime = s?.metrics?.totalCycles != null
      ? this.fmtUptime((Date.now() - (health?.uptimeMs ? Date.now() - health.uptimeMs : Date.now())) / 1000)
      : '—';

    const pendingCount = data.pending?.length || 0;
    const totalActions = data.actions?.length || 0;

    metrics.innerHTML = `
      <div class="metric">
        <div class="metric-label">Uptime</div>
        <div class="metric-value">${health ? this.fmtUptime(Math.round(health.uptimeMs / 1000)) : '—'}</div>
        <div class="metric-hint">${health?.ready ? 'ready' : 'no ready'}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Ciclos</div>
        <div class="metric-value">${s?.metrics?.totalCycles ?? 0}</div>
        <div class="metric-hint">${s?.metrics?.failedCycles ?? 0} fallidos</div>
      </div>
      <div class="metric">
        <div class="metric-label">Pending</div>
        <div class="metric-value">${pendingCount}</div>
        <div class="metric-hint">${pendingCount > 0 ? 'requiere atención' : 'todo al día'}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Acciones</div>
        <div class="metric-value">${s?.metrics?.draftsPublished ?? 0}</div>
        <div class="metric-hint">publicadas</div>
      </div>
    `;

    // Sistema
    const sys = document.getElementById('ov-system');
    if (sys && s) {
      const crisis = s.crisis || {};
      const crisisBadge = crisis.paused
        ? `<span class="badge badge-danger">CRISIS · ${esc(crisis.pauseReason)}</span>`
        : `<span class="badge badge-success">sin crisis</span>`;

      const transportBadge = s.transport === 'scraping'
        ? `<span class="badge badge-warning">scraping</span>`
        : `<span class="badge badge-info">api</span>`;

      sys.innerHTML = `
        <div class="row-between mb-12">
          <div>
            <div class="card-title">Estado del sistema</div>
            <div class="card-sub">Loop autónomo y subsistemas</div>
          </div>
          <div class="row">
            ${crisisBadge}
            ${transportBadge}
          </div>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Loop</span><span class="v">${s.running ? 'en marcha' : 'pausado'}</span></div>
          <div class="session-row"><span class="k">Clasificador</span><span class="v">${s.classifier?.metrics?.classified ?? 0} señales</span></div>
          <div class="session-row"><span class="k">Ingester</span><span class="v">${s.ingester?.metrics?.signalsNew ?? 0} nuevas</span></div>
          <div class="session-row"><span class="k">Guard rechazos</span><span class="v">${s.metrics?.draftsRejectedByGuard ?? 0}</span></div>
        </div>
      `;
    }

    // Botón pause toggle
    const pauseBtn = document.getElementById('btn-toggle-pause');
    if (pauseBtn && s) {
      if (s.paused) {
        pauseBtn.innerHTML = `${ICONS.play} Reanudar`;
        pauseBtn.dataset.action = 'resume';
      } else {
        pauseBtn.innerHTML = `${ICONS.pause} Pausar`;
        pauseBtn.dataset.action = 'pause';
      }
    }
  },

  fmtUptime(seconds) {
    if (!seconds || seconds < 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  },

  updatePendingBadge(count) {
    const badge = document.getElementById('pending-count');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.removeAttribute('hidden');
    } else {
      badge.setAttribute('hidden', '');
    }
  },

  bind(root) {
    root.querySelector('#btn-tick')?.addEventListener('click', async () => {
      const btn = root.querySelector('#btn-tick');
      btn.disabled = true;
      try {
        await api('/api/social/tick', { method: 'POST' });
        toast('Ciclo ejecutado', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector('#btn-toggle-pause')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const action = btn.dataset.action || 'pause';
      btn.disabled = true;
      try {
        await api(`/api/social/${action}`, { method: 'POST' });
        toast(action === 'pause' ? 'Loop pausado' : 'Loop reanudado', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector('#btn-resume-crisis')?.addEventListener('click', async () => {
      try {
        await api('/api/social/crisis/resume', { method: 'POST' });
        toast('Crisis resuelta', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      }
    });
  },
};

// ============================================================
// VIEW: PERSONA
// ============================================================

VIEWS.persona = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const [current, history] = await Promise.all([
        api('/api/persona').catch((e) => {
          if (e.status === 404) return null;
          throw e;
        }),
        api('/api/persona/history?limit=10').catch(() => ({ versions: [] })),
      ]);
      this.paint(current, history);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(current, history) {
    const content = document.getElementById('content');
    const persona = current?.persona || null;
    const versions = history?.versions || [];

    if (!persona) {
      content.innerHTML = `
        <div class="alert alert-warning">
          <div class="alert-icon">${ICONS.warning}</div>
          <div class="alert-body">
            <strong>No hay PersonaConfig.</strong> Sin persona, el loop no hace nada.
            Crea una con el botón de abajo (se abrirá el editor con un template por defecto).
          </div>
        </div>
        <div class="mt-16">
          <button class="btn btn-primary" id="btn-persona-create">Crear persona</button>
        </div>
      `;
      content.querySelector('#btn-persona-create').addEventListener('click', () => {
        this.showEditor(this.defaultPersona());
      });
      return;
    }

    content.innerHTML = `
      <div class="row-between mb-16" style="flex-wrap: wrap; gap: 10px;">
        <div class="row">
          <span class="badge badge-success">v${persona.version ?? '?'}</span>
          <span class="badge badge-neutral">${esc(persona.operatingMode || 'draft')}</span>
          <span class="badge badge-neutral">${esc(persona.safetyLevel || 'strict')}</span>
        </div>
        <div class="row">
          <button class="btn btn-secondary" id="btn-persona-edit">Editar</button>
          <button class="btn btn-secondary" id="btn-persona-view-json">Ver JSON</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div>
            <div class="card-title">${esc(persona.identity?.name || 'Sin nombre')}</div>
            <div class="card-sub">${esc(persona.identity?.handle || '')} · ${esc(persona.identity?.timezone || 'UTC')}</div>
          </div>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Bio</span><span class="v">${esc(persona.identity?.bio || '—')}</span></div>
          <div class="session-row"><span class="k">Idiomas</span><span class="v">${(persona.identity?.languages || []).join(', ') || '—'}</span></div>
          <div class="session-row"><span class="k">Tono</span><span class="v">${esc(persona.voice?.tone || '—')}</span></div>
          <div class="session-row"><span class="k">Max posts/día</span><span class="v">${persona.boundaries?.maxPostsPerDay ?? '—'}</span></div>
          <div class="session-row"><span class="k">Max replies/hora</span><span class="v">${persona.boundaries?.maxRepliesPerHour ?? '—'}</span></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-title mb-12">Plataformas</div>
        <div class="stack">
          ${['twitter', 'instagram', 'linkedin'].map(p => {
            const cfg = persona.platforms?.[p] || {};
            const enabled = !!cfg.enabled;
            return `
              <div class="session-row">
                <span class="k" style="text-transform: capitalize;">${p}</span>
                <span class="badge ${enabled ? 'badge-success' : 'badge-neutral'}">${enabled ? 'enabled' : 'disabled'}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Historial de versiones</div>
            <div class="card-sub">${versions.length} versiones</div>
          </div>
        </div>
        ${versions.length === 0 ? `
          <div class="empty">
            <div class="empty-title">Sin historial</div>
            <div class="empty-desc">Las versiones aparecen al guardar cambios.</div>
          </div>
        ` : `
          <div class="stack">
            ${versions.map(v => `
              <div class="row-between" style="padding: 8px 0; border-bottom: 1px solid var(--border);">
                <div class="row">
                  <span class="badge badge-neutral">v${v.version}</span>
                  <span class="text-sm">${esc(v.payload?.identity?.name || '—')}</span>
                </div>
                <div class="text-xs muted">${rel(v.updated_at)}</div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    content.querySelector('#btn-persona-edit')?.addEventListener('click', () => {
      this.showEditor(persona);
    });
    content.querySelector('#btn-persona-view-json')?.addEventListener('click', () => {
      this.showJsonView(persona);
    });
  },

  defaultPersona() {
    return {
      identity: {
        name: 'Nueva Persona',
        handle: '@nueva',
        bio: '',
        role: 'persona',
        languages: ['es'],
        timezone: 'Europe/Madrid',
      },
      voice: {
        tone: 'cercano',
        formality: 0.5,
        humor: 0.5,
        emojiFrequency: 0.3,
        sentenceLength: 'media',
        punctuation: 'normal',
      },
      topics: { loves: [], casual: [], avoids: [], taboos: ['política partidista', 'religión'] },
      boundaries: {
        maxPostsPerDay: 3,
        maxRepliesPerHour: 5,
        neverPostBetween: ['23:00', '07:00'],
      },
      platforms: {
        twitter: { enabled: false },
        instagram: { enabled: false },
        linkedin: { enabled: false },
      },
      operatingMode: 'draft',
      safetyLevel: 'strict',
    };
  },

  showEditor(persona) {
    const json = JSON.stringify(persona, null, 2);
    openModal(`
      <div class="modal" style="max-width: 720px;">
        <div class="modal-head">
          <div class="modal-title">${persona ? 'Editar' : 'Crear'} PersonaConfig</div>
          <div class="modal-desc">Pega el JSON completo. Se valida contra el schema Zod del servidor.</div>
        </div>
        <div class="modal-body">
          <textarea class="textarea" id="persona-editor" style="min-height: 400px;">${esc(json)}</textarea>
          <div id="persona-editor-error" class="alert alert-danger mt-12 hidden">
            <div class="alert-icon">${ICONS.error}</div>
            <div class="alert-body" id="persona-editor-error-msg"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="persona-save">Guardar</button>
        </div>
      </div>
    `);

    document.getElementById('persona-save').addEventListener('click', async () => {
      const ta = document.getElementById('persona-editor');
      const errBox = document.getElementById('persona-editor-error');
      const errMsg = document.getElementById('persona-editor-error-msg');

      let payload;
      try {
        payload = JSON.parse(ta.value);
      } catch (e) {
        errMsg.textContent = `JSON inválido: ${e.message}`;
        errBox.classList.remove('hidden');
        return;
      }

      try {
        await api('/api/persona', {
          method: persona ? 'PUT' : 'POST',
          body: payload,
        });
        toast(persona ? 'Persona actualizada' : 'Persona creada', 'success');
        closeModal();
        this.load();
      } catch (err) {
        if (err.status === 400 && err.data?.details) {
          const issues = err.data.details
            .map(i => `${i.path?.join('.') || '?'}: ${i.message}`)
            .join('\n');
          errMsg.textContent = issues;
          errBox.classList.remove('hidden');
        } else if (err.message !== 'auth_required') {
          errMsg.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      }
    });
  },

  showJsonView(persona) {
    openModal(`
      <div class="modal" style="max-width: 720px;">
        <div class="modal-head">
          <div class="modal-title">PersonaConfig</div>
          <div class="modal-desc">Versión ${persona.version ?? '?'} · solo lectura</div>
        </div>
        <div class="modal-body">
          <pre class="textarea" style="min-height: 400px; white-space: pre; overflow: auto;">${esc(JSON.stringify(persona, null, 2))}</pre>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    `);
  },
};

// ============================================================
// VIEW: PENDING
// ============================================================

VIEWS.pending = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/social/pending');
      this.paint(data.pending || []);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(items) {
    const content = document.getElementById('content');
    const badge = document.getElementById('pending-count');
    if (badge) {
      if (items.length > 0) { badge.textContent = items.length; badge.removeAttribute('hidden'); }
      else badge.setAttribute('hidden', '');
    }

    if (items.length === 0) {
      content.innerHTML = `
        <div class="empty" style="padding-top: 80px;">
          <div class="empty-icon">${ICONS.clock}</div>
          <div class="empty-title">Todo al día</div>
          <div class="empty-desc">No hay acciones esperando aprobación. Cuando el agente genere un draft que requiera tu revisión, aparecerá aquí.</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="row-between mb-16">
        <div class="text-sm muted">${items.length} acción${items.length === 1 ? '' : 'es'} esperando</div>
      </div>
      <div class="pending-list">
        ${items.map(p => this.renderCard(p)).join('')}
      </div>
    `;

    content.querySelectorAll('[data-action="approve"]').forEach(btn => {
      btn.addEventListener('click', () => this.approve(btn.dataset.id, btn));
    });
    content.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', () => this.reject(btn.dataset.id, btn));
    });
  },

  renderCard(p) {
    const expired = p.expires_at && p.expires_at < Date.now();
    const reasonBadge = p.reason === 'requires_approval'
      ? '<span class="badge badge-warning">requiere aprobación</span>'
      : p.reason === 'guard_escalate'
      ? '<span class="badge badge-danger">guard: escalado</span>'
      : p.reason === 'escalate_rule'
      ? '<span class="badge badge-danger">regla custom</span>'
      : `<span class="badge badge-neutral">${esc(p.reason || '—')}</span>`;

    const signal = p.signal_payload;
    const signalBlock = signal ? `
      <div class="pending-signal">
        ${signal.author ? `<strong>@${esc(signal.author)}</strong> · ` : ''}
        ${signal.kind ? `<span class="badge badge-neutral" style="margin-right: 6px;">${esc(signal.kind)}</span>` : ''}
        ${signal.text ? `«${esc(truncate(signal.text, 200))}»` : '<em class="muted">sin texto</em>'}
      </div>
    ` : '';

    return `
      <div class="pending-card">
        <div class="pending-header">
          <div class="pending-meta">
            <span class="badge badge-info">${esc(p.platform)}</span>
            <span class="badge badge-neutral">${esc(p.action)}</span>
            ${reasonBadge}
            ${p.classification ? `<span class="badge badge-neutral">${esc(p.classification)}</span>` : ''}
            ${expired ? '<span class="badge badge-danger">expirado</span>' : ''}
          </div>
          <div class="text-xs muted">${rel(p.created_at)}</div>
        </div>
        <div class="pending-body">
          ${p.draft ? `<div class="pending-draft">${esc(p.draft)}</div>` : '<div class="pending-draft" style="opacity: 0.5;">(sin draft — solo escalado)</div>'}
          ${signalBlock}
          ${p.errors?.length ? `
            <div class="alert alert-warning mb-12">
              <div class="alert-icon">${ICONS.warning}</div>
              <div class="alert-body text-xs">
                ${p.errors.map(e => `• ${esc(e.code)}: ${esc(e.detail || '')}`).join('<br>')}
              </div>
            </div>
          ` : ''}
          <div class="pending-actions">
            <button class="btn btn-success btn-sm" data-action="approve" data-id="${esc(p.id)}">${ICONS.check} Aprobar y publicar</button>
            <button class="btn btn-danger btn-sm" data-action="reject" data-id="${esc(p.id)}">${ICONS.error} Rechazar</button>
          </div>
        </div>
      </div>
    `;
  },

  async approve(id, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await api(`/api/social/pending/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: { approvedBy: 'dashboard' },
      });
      toast('Aprobado y publicado', 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') {
        toast(err.message || 'Error al aprobar', 'error');
      }
      btn.disabled = false;
    }
  },

  async reject(id, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await api(`/api/social/pending/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: { rejectedBy: 'dashboard', reason: 'rechazado desde dashboard' },
      });
      toast('Rechazado', 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') {
        toast(err.message || 'Error al rechazar', 'error');
      }
      btn.disabled = false;
    }
  },
};

// ============================================================
// VIEW: ACTIONS
// ============================================================

VIEWS.actions = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/social/actions?limit=100');
      this.paint(data.actions || []);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(actions) {
    const content = document.getElementById('content');
    if (actions.length === 0) {
      content.innerHTML = `
        <div class="empty" style="padding-top: 80px;">
          <div class="empty-icon">${ICONS.success}</div>
          <div class="empty-title">Sin acciones publicadas</div>
          <div class="empty-desc">Cuando se apruebe y publique la primera acción, aparecerá aquí.</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Plataforma</th>
              <th>Acción</th>
              <th>Texto</th>
              <th>Aprobado por</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${actions.map(a => `
              <tr>
                <td class="cell-muted cell-mono">${fmtDate(a.published_at)}</td>
                <td><span class="badge badge-info">${esc(a.platform)}</span></td>
                <td class="cell-mono text-xs">${esc(a.action)}</td>
                <td class="cell-truncate">${esc(truncate(a.text, 120))}</td>
                <td class="cell-muted text-xs">${esc(a.approved_by || '—')}</td>
                <td>${a.external_url ? `<a href="${esc(a.external_url)}" target="_blank" rel="noopener" class="text-xs" style="color: var(--accent-hi);">Ver →</a>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
};

// ============================================================
// VIEW: SESSIONS
// ============================================================

VIEWS.sessions = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/sessions').catch((e) => {
        if (e.status === 503) return { state: null };
        throw e;
      });

      if (!data.state) {
        this.paintNoScraping();
        return;
      }
      this.paint(data.state);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paintNoScraping() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="alert alert-info mb-16">
        <div class="alert-icon">${ICONS.info}</div>
        <div class="alert-body">
          <strong>Transport actual: API oficial.</strong>
          Las sesiones de scraping no están disponibles porque <span class="inline-code">VB_AMBER_TRANSPORT != scraping</span>.
          Para usar scraping, cambia a <span class="inline-code">scraping</span> en el dashboard de Render y redeploy.
        </div>
      </div>
    `;
  },

  paint(s) {
    const content = document.getElementById('content');
    const platforms = s.platforms || {};

    const cards = Object.entries(platforms).map(([name, info]) => {
      const has = info.hasSession;
      const challenge = info.challenge?.active;
      const challengePct = challenge ? Math.round((info.challenge.remainingMs || 0) / 1000) : 0;

      return `
        <div class="session-card">
          <div class="session-head">
            <div class="session-platform">
              <div class="session-platform-icon">${ICONS.key}</div>
              <span style="text-transform: capitalize;">${esc(name)}</span>
            </div>
            ${has
              ? (challenge ? `<span class="badge badge-danger">challenge</span>` : `<span class="badge badge-success">activa</span>`)
              : `<span class="badge badge-neutral">sin sesión</span>`}
          </div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Sesión</span><span class="v">${has ? 'guardada' : '—'}</span></div>
            <div class="session-row"><span class="k">Healthcheck</span><span class="v">${info.lastHealthCheck ? rel(info.lastHealthCheck) : 'nunca'}</span></div>
            ${challenge ? `<div class="session-row"><span class="k">Cooldown</span><span class="v">${challengePct}s restantes</span></div>` : ''}
            ${info.loginJob ? `<div class="session-row"><span class="k">Login</span><span class="v">${esc(info.loginJob.status)}</span></div>` : ''}
          </div>
          <div class="session-actions">
            ${!has ? `<button class="btn btn-primary btn-sm" data-action="login" data-platform="${esc(name)}">${ICONS.key} Hacer login</button>` : ''}
            ${has ? `<button class="btn btn-secondary btn-sm" data-action="healthcheck" data-platform="${esc(name)}">${ICONS.refresh} Revalidar</button>` : ''}
            ${challenge ? `<button class="btn btn-warning btn-sm" data-action="clear-challenge" data-platform="${esc(name)}">Limpiar challenge</button>` : ''}
            ${has ? `<button class="btn btn-danger btn-sm" data-action="invalidate" data-platform="${esc(name)}">${ICONS.trash} Invalidar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="alert alert-info mb-16">
        <div class="alert-icon">${ICONS.info}</div>
        <div class="alert-body">
          El login abre una ventana de Chromium <strong>en el servidor</strong>. En Render free tier no hay display y no funcionará.
          Haz login en tu máquina con <span class="inline-code">npm run login &lt;platform&gt;</span> y copia el archivo <span class="inline-code">data/sessions/&lt;platform&gt;.enc</span> al servidor.
        </div>
      </div>
      <div class="sessions-grid">${cards}</div>
    `;

    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const platform = btn.dataset.platform;
        if (action === 'login') return this.startLogin(platform, btn);
        if (action === 'healthcheck') return this.healthcheck(platform, btn);
        if (action === 'invalidate') return this.invalidate(platform, btn);
        if (action === 'clear-challenge') return this.clearChallenge(platform, btn);
      });
    });
  },

  async startLogin(platform, btn) {
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}/login`, { method: 'POST' });
      toast(`Login iniciado en ${platform}`, 'info', 6000);
      // Poll
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const data = await api(`/api/sessions/${platform}/login`);
          if (data.job && data.job.status !== 'running') {
            clearInterval(poll);
            if (data.job.status === 'completed') {
              toast(`Login de ${platform} OK`, 'success');
            } else {
              toast(`Login de ${platform} falló: ${data.job.result?.error || 'error'}`, 'error', 8000);
            }
            this.load();
          }
        } catch (_) {
          clearInterval(poll);
        }
        if (tries > 90) clearInterval(poll);
      }, 2000);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
      btn.disabled = false;
    }
  },

  async healthcheck(platform, btn) {
    btn.disabled = true;
    try {
      const r = await api(`/api/sessions/${platform}/healthcheck`, { method: 'POST' });
      if (r.ok) toast(`${platform}: sesión válida`, 'success');
      else toast(`${platform}: ${r.reason || 'falló'}`, 'error');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
      btn.disabled = false;
    }
  },

  async invalidate(platform, btn) {
    if (!confirm(`¿Invalidar la sesión de ${platform}? Tendrás que volver a hacer login.`)) return;
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}`, { method: 'DELETE' });
      toast(`Sesión de ${platform} invalidada`, 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
      btn.disabled = false;
    }
  },

  async clearChallenge(platform, btn) {
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}/clear-challenge`, { method: 'POST' });
      toast('Challenge limpiado', 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
      btn.disabled = false;
    }
  },
};

// ============================================================
// VIEW: AUDIT
// ============================================================

VIEWS.audit = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/social/audit?limit=100');
      this.paint(data.audit || []);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(items) {
    const content = document.getElementById('content');
    if (items.length === 0) {
      content.innerHTML = `
        <div class="empty" style="padding-top: 80px;">
          <div class="empty-icon">${ICONS.info}</div>
          <div class="empty-title">Sin eventos</div>
          <div class="empty-desc">El audit log registra cada decisión del sistema.</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Categoría</th>
              <th>Evento</th>
              <th>Severidad</th>
              <th>Detalles</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(a => {
              const sevClass = a.severity === 'error' ? 'badge-danger'
                : a.severity === 'warn' ? 'badge-warning'
                : a.severity === 'info' ? 'badge-info'
                : 'badge-neutral';
              const detailText = a.details
                ? `<details><summary class="text-xs muted" style="cursor: pointer;">ver</summary><pre class="mono text-xs mt-4" style="background: var(--bg-1); padding: 8px; border-radius: 6px; max-width: 400px; overflow: auto;">${esc(JSON.stringify(a.details, null, 2))}</pre></details>`
                : '—';
              return `
                <tr>
                  <td class="cell-muted cell-mono">${fmtDate(a.timestamp)}</td>
                  <td class="cell-mono text-xs">${esc(a.category)}</td>
                  <td class="text-sm">${esc(a.event)}</td>
                  <td><span class="badge ${sevClass}">${esc(a.severity)}</span></td>
                  <td>${detailText}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
};

// ============================================================
// VIEW: SETTINGS
// ============================================================

VIEWS.settings = {
  render(root) {
    root.innerHTML = `
      <div class="card mb-16">
        <div class="card-header">
          <div>
            <div class="card-title">API Key</div>
            <div class="card-sub">Se guarda en localStorage de este navegador</div>
          </div>
        </div>
        <div class="stack">
          <div>
            <label class="label">VB_AMBER_ADMIN_API_KEY</label>
            <input class="input" id="settings-api-key" type="password" value="${esc(state.apiKey)}" autocomplete="off">
          </div>
          <div class="row">
            <button class="btn btn-primary" id="settings-save-key">Guardar key</button>
            <button class="btn btn-secondary" id="settings-clear-key">Borrar key</button>
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div>
            <div class="card-title">Sistema</div>
            <div class="card-sub">Configuración de solo lectura</div>
          </div>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Transport</span><span class="v">${esc(state.config.transport)}</span></div>
          <div class="session-row"><span class="k">NODE_ENV</span><span class="v">${esc(state.lastHealth?.env || '—')}</span></div>
          <div class="session-row"><span class="k">Modo operativo</span><span class="v">${esc(state.config.mode)}</span></div>
          <div class="session-row"><span class="k">Safety level</span><span class="v">${esc(state.config.safety)}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Endpoints</div>
            <div class="card-sub">Todos requieren x-api-key</div>
          </div>
        </div>
        <div class="stack text-xs mono">
          <div><span class="badge badge-info">GET</span> /health</div>
          <div><span class="badge badge-info">GET</span> /health/readyz</div>
          <div><span class="badge badge-info">GET</span> /api/persona</div>
          <div><span class="badge badge-info">GET</span> /api/social/state</div>
          <div><span class="badge badge-info">GET</span> /api/social/pending</div>
          <div><span class="badge badge-info">GET</span> /api/social/actions</div>
          <div><span class="badge badge-info">GET</span> /api/social/audit</div>
          <div><span class="badge badge-info">GET</span> /api/sessions</div>
        </div>
      </div>
    `;

    root.querySelector('#settings-save-key').addEventListener('click', async () => {
      const key = document.getElementById('settings-api-key').value.trim();
      if (!key) return;
      state.apiKey = key;
      localStorage.setItem(LS_KEY, key);
      try {
        await api('/api/persona').catch((e) => { if (e.status !== 404) throw e; });
        toast('API Key guardada', 'success');
      } catch (err) {
        toast('API Key inválida', 'error');
      }
    });

    root.querySelector('#settings-clear-key').addEventListener('click', () => {
      state.apiKey = '';
      localStorage.removeItem(LS_KEY);
      document.getElementById('settings-api-key').value = '';
      toast('API Key borrada', 'success');
      showApiKeyModal();
    });
  },
};

// ============================================================
// BOOT
// ============================================================

function setupRouter() {
  window.addEventListener('hashchange', () => {
    const route = location.hash.replace(/^#\//, '') || 'overview';
    navigate(route);
  });
}

function setupGlobalListeners() {
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh');
    btn.classList.add('spinning');
    try {
      await pollHealth();
      const fn = VIEWS[state.route];
      if (fn && fn.refresh) await fn.refresh();
      else render();
    } finally {
      setTimeout(() => btn.classList.remove('spinning'), 400);
    }
  });
}

async function boot() {
  setupRouter();
  setupGlobalListeners();

  if (!state.apiKey) {
    showApiKeyModal();
    updateSidebarStatus(null);
  } else {
    try {
      await api('/api/persona').catch((e) => { if (e.status !== 404) throw e; });
    } catch (err) {
      // Key inválida, ya se mostró modal
    }
  }

  await pollHealth();
  setInterval(pollHealth, HEALTH_MS);

  const initial = location.hash.replace(/^#\//, '') || 'overview';
  navigate(initial);
}

boot();
