// src/http/static/app.js
// SPA vanilla del dashboard. Sin dependencias externas. Hash routing.
// Incluye editor visual completo de PersonaConfig (todas las secciones).

const LS_KEY = 'vb_amber_api_key';
const REFRESH_MS = 15000;
const HEALTH_MS = 5000;

// ============================================================
// STATE
// ============================================================

const state = {
  apiKey: localStorage.getItem(LS_KEY) || '',
  route: 'overview',
  viewData: {},
  timers: { health: null, route: null },
  lastHealth: null,
  lastHealthAt: 0,
  config: { transport: 'unknown', mode: 'unknown', safety: 'unknown' },
};

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
  const d = Date.now() - ts;
  if (d < 60_000) return 'justo ahora';
  if (d < 3_600_000) return `hace ${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `hace ${Math.floor(d / 3_600_000)}h`;
  return `hace ${Math.floor(d / 86_400_000)}d`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtUptime(s) {
  if (!s || s < 0) return '0s';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtBytes(b) {
  if (!b || b < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${u[i]}`;
}

function truncate(s, n = 100) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] === undefined || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getNested(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ============================================================
// ICONS
// ============================================================

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
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  signal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  play_circle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
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
// TOASTS + MODAL
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

window.closeModal = closeModal;

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
        <div class="text-xs muted mt-8">Se guarda en localStorage. Nunca se envía a terceros.</div>
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
  if (!key) { toast('La API key no puede estar vacía', 'error'); return; }
  state.apiKey = key;
  localStorage.setItem(LS_KEY, key);
  closeModal();
  try {
    await api('/api/persona').catch((e) => { if (e.status === 404) return; throw e; });
    toast('API Key guardada', 'success');
    render();
  } catch (err) {
    toast('API Key inválida', 'error');
    state.apiKey = '';
    localStorage.removeItem(LS_KEY);
    showApiKeyModal();
  }
}

// ============================================================
// HEALTH POLLING
// ============================================================

async function pollHealth() {
  try {
    const data = await fetch('/health/readyz').then(r => r.json());
    state.lastHealth = data;
    state.lastHealthAt = Date.now();
    updateSidebarStatus(data);
    updateLiveIndicator(data);
    await pollCrisisBadge();
  } catch (_) {
    updateSidebarStatus(null);
    updateLiveIndicator(null);
  }
}

async function pollCrisisBadge() {
  if (!state.apiKey) return;
  try {
    const r = await api('/api/social/state').catch(() => null);
    const crisis = r?.state?.crisis;
    const badge = document.getElementById('crisis-badge');
    if (badge && crisis?.paused) badge.removeAttribute('hidden');
    else if (badge) badge.setAttribute('hidden', '');
  } catch (_) {}
}

function updateSidebarStatus(data) {
  const el = document.getElementById('sidebar-status');
  if (!el) return;
  const text = el.querySelector('.status-text');
  el.classList.remove('ok', 'err', 'warn');
  if (!data) { text.textContent = 'Desconectado'; el.classList.add('err'); }
  else if (data.ready) { text.textContent = 'Operativo'; el.classList.add('ok'); }
  else { text.textContent = data.db ? 'Degradado' : 'DB offline'; el.classList.add('warn'); }
}

function updateLiveIndicator(data) {
  const el = document.getElementById('live-indicator');
  if (!el) return;
  if (data?.ready) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

// ============================================================
// ROUTER
// ============================================================

const ROUTES = {
  overview: { title: 'Overview', sub: 'Estado general del agente' },
  pending: { title: 'Pending', sub: 'Acciones esperando aprobación' },
  signals: { title: 'Signals', sub: 'Señales ingeridas del sistema' },
  actions: { title: 'Actions', sub: 'Historial de acciones publicadas' },
  persona: { title: 'Persona', sub: 'Editor visual de identidad y comportamiento' },
  sessions: { title: 'Sessions', sub: 'Gestión de sesiones de scraping' },
  diagnostics: { title: 'Diagnostics', sub: 'Salud de módulos y sistema' },
  crisis: { title: 'Crisis', sub: 'Estado e historial de crisis' },
  playground: { title: 'Playground', sub: 'Prueba el LLM sin publicar' },
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
  stopRouteTimer();
  render();
  startRouteTimer();
}

function render() {
  const content = document.getElementById('content');
  content.innerHTML = '';
  const fn = VIEWS[state.route];
  if (fn) fn.render(content);
}

function stopRouteTimer() {
  if (state.timers.route) {
    clearInterval(state.timers.route);
    state.timers.route = null;
  }
}

function startRouteTimer() {
  const fn = VIEWS[state.route];
  if (fn && fn.refresh) {
    state.timers.route = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fn.refresh();
    }, REFRESH_MS);
  }
}

// ============================================================
// VIEWS
// ============================================================

const VIEWS = {};

// ------------------------------------------------------------
// VIEW: OVERVIEW
// ------------------------------------------------------------

VIEWS.overview = {
  render(root) {
    root.innerHTML = `
      <div class="metrics-grid" id="ov-metrics">
        ${this.skelMetric('Uptime')}
        ${this.skelMetric('Ciclos')}
        ${this.skelMetric('Pending')}
        ${this.skelMetric('Acciones')}
      </div>
      <div class="card mb-16" id="ov-system">
        <div class="skeleton skeleton-line" style="width: 40%"></div>
        <div class="skeleton skeleton-line" style="width: 70%"></div>
      </div>
      <div class="card mb-16" id="ov-controls">
        <div class="card-header">
          <div>
            <div class="card-title">Control manual</div>
            <div class="card-sub">Acciones puntuales sobre el loop</div>
          </div>
        </div>
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <button class="btn btn-secondary" id="btn-tick">${ICONS.refresh} Ejecutar ciclo</button>
          <button class="btn btn-secondary" id="btn-toggle-pause">${ICONS.pause} Pausar</button>
          <button class="btn btn-warning" id="btn-resume-crisis">${ICONS.warning} Resolver crisis</button>
          <button class="btn btn-secondary" id="btn-view-diagnostics">Diagnostics →</button>
        </div>
      </div>
      <div class="card" id="ov-quick">
        <div class="card-header">
          <div>
            <div class="card-title">Quick actions</div>
            <div class="card-sub">Atajos a las vistas más usadas</div>
          </div>
        </div>
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <button class="btn btn-secondary btn-sm" data-nav="pending">${ICONS.clock} Ver pending</button>
          <button class="btn btn-secondary btn-sm" data-nav="signals">${ICONS.signal} Ver señales</button>
          <button class="btn btn-secondary btn-sm" data-nav="playground">${ICONS.zap} Probar LLM</button>
          <button class="btn btn-secondary btn-sm" data-nav="persona">${ICONS.user} Editar persona</button>
        </div>
      </div>
    `;
    this.load();
    this.bind(root);
  },

  skelMetric(label) {
    return `<div class="metric"><div class="metric-label">${label}</div><div class="skeleton" style="height: 30px; width: 60%; margin-top: 8px;"></div></div>`;
  },

  async load() {
    try {
      const [stateRes, pendingRes] = await Promise.all([
        api('/api/social/state').catch(() => null),
        api('/api/social/pending').catch(() => ({ pending: [] })),
      ]);
      state.viewData.overview = {
        state: stateRes?.state || null,
        pending: pendingRes.pending || [],
      };
      if (stateRes?.state) state.config.transport = stateRes.state.transport || 'unknown';
      this.paint();
      this.updatePendingBadge(pendingRes.pending?.length || 0);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint() {
    const data = state.viewData.overview || {};
    const s = data.state;
    const health = state.lastHealth;
    const metrics = document.getElementById('ov-metrics');
    if (!metrics) return;
    const pendingCount = data.pending?.length || 0;

    metrics.innerHTML = `
      <div class="metric"><div class="metric-label">Uptime</div><div class="metric-value">${health ? fmtUptime(Math.round(health.uptimeMs / 1000)) : '—'}</div><div class="metric-hint">${health?.ready ? 'ready' : 'no ready'}</div></div>
      <div class="metric"><div class="metric-label">Ciclos</div><div class="metric-value">${s?.metrics?.totalCycles ?? 0}</div><div class="metric-hint">${s?.metrics?.failedCycles ?? 0} fallidos</div></div>
      <div class="metric"><div class="metric-label">Pending</div><div class="metric-value ${pendingCount > 0 ? 'warning' : ''}">${pendingCount}</div><div class="metric-hint">${pendingCount > 0 ? 'requiere atención' : 'todo al día'}</div></div>
      <div class="metric"><div class="metric-label">Acciones</div><div class="metric-value">${s?.metrics?.draftsPublished ?? 0}</div><div class="metric-hint">publicadas</div></div>
    `;

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
          <div><div class="card-title">Estado del sistema</div><div class="card-sub">Loop autónomo y subsistemas</div></div>
          <div class="row">${crisisBadge}${transportBadge}</div>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Loop</span><span class="v">${s.running ? 'en marcha' : 'pausado'}</span></div>
          <div class="session-row"><span class="k">Clasificador</span><span class="v">${s.classifier?.metrics?.classified ?? 0} señales</span></div>
          <div class="session-row"><span class="k">Ingester</span><span class="v">${s.ingester?.metrics?.signalsNew ?? 0} nuevas</span></div>
          <div class="session-row"><span class="k">Guard rechazos</span><span class="v">${s.metrics?.draftsRejectedByGuard ?? 0}</span></div>
        </div>
      `;
    }

    const pauseBtn = document.getElementById('btn-toggle-pause');
    if (pauseBtn && s) {
      if (s.paused) { pauseBtn.innerHTML = `${ICONS.play} Reanudar`; pauseBtn.dataset.action = 'resume'; }
      else { pauseBtn.innerHTML = `${ICONS.pause} Pausar`; pauseBtn.dataset.action = 'pause'; }
    }
  },

  updatePendingBadge(count) {
    const badge = document.getElementById('pending-count');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.removeAttribute('hidden'); }
    else badge.setAttribute('hidden', '');
  },

  bind(root) {
    root.querySelector('#btn-tick')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/social/tick', { method: 'POST' });
        toast('Ciclo ejecutado', 'success');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    root.querySelector('#btn-toggle-pause')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const action = btn.dataset.action || 'pause';
      btn.disabled = true;
      try {
        await api(`/api/social/${action}`, { method: 'POST' });
        toast(action === 'pause' ? 'Loop pausado' : 'Loop reanudado', 'success');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    root.querySelector('#btn-resume-crisis')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/social/crisis/resume', { method: 'POST' });
        toast('Crisis resuelta', 'success');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });

    root.querySelector('#btn-view-diagnostics')?.addEventListener('click', () => {
      location.hash = '#/diagnostics';
    });

    root.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.nav}`; });
    });
  },
};

// ------------------------------------------------------------
// VIEW: PERSONA (editor visual completo)
// ------------------------------------------------------------

VIEWS.persona = {
  draft: null,
  original: null,
  activeTab: 'identity',
  dirty: false,

  TABS: [
    { id: 'identity', label: 'Identidad' },
    { id: 'voice', label: 'Voz' },
    { id: 'personality', label: 'Personalidad' },
    { id: 'values', label: 'Valores' },
    { id: 'topics', label: 'Temas' },
    { id: 'boundaries', label: 'Límites' },
    { id: 'platforms', label: 'Plataformas' },
    { id: 'rules', label: 'Reglas' },
    { id: 'mode', label: 'Modo' },
    { id: 'json', label: 'JSON' },
  ],

  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/persona').catch((e) => {
        if (e.status === 404) return null;
        throw e;
      });

      if (!data) {
        this.renderEmpty();
        return;
      }

      this.original = deepClone(data.persona);
      this.draft = deepClone(data.persona);
      this.dirty = false;
      this.renderEditor();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() {
    if (!this.dirty) this.load();
  },

  renderEmpty() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="alert alert-warning">
        <div class="alert-icon">${ICONS.warning}</div>
        <div class="alert-body">
          <strong>No hay PersonaConfig.</strong> Sin persona, el loop no hace nada.
          Crea una con el botón de abajo.
        </div>
      </div>
      <div class="mt-16 row" style="gap: 8px;">
        <button class="btn btn-primary" id="p-create">Crear persona desde cero</button>
        <button class="btn btn-secondary" id="p-create-import">Importar JSON</button>
      </div>
    `;

    content.querySelector('#p-create').addEventListener('click', () => {
      this.original = null;
      this.draft = this.defaultPersona();
      this.dirty = true;
      this.activeTab = 'identity';
      this.renderEditor();
    });

    content.querySelector('#p-create-import').addEventListener('click', () => {
      this.showJsonImport();
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
        signaturePhrases: [],
        bannedPhrases: [
          'como modelo de lenguaje',
          'como IA',
          'estoy aquí para ayudarte',
          'soy un asistente',
          'no soy un humano',
          'fui entrenado para',
        ],
        samples: [],
      },
      traits: {
        openness: 0.5,
        conscientiousness: 0.5,
        extraversion: 0.5,
        agreeableness: 0.5,
        neuroticism: 0.5,
      },
      values: [],
      topics: {
        loves: [],
        casual: [],
        avoids: [],
        taboos: ['política partidista', 'religión', 'ataques personales', 'información privada de terceros'],
      },
      boundaries: {
        neverDmFirst: false,
        neverReplyTo: [],
        neverPostBetween: ['23:00', '07:00'],
        requireApprovalFor: ['cualquier_dm', 'respuesta_a_mencion_negativa', 'post_con_mas_de_280_chars', 'nuevo_tema'],
        autoApproveOnly: [],
        maxPostsPerDay: 5,
        maxRepliesPerHour: 10,
        minMsBetweenProactivePosts: 3 * 60 * 60 * 1000,
      },
      platforms: {
        twitter: { enabled: false, handle: '', styleOverride: null },
        instagram: { enabled: false, handle: '', styleOverride: null },
        linkedin: { enabled: false, handle: '', styleOverride: null },
        threads: { enabled: false, handle: '', styleOverride: null },
      },
      rules: [],
      operatingMode: 'draft',
      safetyLevel: 'strict',
    };
  },

  renderEditor() {
    const content = document.getElementById('content');
    const version = this.original?.version;
    const isNew = !this.original;

    content.innerHTML = `
      <div class="row-between mb-16" style="flex-wrap: wrap; gap: 8px;">
        <div class="row">
          ${version ? `<span class="badge badge-success">v${version}</span>` : '<span class="badge badge-info">nueva</span>'}
          <span class="badge badge-neutral" id="p-head-mode">${esc(this.draft.operatingMode)}</span>
          <span class="badge badge-neutral" id="p-head-safety">${esc(this.draft.safetyLevel)}</span>
        </div>
        <div class="row">
          <button class="btn btn-secondary btn-sm" id="p-reload">${ICONS.refresh} Recargar</button>
        </div>
      </div>

      <div class="tabs" id="p-tabs">
        ${this.TABS.map(t => `<button class="tab ${t.id === this.activeTab ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>

      <div id="p-tab-content"></div>

      <div class="save-bar" id="p-save-bar">
        <div class="save-bar-info" id="p-dirty-info">Sin cambios</div>
        <div class="save-bar-actions">
          <button class="btn btn-secondary" id="p-reset">Descartar</button>
          <button class="btn btn-primary" id="p-save">${ICONS.check} Guardar cambios</button>
        </div>
      </div>
    `;

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        document.querySelectorAll('[data-tab]').forEach(b => {
          b.classList.toggle('active', b.dataset.tab === this.activeTab);
        });
        this.renderTab(this.activeTab);
      });
    });

    document.getElementById('p-reload')?.addEventListener('click', () => {
      if (this.dirty && !confirm('¿Descartar cambios y recargar desde el servidor?')) return;
      this.load();
    });

    document.getElementById('p-reset')?.addEventListener('click', () => {
      if (!this.original) { this.renderEmpty(); return; }
      this.draft = deepClone(this.original);
      this.dirty = false;
      this.renderEditor();
    });

    document.getElementById('p-save')?.addEventListener('click', () => this.save());

    this.renderTab(this.activeTab);
    this.renderSaveBar();
  },

  renderSaveBar() {
    const info = document.getElementById('p-dirty-info');
    const save = document.getElementById('p-save');
    if (!info || !save) return;

    if (this.dirty) {
      info.innerHTML = `<strong>● Cambios sin guardar</strong>`;
      save.disabled = false;
    } else {
      info.textContent = 'Sin cambios';
      save.disabled = !this.original && !this.dirty;
    }
  },

  markDirty() {
    const now = JSON.stringify(this.draft);
    const prev = JSON.stringify(this.original);
    this.dirty = now !== prev;
    this.renderSaveBar();
  },

  // ============================================================
  // Tab dispatcher
  // ============================================================

  renderTab(tab) {
    const el = document.getElementById('p-tab-content');
    if (!el) return;
    el.innerHTML = '';

    switch (tab) {
      case 'identity': return this.renderIdentityTab(el);
      case 'voice': return this.renderVoiceTab(el);
      case 'personality': return this.renderPersonalityTab(el);
      case 'values': return this.renderValuesTab(el);
      case 'topics': return this.renderTopicsTab(el);
      case 'boundaries': return this.renderBoundariesTab(el);
      case 'platforms': return this.renderPlatformsTab(el);
      case 'rules': return this.renderRulesTab(el);
      case 'mode': return this.renderModeTab(el);
      case 'json': return this.renderJsonTab(el);
    }
  },

  // ============================================================
  // Small render helpers
  // ============================================================

  fieldText({ path, label, placeholder = '', hint = '', value }) {
    const v = value !== undefined ? value : getNested(this.draft, path);
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <input class="input" type="text" data-bind="${path}" value="${esc(v || '')}" placeholder="${esc(placeholder)}">
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldTextarea({ path, label, placeholder = '', hint = '', value, minHeight = 100 }) {
    const v = value !== undefined ? value : getNested(this.draft, path);
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <textarea class="textarea" data-bind="${path}" placeholder="${esc(placeholder)}" style="min-height: ${minHeight}px;">${esc(v || '')}</textarea>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldSelect({ path, label, options, hint = '' }) {
    const v = getNested(this.draft, path);
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <select class="select" data-bind="${path}" data-bind-type="string">
          ${options.map(o => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldNumber({ path, label, hint = '', min, max, step = 1 }) {
    const v = getNested(this.draft, path);
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <input class="num-input" type="number" data-bind="${path}" data-bind-type="number" value="${v ?? ''}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} step="${step}">
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldSlider({ path, label, min = 0, max = 1, step = 0.05, hint = '' }) {
    const v = getNested(this.draft, path);
    return `
      <div class="slider-field" style="margin-bottom: 14px;">
        <div class="slider-head">
          <span class="slider-label">${label}</span>
          <span class="slider-value" data-slider-value="${path}">${(v ?? 0).toFixed ? v.toFixed(2) : v}</span>
        </div>
        <input type="range" class="slider" data-bind="${path}" data-bind-type="number" min="${min}" max="${max}" step="${step}" value="${v ?? 0}">
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldToggle({ path, label, desc = '' }) {
    const v = !!getNested(this.draft, path);
    return `
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">${label}</div>
          ${desc ? `<div class="toggle-desc">${desc}</div>` : ''}
        </div>
        <button class="toggle ${v ? 'on' : ''}" data-toggle-path="${path}" type="button"></button>
      </div>
    `;
  },

  fieldChipInput({ path, label, placeholder = 'Añadir…', hint = '' }) {
    const items = getNested(this.draft, path) || [];
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <div class="chip-input" data-chip-path="${path}">
          ${items.map(it => `<span class="chip">${esc(it)}<button class="chip-remove" data-chip-remove="${esc(it)}" type="button">×</button></span>`).join('')}
          <input class="chip-new" data-chip-new type="text" placeholder="${esc(placeholder)}">
        </div>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  fieldLines({ path, label, placeholder = 'Una por línea', hint = '', minHeight = 100 }) {
    const arr = getNested(this.draft, path) || [];
    const text = Array.isArray(arr) ? arr.join('\n') : '';
    return `
      <div class="form-field">
        <label class="label">${label}</label>
        <textarea class="textarea" data-lines-path="${path}" placeholder="${esc(placeholder)}" style="min-height: ${minHeight}px;">${esc(text)}</textarea>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>
    `;
  },

  // ============================================================
  // Event binding helpers (called after renderTab)
  // ============================================================

  bindCommon(container) {
    // text / textarea / number / slider / select
    container.querySelectorAll('[data-bind]').forEach(el => {
      const path = el.dataset.bind;
      const type = el.dataset.bindType;
      const handler = () => {
        let val;
        if (type === 'number') val = parseFloat(el.value);
        else val = el.value;
        setNested(this.draft, path, val);
        if (el.type === 'range') {
          const display = container.querySelector(`[data-slider-value="${path}"]`);
          if (display) display.textContent = parseFloat(el.value).toFixed(2);
        }
        if (path === 'operatingMode') document.getElementById('p-head-mode').textContent = val;
        if (path === 'safetyLevel') document.getElementById('p-head-safety').textContent = val;
        this.markDirty();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });

    // toggles
    container.querySelectorAll('[data-toggle-path]').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.togglePath;
        const cur = !!getNested(this.draft, path);
        setNested(this.draft, path, !cur);
        btn.classList.toggle('on', !cur);
        this.markDirty();
      });
    });

    // chips
    container.querySelectorAll('[data-chip-path]').forEach(el => {
      const path = el.dataset.chipPath;
      const input = el.querySelector('[data-chip-new]');

      el.querySelectorAll('[data-chip-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.dataset.chipRemove;
          const arr = getNested(this.draft, path) || [];
          setNested(this.draft, path, arr.filter(x => x !== value));
          this.markDirty();
          this.refreshChipInput(el, path);
        });
      });

      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ',') return;
          e.preventDefault();
          const v = input.value.trim();
          if (!v) return;
          const arr = getNested(this.draft, path) || [];
          if (arr.includes(v)) { input.value = ''; return; }
          setNested(this.draft, path, [...arr, v]);
          input.value = '';
          this.markDirty();
          this.refreshChipInput(el, path);
        });
      }
    });

    // lines (textarea → array)
    container.querySelectorAll('[data-lines-path]').forEach(el => {
      const path = el.dataset.linesPath;
      el.addEventListener('input', () => {
        const arr = el.value.split('\n').map(s => s.trim()).filter(Boolean);
        setNested(this.draft, path, arr);
        this.markDirty();
      });
    });
  },

  refreshChipInput(el, path) {
    const items = getNested(this.draft, path) || [];
    // Remove only chips, keep input
    el.querySelectorAll('.chip').forEach(c => c.remove());
    const input = el.querySelector('[data-chip-new]');
    items.forEach(it => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${esc(it)}<button class="chip-remove" data-chip-remove="${esc(it)}" type="button">×</button>`;
      chip.querySelector('[data-chip-remove]').addEventListener('click', () => {
        const arr = getNested(this.draft, path) || [];
        setNested(this.draft, path, arr.filter(x => x !== it));
        this.markDirty();
        this.refreshChipInput(el, path);
      });
      el.insertBefore(chip, input);
    });
  },

  // ============================================================
  // Tab: IDENTITY
  // ============================================================

  renderIdentityTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Identidad</div>
        <div class="form-section-sub">Quién es el agente. Este bloque va en todos los prompts al LLM.</div>
        <div class="form-row">
          ${this.fieldText({ path: 'identity.name', label: 'Nombre', placeholder: 'Ana García' })}
          ${this.fieldText({ path: 'identity.handle', label: 'Handle', placeholder: '@anagarcia' })}
        </div>
        ${this.fieldTextarea({ path: 'identity.bio', label: 'Bio', placeholder: 'Una bio breve...', minHeight: 80 })}
        <div class="form-row">
          ${this.fieldText({ path: 'identity.role', label: 'Role', placeholder: 'persona', hint: 'Libre. Por defecto "persona".' })}
          ${this.fieldText({ path: 'identity.timezone', label: 'Timezone (IANA)', placeholder: 'Europe/Madrid', hint: 'Ej: Europe/Madrid, America/Mexico_City, UTC' })}
        </div>
        ${this.fieldChipInput({ path: 'identity.languages', label: 'Idiomas', placeholder: 'es, en, fr…', hint: 'Códigos ISO 639-1 (2-8 chars)' })}
      </div>
    `;
    this.bindCommon(el);
  },

  // ============================================================
  // Tab: VOICE
  // ============================================================

  renderVoiceTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Tono de voz</div>
        <div class="form-section-sub">Cómo habla el agente. Afecta directamente el estilo del LLM.</div>
        <div class="form-row">
          ${this.fieldSelect({
            path: 'voice.tone',
            label: 'Tono',
            options: [
              { value: 'cercano', label: 'Cercano' },
              { value: 'formal', label: 'Formal' },
              { value: 'casual', label: 'Casual' },
              { value: 'técnico', label: 'Técnico' },
              { value: 'poético', label: 'Poético' },
              { value: 'directo', label: 'Directo' },
              { value: 'cálido', label: 'Cálido' },
              { value: 'irónico', label: 'Irónico' },
              { value: 'juguetón', label: 'Juguetón' },
              { value: 'reflexivo', label: 'Reflexivo' },
            ],
          })}
          ${this.fieldSelect({
            path: 'voice.sentenceLength',
            label: 'Longitud de frase',
            options: [
              { value: 'corta', label: 'Corta' },
              { value: 'media', label: 'Media' },
              { value: 'larga', label: 'Larga' },
            ],
          })}
        </div>
        <div class="form-row">
          ${this.fieldSelect({
            path: 'voice.punctuation',
            label: 'Puntuación',
            options: [
              { value: 'normal', label: 'Normal' },
              { value: 'expresiva', label: 'Expresiva' },
              { value: 'minima', label: 'Mínima' },
            ],
          })}
          <div></div>
        </div>
        <div class="form-row">
          ${this.fieldSlider({ path: 'voice.formality', label: 'Formalidad', min: 0, max: 1, step: 0.05 })}
          ${this.fieldSlider({ path: 'voice.humor', label: 'Humor', min: 0, max: 1, step: 0.05 })}
        </div>
        ${this.fieldSlider({ path: 'voice.emojiFrequency', label: 'Frecuencia de emojis', min: 0, max: 1, step: 0.05 })}
      </div>

      <div class="form-section">
        <div class="form-section-title">Frases</div>
        <div class="form-section-sub">Frases firma y frases prohibidas.</div>
        ${this.fieldChipInput({ path: 'voice.signaturePhrases', label: 'Frases firma', placeholder: 'vamos allá, esto me tiene pensando…' })}
        ${this.fieldChipInput({ path: 'voice.bannedPhrases', label: 'Frases PROHIBIDAS', placeholder: 'como modelo de lenguaje, como IA…', hint: 'El Guard bloquea cualquier draft que las contenga.' })}
      </div>

      <div class="form-section">
        <div class="form-section-title">Ejemplos de escritura</div>
        <div class="form-section-sub">El LLM imitará este estilo. Una muestra por línea (máx 30).</div>
        ${this.fieldLines({
          path: 'voice.samples',
          label: 'Samples',
          placeholder: 'Los sistemas distribuidos son como las relaciones: necesitan latido.\nNueva entrada: cómo diseñar APIs que perdonen.',
          minHeight: 140,
        })}
      </div>
    `;
    this.bindCommon(el);
  },

  // ============================================================
  // Tab: PERSONALITY (Big Five)
  // ============================================================

  renderPersonalityTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Personalidad (Big Five)</div>
        <div class="form-section-sub">Rasgos de personalidad del agente. 0 = bajo, 1 = alto.</div>
        ${this.fieldSlider({ path: 'traits.openness', label: 'Apertura (openness)', min: 0, max: 1, step: 0.05, hint: 'Curiosidad, creatividad, apertura a nuevas ideas' })}
        ${this.fieldSlider({ path: 'traits.conscientiousness', label: 'Responsabilidad (conscientiousness)', min: 0, max: 1, step: 0.05, hint: 'Organización, rigor, disciplina' })}
        ${this.fieldSlider({ path: 'traits.extraversion', label: 'Extraversión (extraversion)', min: 0, max: 1, step: 0.05, hint: 'Sociabilidad, energía, asertividad' })}
        ${this.fieldSlider({ path: 'traits.agreeableness', label: 'Amabilidad (agreeableness)', min: 0, max: 1, step: 0.05, hint: 'Cooperación, empatía, calidez' })}
        ${this.fieldSlider({ path: 'traits.neuroticism', label: 'Neuroticismo (neuroticism)', min: 0, max: 1, step: 0.05, hint: 'Inestabilidad emocional, ansiedad' })}
      </div>
    `;
    this.bindCommon(el);
  },

  // ============================================================
  // Tab: VALUES
  // ============================================================

  renderValuesTab(el) {
    const values = this.draft.values || [];
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">
          <span>Valores</span>
          <span class="badge badge-neutral">${values.length}</span>
        </div>
        <div class="form-section-sub">Valores que guían al agente. El peso (0-1) indica importancia.</div>
        <div class="repeater" id="p-values">
          ${values.map((v, i) => `
            <div class="repeater-row-3">
              <input data-bind="values.${i}.id" value="${esc(v.id || '')}" placeholder="id (ej: honestidad)">
              <input data-bind="values.${i}.description" value="${esc(v.description || '')}" placeholder="descripción">
              <div class="slider-field">
                <div class="slider-head">
                  <span class="slider-label">peso</span>
                  <span class="slider-value" data-slider-value="values.${i}.weight">${(v.weight ?? 0.5).toFixed(2)}</span>
                </div>
                <input type="range" class="slider" data-bind="values.${i}.weight" data-bind-type="number" min="0" max="1" step="0.05" value="${v.weight ?? 0.5}">
              </div>
              <button class="btn btn-danger btn-sm repeater-remove" data-value-remove="${i}" type="button">${ICONS.x}</button>
            </div>
          `).join('')}
          <button class="btn btn-secondary btn-sm repeater-add" id="p-values-add" type="button">${ICONS.plus} Añadir valor</button>
        </div>
      </div>
    `;
    this.bindCommon(el);

    el.querySelector('#p-values-add').addEventListener('click', () => {
      this.draft.values = [...(this.draft.values || []), { id: '', weight: 0.5, description: '' }];
      this.markDirty();
      this.renderTab('values');
    });

    el.querySelectorAll('[data-value-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.valueRemove, 10);
        this.draft.values.splice(i, 1);
        this.markDirty();
        this.renderTab('values');
      });
    });
  },

  // ============================================================
  // Tab: TOPICS
  // ============================================================

  renderTopicsTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Temas</div>
        <div class="form-section-sub">Lo que le gusta, lo que toca, lo que evita y lo prohibido.</div>
        ${this.fieldChipInput({ path: 'topics.loves', label: 'Le apasiona', placeholder: 'sistemas distribuidos, rust, café…' })}
        ${this.fieldChipInput({ path: 'topics.casual', label: 'Toca si viene al caso', placeholder: 'python, startups…' })}
        ${this.fieldChipInput({ path: 'topics.avoids', label: 'Evita', placeholder: 'cripto, política…' })}
        ${this.fieldChipInput({ path: 'topics.taboos', label: 'NUNCA toca (tabú absoluto)', placeholder: 'política partidista, religión…', hint: 'El Guard rechaza cualquier draft que mencione estos temas.' })}
      </div>
    `;
    this.bindCommon(el);
  },

  // ============================================================
  // Tab: BOUNDARIES
  // ============================================================

  renderBoundariesTab(el) {
    const nb = this.draft.boundaries?.neverPostBetween;
    const hasQuietHours = !!nb;
    const start = nb?.[0] || '23:00';
    const end = nb?.[1] || '07:00';
    const minMs = this.draft.boundaries?.minMsBetweenProactivePosts || 0;
    const minHours = (minMs / 3_600_000).toFixed(1);

    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Límites y rate limits</div>
        <div class="form-section-sub">El Guard verifica estos límites antes de publicar.</div>
        <div class="form-row-3">
          ${this.fieldNumber({ path: 'boundaries.maxPostsPerDay', label: 'Max posts / día', min: 0, max: 50 })}
          ${this.fieldNumber({ path: 'boundaries.maxRepliesPerHour', label: 'Max replies / hora', min: 0, max: 120 })}
          <div class="form-field">
            <label class="label">Min ms entre proactivos</label>
            <input class="num-input" type="number" id="p-min-hours" value="${minHours}" min="0" max="24" step="0.5">
            <div class="hint">Horas entre posts proactivos (se convierte a ms)</div>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Horario de silencio</div>
        <div class="form-section-sub">No publica dentro de esta ventana en la timezone del agente.</div>
        ${this.fieldToggle({ path: 'boundaries.__hasQuietHours', label: 'Activar horario de silencio', desc: 'Bloquea publicaciones entre dos horas del día' })}
        <div id="p-quiet-hours" style="${hasQuietHours ? '' : 'display:none;'}">
          <div class="time-range mt-12">
            <input type="time" id="p-quiet-start" value="${esc(start)}">
            <span class="sep">→</span>
            <input type="time" id="p-quiet-end" value="${esc(end)}">
          </div>
          <div class="hint mt-8">Si start > end, la ventana cruza medianoche (ej: 23:00 → 07:00).</div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Autor</div>
        ${this.fieldToggle({ path: 'boundaries.neverDmFirst', label: 'Nunca iniciar DM', desc: 'Solo responde DMs, nunca empieza conversación' })}
        ${this.fieldChipInput({ path: 'boundaries.neverReplyTo', label: 'Autores bloqueados', placeholder: '@usuario…', hint: 'Nunca responde a estos autores' })}
      </div>

      <div class="form-section">
        <div class="form-section-title">Aprobaciones</div>
        <div class="form-section-sub">Clasificaciones que siempre/ocasionalmente requieren aprobación humana.</div>
        ${this.fieldChipInput({ path: 'boundaries.requireApprovalFor', label: 'Requiere aprobación para', placeholder: 'cualquier_dm, respuesta_a_mencion_negativa…' })}
        ${this.fieldChipInput({ path: 'boundaries.autoApproveOnly', label: 'Auto-aprobar solo', placeholder: 'mention_positiva…', hint: 'En safetyLevel=strict, todo lo demás requiere aprobación' })}
      </div>
    `;
    this.bindCommon(el);

    // Special handler for quiet hours toggle
    const toggles = el.querySelectorAll('[data-toggle-path]');
    toggles.forEach(btn => {
      if (btn.dataset.togglePath !== 'boundaries.__hasQuietHours') return;
      btn.addEventListener('click', () => {
        const qh = el.querySelector('#p-quiet-hours');
        const isOn = btn.classList.contains('on');
        if (isOn) {
          this.draft.boundaries.neverPostBetween = ['23:00', '07:00'];
          qh.style.display = 'block';
        } else {
          this.draft.boundaries.neverPostBetween = null;
          qh.style.display = 'none';
        }
        this.markDirty();
      });
    });

    // Init the toggle visual state based on actual quiet hours
    if (hasQuietHours) {
      const btn = el.querySelector('[data-toggle-path="boundaries.__hasQuietHours"]');
      if (btn) btn.classList.add('on');
    }

    el.querySelector('#p-quiet-start')?.addEventListener('change', (e) => {
      const start = e.target.value;
      const end = el.querySelector('#p-quiet-end').value;
      this.draft.boundaries.neverPostBetween = [start, end];
      this.markDirty();
    });
    el.querySelector('#p-quiet-end')?.addEventListener('change', (e) => {
      const start = el.querySelector('#p-quiet-start').value;
      const end = e.target.value;
      this.draft.boundaries.neverPostBetween = [start, end];
      this.markDirty();
    });

    el.querySelector('#p-min-hours')?.addEventListener('change', (e) => {
      const hours = parseFloat(e.target.value) || 0;
      this.draft.boundaries.minMsBetweenProactivePosts = Math.round(hours * 3_600_000);
      this.markDirty();
    });
  },

  // ============================================================
  // Tab: PLATFORMS
  // ============================================================

  renderPlatformsTab(el) {
    const platforms = ['twitter', 'instagram', 'linkedin', 'threads'];
    el.innerHTML = platforms.map(p => this.renderPlatformCard(p)).join('');
    this.bindCommon(el);
  },

  renderPlatformCard(platform) {
    const cfg = this.draft.platforms?.[platform] || {};
    const enabled = !!cfg.enabled;
    const handle = cfg.handle || '';
    const so = cfg.styleOverride || {};

    return `
      <div class="form-section">
        <div class="form-section-title">
          <span style="text-transform: capitalize;">${platform}</span>
          <span class="badge ${enabled ? 'badge-success' : 'badge-neutral'}">${enabled ? 'enabled' : 'disabled'}</span>
        </div>
        ${this.fieldToggle({ path: `platforms.${platform}.enabled`, label: 'Activar plataforma', desc: 'Si está desactivada, el loop ignora esta plataforma' })}
        ${this.fieldText({ path: `platforms.${platform}.handle`, label: 'Handle', placeholder: '@usuario' })}
        <div class="card-sub mt-12 mb-8">Style override (opcional)</div>
        <div class="form-row">
          <div class="form-field">
            <label class="label">Tono específico</label>
            <input class="input" data-bind="platforms.${platform}.styleOverride.tone" value="${esc(so.tone || '')}" placeholder="heredar del global">
            <div class="hint">Override del tono global para esta plataforma</div>
          </div>
          <div class="form-field">
            <label class="label">Max length</label>
            <input class="num-input" type="number" data-bind="platforms.${platform}.styleOverride.maxLength" data-bind-type="number" value="${so.maxLength ?? ''}" placeholder="heredar">
            <div class="hint">Límite de caracteres específico</div>
          </div>
        </div>
        <div class="slider-field">
          <div class="slider-head">
            <span class="slider-label">Formalidad override</span>
            <span class="slider-value" data-slider-value="platforms.${platform}.styleOverride.formality">${so.formality != null ? so.formality.toFixed(2) : '—'}</span>
          </div>
          <input type="range" class="slider" data-bind="platforms.${platform}.styleOverride.formality" data-bind-type="number" min="0" max="1" step="0.05" value="${so.formality ?? 0.5}">
        </div>
      </div>
    `;
  },

  // ============================================================
  // Tab: RULES
  // ============================================================

  renderRulesTab(el) {
    const rules = this.draft.rules || [];
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">
          <span>Reglas custom</span>
          <span class="badge badge-neutral">${rules.length}</span>
        </div>
        <div class="form-section-sub">
          Reglas SI → ENTONCES. Condiciones soportadas: "cualquier dm", "mention contiene 'urgente'", "tema = 'cripto'", "proactive con urls".
        </div>
        <div class="repeater" id="p-rules">
          ${rules.map((r, i) => `
            <div class="repeater-row">
              <input data-bind="rules.${i}.if" value="${esc(r.if || '')}" placeholder="SI … (condición)">
              <select data-bind="rules.${i}.then">
                ${['escalate_to_human', 'avoid', 'skip', 'use_template', 'force_approval'].map(v =>
                  `<option value="${v}" ${r.then === v ? 'selected' : ''}>${v}</option>`
                ).join('')}
              </select>
              <div></div>
              <button class="btn btn-danger btn-sm repeater-remove" data-rule-remove="${i}" type="button">${ICONS.x}</button>
            </div>
          `).join('')}
          <button class="btn btn-secondary btn-sm repeater-add" id="p-rules-add" type="button">${ICONS.plus} Añadir regla</button>
        </div>
      </div>
    `;
    this.bindCommon(el);

    el.querySelector('#p-rules-add').addEventListener('click', () => {
      this.draft.rules = [...(this.draft.rules || []), { if: '', then: 'escalate_to_human' }];
      this.markDirty();
      this.renderTab('rules');
    });

    el.querySelectorAll('[data-rule-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ruleRemove, 10);
        this.draft.rules.splice(i, 1);
        this.markDirty();
        this.renderTab('rules');
      });
    });
  },

  // ============================================================
  // Tab: MODE
  // ============================================================

  renderModeTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">Modo operativo</div>
        <div class="form-section-sub">Controla si el agente puede publicar sin aprobación humana.</div>
        <div class="form-field">
          <label class="label">Operating Mode</label>
          <select class="select" data-bind="operatingMode">
            <option value="draft" ${this.draft.operatingMode === 'draft' ? 'selected' : ''}>draft — todo requiere aprobación</option>
            <option value="auto" ${this.draft.operatingMode === 'auto' ? 'selected' : ''}>auto — publica según safetyLevel</option>
          </select>
          <div class="hint">En draft, TODO requiere aprobación humana. En auto, se aplica safetyLevel.</div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Safety Level</div>
        <div class="form-section-sub">Solo aplica cuando operatingMode=auto.</div>
        <div class="form-field">
          <label class="label">Safety Level</label>
          <select class="select" data-bind="safetyLevel">
            <option value="strict" ${this.draft.safetyLevel === 'strict' ? 'selected' : ''}>strict — todo requiere aprobación salvo autoApproveOnly</option>
            <option value="normal" ${this.draft.safetyLevel === 'normal' ? 'selected' : ''}>normal — solo lo que esté en requireApprovalFor</option>
            <option value="permissive" ${this.draft.safetyLevel === 'permissive' ? 'selected' : ''}>permissive — solo lo crítico</option>
          </select>
        </div>
      </div>

      <div class="alert alert-info">
        <div class="alert-icon">${ICONS.info}</div>
        <div class="alert-body">
          <strong>Fail-safe by design.</strong> El modo por defecto es <span class="inline-code">draft</span>.
          Para activar publicación automática, cambia a <span class="inline-code">auto</span> y configura
          <span class="inline-code">autoApproveOnly</span> en la pestaña Límites con las clasificaciones explícitas.
        </div>
      </div>
    `;
    this.bindCommon(el);
  },

  // ============================================================
  // Tab: JSON
  // ============================================================

  renderJsonTab(el) {
    el.innerHTML = `
      <div class="form-section">
        <div class="form-section-title">
          <span>JSON raw</span>
          <button class="btn btn-secondary btn-sm" id="p-json-validate">Validar</button>
        </div>
        <div class="form-section-sub">Edita el JSON completo. Se valida contra el schema Zod del servidor.</div>
        <textarea class="textarea" id="p-json-editor" style="min-height: 500px; font-size: 12px;">${esc(JSON.stringify(this.draft, null, 2))}</textarea>
        <div id="p-json-error" class="alert alert-danger mt-12 hidden">
          <div class="alert-icon">${ICONS.error}</div>
          <div class="alert-body" id="p-json-error-msg"></div>
        </div>
      </div>
    `;

    const ta = el.querySelector('#p-json-editor');
    const errBox = el.querySelector('#p-json-error');
    const errMsg = el.querySelector('#p-json-error-msg');

    ta.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(ta.value);
        this.draft = parsed;
        errBox.classList.add('hidden');
        this.markDirty();
      } catch (e) {
        errMsg.textContent = e.message;
        errBox.classList.remove('hidden');
      }
    });

    el.querySelector('#p-json-validate').addEventListener('click', () => {
      try {
        const parsed = JSON.parse(ta.value);
        this.draft = parsed;
        errBox.classList.add('hidden');
        this.markDirty();
        toast('JSON válido (sintaxis). El servidor valida el schema al guardar.', 'success');
      } catch (e) {
        errMsg.textContent = e.message;
        errBox.classList.remove('hidden');
      }
    });
  },

  // ============================================================
  // Save / import
  // ============================================================

  async save() {
    const btn = document.getElementById('p-save');
    if (btn) btn.disabled = true;

    const payload = deepClone(this.draft);
    // Cleanup styleOverride vacíos
    for (const p of Object.keys(payload.platforms || {})) {
      const so = payload.platforms[p]?.styleOverride;
      if (so && typeof so === 'object') {
        const hasAny = Object.keys(so).some(k => so[k] !== null && so[k] !== undefined && so[k] !== '');
        if (!hasAny) payload.platforms[p].styleOverride = null;
      }
    }

    try {
      const method = this.original ? 'PUT' : 'POST';
      const res = await api('/api/persona', { method, body: payload });
      toast(this.original ? 'Persona guardada' : 'Persona creada', 'success');
      this.original = deepClone(res.persona);
      this.draft = deepClone(res.persona);
      this.dirty = false;
      this.renderEditor();
    } catch (err) {
      if (err.message === 'auth_required') return;

      // Zod validation errors
      if (err.status === 400 && err.data?.details) {
        const issues = err.data.details
          .map(i => `• ${i.path?.join('.') || '?'}: ${i.message}`)
          .join('\n');
        openModal(`
          <div class="modal modal-wide">
            <div class="modal-head">
              <div class="modal-title">Error de validación</div>
              <div class="modal-desc">El servidor rechazó la persona con estos issues:</div>
            </div>
            <div class="modal-body">
              <div class="alert alert-danger">
                <div class="alert-icon">${ICONS.error}</div>
                <div class="alert-body">
                  <pre class="mono text-xs" style="white-space: pre-wrap;">${esc(issues)}</pre>
                </div>
              </div>
            </div>
            <div class="modal-foot">
              <button class="btn btn-primary" onclick="closeModal()">Entendido</button>
            </div>
          </div>
        `);
      } else {
        toast(err.message, 'error', 6000);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  showJsonImport() {
    openModal(`
      <div class="modal modal-wide">
        <div class="modal-head">
          <div class="modal-title">Importar persona desde JSON</div>
          <div class="modal-desc">Pega un PersonaConfig completo. Se valida al guardar.</div>
        </div>
        <div class="modal-body">
          <textarea class="textarea" id="p-import-json" style="min-height: 400px;" placeholder='{"identity": {...}, "voice": {...}}'></textarea>
        </div>
        <div class="modal-foot">
          <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
          <button class="btn btn-primary" id="p-import-save">Cargar al editor</button>
        </div>
      </div>
    `);

    document.getElementById('p-import-save').addEventListener('click', () => {
      const raw = document.getElementById('p-import-json').value.trim();
      try {
        const parsed = JSON.parse(raw);
        this.draft = parsed;
        this.original = null;
        this.dirty = true;
        closeModal();
        this.activeTab = 'identity';
        this.renderEditor();
        toast('JSON cargado al editor. Revisa y guarda.', 'info');
      } catch (e) {
        toast(`JSON inválido: ${e.message}`, 'error');
      }
    });
  },
};

// ------------------------------------------------------------
// VIEW: PENDING
// ------------------------------------------------------------

VIEWS.pending = {
  render(root) { root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`; this.load(); },
  async load() {
    try {
      const data = await api('/api/social/pending');
      this.paint(data.pending || []);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
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
      content.innerHTML = `<div class="empty" style="padding-top: 80px;"><div class="empty-icon">${ICONS.clock}</div><div class="empty-title">Todo al día</div><div class="empty-desc">No hay acciones esperando aprobación.</div></div>`;
      return;
    }
    content.innerHTML = `
      <div class="row-between mb-16">
        <div class="text-sm muted">${items.length} acción${items.length === 1 ? '' : 'es'} esperando</div>
        <button class="btn btn-secondary btn-sm" id="btn-cleanup-expired">Limpiar expirados</button>
      </div>
      <div class="pending-list">${items.map(p => this.renderCard(p)).join('')}</div>
    `;
    content.querySelectorAll('[data-action="approve"]').forEach(b => b.addEventListener('click', () => this.approve(b.dataset.id, b)));
    content.querySelectorAll('[data-action="reject"]').forEach(b => b.addEventListener('click', () => this.reject(b.dataset.id, b)));
    content.querySelector('#btn-cleanup-expired')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api('/api/admin/cleanup', { method: 'POST', body: { expiredPendings: true } });
        toast(`Limpiados: ${r.report?.expiredPendings || 0}`, 'success');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
      finally { btn.disabled = false; }
    });
  },
  renderCard(p) {
    const expired = p.expires_at && p.expires_at < Date.now();
    const reasonBadge = p.reason === 'requires_approval' ? '<span class="badge badge-warning">requiere aprobación</span>'
      : p.reason === 'guard_escalate' ? '<span class="badge badge-danger">guard: escalado</span>'
      : p.reason === 'escalate_rule' ? '<span class="badge badge-danger">regla custom</span>'
      : `<span class="badge badge-neutral">${esc(p.reason || '—')}</span>`;
    const signal = p.signal_payload;
    const signalBlock = signal ? `<div class="pending-signal">${signal.author ? `<strong>@${esc(signal.author)}</strong> · ` : ''}${signal.kind ? `<span class="badge badge-neutral" style="margin-right: 6px;">${esc(signal.kind)}</span>` : ''}${signal.text ? `«${esc(truncate(signal.text, 200))}»` : '<em class="muted">sin texto</em>'}</div>` : '';
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
          ${p.errors?.length ? `<div class="alert alert-warning mb-12"><div class="alert-icon">${ICONS.warning}</div><div class="alert-body text-xs">${p.errors.map(e => `• ${esc(e.code)}: ${esc(e.detail || '')}`).join('<br>')}</div></div>` : ''}
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
      await api(`/api/social/pending/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { approvedBy: 'dashboard' } });
      toast('Aprobado y publicado', 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message || 'Error', 'error');
      btn.disabled = false;
    }
  },
  async reject(id, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await api(`/api/social/pending/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { rejectedBy: 'dashboard', reason: 'rechazado desde dashboard' } });
      toast('Rechazado', 'success');
      this.load();
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message || 'Error', 'error');
      btn.disabled = false;
    }
  },
};

// ------------------------------------------------------------
// VIEW: SIGNALS
// ------------------------------------------------------------

VIEWS.signals = {
  filters: { platform: '', decision: '', kind: '', search: '' },
  render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <input class="input" id="sig-search" placeholder="Buscar en texto/autor/ID…" value="${esc(this.filters.search)}">
        <select class="select" id="sig-platform"><option value="">Todas</option><option value="twitter">Twitter</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></select>
        <select class="select" id="sig-decision"><option value="">Decisión</option><option value="publish">publish</option><option value="pending">pending</option><option value="reject">reject</option><option value="ignore">ignore</option><option value="skip">skip</option><option value="escalate">escalate</option><option value="error">error</option></select>
        <select class="select" id="sig-kind"><option value="">Kind</option><option value="mention">mention</option><option value="dm">dm</option><option value="comment">comment</option><option value="proactive_post">proactive_post</option></select>
        <button class="btn btn-primary btn-sm" id="sig-refresh">${ICONS.refresh} Refrescar</button>
      </div>
      <div id="sig-counts" class="mb-12"></div>
      <div id="sig-list"><div class="skeleton" style="height: 300px;"></div></div>
    `;
    this.bind(root);
    this.load();
  },
  bind(root) {
    const search = root.querySelector('#sig-search');
    const platform = root.querySelector('#sig-platform');
    const decision = root.querySelector('#sig-decision');
    const kind = root.querySelector('#sig-kind');
    platform.value = this.filters.platform;
    decision.value = this.filters.decision;
    kind.value = this.filters.kind;
    const update = () => {
      this.filters.search = search.value.trim();
      this.filters.platform = platform.value;
      this.filters.decision = decision.value;
      this.filters.kind = kind.value;
      this.load();
    };
    search.addEventListener('input', () => { clearTimeout(this._t); this._t = setTimeout(update, 300); });
    platform.addEventListener('change', update);
    decision.addEventListener('change', update);
    kind.addEventListener('change', update);
    root.querySelector('#sig-refresh').addEventListener('click', () => this.load());
  },
  async load() {
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (this.filters.platform) params.set('platform', this.filters.platform);
      if (this.filters.decision) params.set('decision', this.filters.decision);
      if (this.filters.kind) params.set('kind', this.filters.kind);
      const data = await api(`/api/admin/signals?${params}`);
      let signals = data.signals || [];
      if (this.filters.search) {
        const s = this.filters.search.toLowerCase();
        signals = signals.filter(sig => (sig.text || '').toLowerCase().includes(s) || (sig.author || '').toLowerCase().includes(s) || (sig.id || '').toLowerCase().includes(s));
      }
      this.paint(signals, data.counts || {});
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paint(signals, counts) {
    const countEl = document.getElementById('sig-counts');
    if (countEl) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      countEl.innerHTML = `<div class="row" style="flex-wrap: wrap; gap: 6px;"><span class="badge badge-neutral">total: ${total}</span>${Object.entries(counts).map(([k, v]) => `<span class="badge badge-neutral">${esc(k)}: ${v}</span>`).join('')}</div>`;
    }
    const list = document.getElementById('sig-list');
    if (!list) return;
    if (signals.length === 0) {
      list.innerHTML = `<div class="empty" style="padding-top: 60px;"><div class="empty-icon">${ICONS.signal}</div><div class="empty-title">Sin señales</div><div class="empty-desc">Ninguna señal coincide con los filtros.</div></div>`;
      return;
    }
    list.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Recibida</th><th>Plataforma</th><th>Kind</th><th>Autor</th><th>Texto</th><th>Decisión</th><th></th></tr></thead>
          <tbody>
            ${signals.map(s => {
              const decClass = s.decision === 'publish' ? 'badge-success' : s.decision === 'error' ? 'badge-danger' : s.decision === 'pending' ? 'badge-warning' : s.decision === 'ignore' || s.decision === 'skip' ? 'badge-neutral' : 'badge-info';
              const decBadge = s.decision ? `<span class="badge ${decClass}">${esc(s.decision)}</span>` : '<span class="badge badge-neutral">pending</span>';
              return `<tr>
                <td class="cell-muted cell-mono text-xs">${rel(s.received_at)}</td>
                <td><span class="badge badge-info">${esc(s.platform)}</span></td>
                <td class="cell-mono text-xs">${esc(s.kind)}</td>
                <td class="cell-muted text-xs">${s.author ? '@' + esc(s.author) : '—'}</td>
                <td class="cell-truncate">${esc(truncate(s.text || '', 100))}</td>
                <td>${decBadge}</td>
                <td><button class="btn btn-ghost btn-sm" data-reprocess="${esc(s.id)}" title="Reprocesar">${ICONS.play_circle}</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
    list.querySelectorAll('[data-reprocess]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        target.disabled = true;
        try {
          await api(`/api/admin/signals/${encodeURIComponent(target.dataset.reprocess)}/reprocess`, { method: 'POST' });
          toast('Señal reprocesada', 'success');
          this.load();
        } catch (err) {
          if (err.message !== 'auth_required') toast(err.message, 'error');
          target.disabled = false;
        }
      });
    });
  },
};

// ------------------------------------------------------------
// VIEW: ACTIONS
// ------------------------------------------------------------

VIEWS.actions = {
  render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <select class="select" id="act-platform"><option value="">Todas</option><option value="twitter">Twitter</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></select>
        <button class="btn btn-primary btn-sm" id="act-refresh">${ICONS.refresh} Refrescar</button>
      </div>
      <div id="act-list"><div class="skeleton" style="height: 300px;"></div></div>
    `;
    root.querySelector('#act-refresh').addEventListener('click', () => this.load());
    root.querySelector('#act-platform').addEventListener('change', () => this.load());
    this.load();
  },
  async load() {
    try {
      const platform = document.getElementById('act-platform')?.value || '';
      const qs = platform ? `?platform=${platform}&limit=100` : '?limit=100';
      const data = await api(`/api/social/actions${qs}`);
      this.paint(data.actions || []);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paint(actions) {
    const list = document.getElementById('act-list');
    if (!list) return;
    if (actions.length === 0) {
      list.innerHTML = `<div class="empty" style="padding-top: 80px;"><div class="empty-icon">${ICONS.success}</div><div class="empty-title">Sin acciones publicadas</div></div>`;
      return;
    }
    list.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Fecha</th><th>Plataforma</th><th>Acción</th><th>Texto</th><th>Aprobado por</th><th></th></tr></thead>
          <tbody>
            ${actions.map(a => `<tr>
              <td class="cell-muted cell-mono">${fmtDate(a.published_at)}</td>
              <td><span class="badge badge-info">${esc(a.platform)}</span></td>
              <td class="cell-mono text-xs">${esc(a.action)}</td>
              <td class="cell-truncate">${esc(truncate(a.text, 120))}</td>
              <td class="cell-muted text-xs">${esc(a.approved_by || '—')}</td>
              <td>${a.external_url ? `<a href="${esc(a.external_url)}" target="_blank" rel="noopener" class="text-xs" style="color: var(--accent-hi);">Ver →</a>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  },
};

// ------------------------------------------------------------
// VIEW: SESSIONS
// ------------------------------------------------------------

VIEWS.sessions = {
  render(root) { root.innerHTML = `<div class="skeleton" style="height: 300px;"></div>`; this.load(); },
  async load() {
    try {
      const data = await api('/api/sessions').catch((e) => { if (e.status === 503) return { state: null }; throw e; });
      if (!data.state) { this.paintNoScraping(); return; }
      this.paint(data.state);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paintNoScraping() {
    document.getElementById('content').innerHTML = `
      <div class="alert alert-info"><div class="alert-icon">${ICONS.info}</div><div class="alert-body">
        <strong>Transport actual: API oficial.</strong> Las sesiones de scraping no están disponibles porque <span class="inline-code">VB_AMBER_TRANSPORT != scraping</span>.
      </div></div>
    `;
  },
  paint(s) {
    const content = document.getElementById('content');
    const platforms = s.platforms || {};
    const cards = Object.entries(platforms).map(([name, info]) => {
      const has = info.hasSession;
      const challenge = info.challenge?.active;
      const challengePct = challenge ? Math.round((info.challenge.remainingMs || 0) / 1000) : 0;
      return `<div class="session-card">
        <div class="session-head">
          <div class="session-platform"><div class="session-platform-icon">${ICONS.key}</div><span style="text-transform: capitalize;">${esc(name)}</span></div>
          ${has ? (challenge ? `<span class="badge badge-danger">challenge</span>` : `<span class="badge badge-success">activa</span>`) : `<span class="badge badge-neutral">sin sesión</span>`}
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Sesión</span><span class="v">${has ? 'guardada' : '—'}</span></div>
          <div class="session-row"><span class="k">Healthcheck</span><span class="v">${info.lastHealthCheck ? rel(info.lastHealthCheck) : 'nunca'}</span></div>
          ${challenge ? `<div class="session-row"><span class="k">Cooldown</span><span class="v">${challengePct}s</span></div>` : ''}
        </div>
        <div class="session-actions">
          ${!has ? `<button class="btn btn-primary btn-sm" data-action="login" data-platform="${esc(name)}">${ICONS.key} Login</button>` : ''}
          ${has ? `<button class="btn btn-secondary btn-sm" data-action="healthcheck" data-platform="${esc(name)}">${ICONS.refresh} Revalidar</button>` : ''}
          ${challenge ? `<button class="btn btn-warning btn-sm" data-action="clear-challenge" data-platform="${esc(name)}">Limpiar</button>` : ''}
          ${has ? `<button class="btn btn-danger btn-sm" data-action="invalidate" data-platform="${esc(name)}">${ICONS.trash} Invalidar</button>` : ''}
        </div>
      </div>`;
    }).join('');
    content.innerHTML = `<div class="sessions-grid">${cards}</div>`;
    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        const p = btn.dataset.platform;
        if (a === 'login') return this.startLogin(p, btn);
        if (a === 'healthcheck') return this.healthcheck(p, btn);
        if (a === 'invalidate') return this.invalidate(p, btn);
        if (a === 'clear-challenge') return this.clearChallenge(p, btn);
      });
    });
  },
  async startLogin(platform, btn) {
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}/login`, { method: 'POST' });
      toast(`Login iniciado en ${platform}`, 'info', 6000);
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const data = await api(`/api/sessions/${platform}/login`);
          if (data.job && data.job.status !== 'running') {
            clearInterval(poll);
            if (data.job.status === 'completed') toast(`Login OK en ${platform}`, 'success');
            else toast(`Login falló: ${data.job.result?.error || 'error'}`, 'error', 8000);
            this.load();
          }
        } catch (_) { clearInterval(poll); }
        if (tries > 90) clearInterval(poll);
      }, 2000);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
  },
  async healthcheck(platform, btn) {
    btn.disabled = true;
    try {
      const r = await api(`/api/sessions/${platform}/healthcheck`, { method: 'POST' });
      if (r.ok) toast(`${platform}: válida`, 'success'); else toast(`${platform}: ${r.reason}`, 'error');
      this.load();
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
  },
  async invalidate(platform, btn) {
    if (!confirm(`¿Invalidar sesión de ${platform}?`)) return;
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}`, { method: 'DELETE' });
      toast('Invalidada', 'success');
      this.load();
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
  },
  async clearChallenge(platform, btn) {
    btn.disabled = true;
    try {
      await api(`/api/sessions/${platform}/clear-challenge`, { method: 'POST' });
      toast('Challenge limpiado', 'success');
      this.load();
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
  },
};

// ------------------------------------------------------------
// VIEW: DIAGNOSTICS
// ------------------------------------------------------------

VIEWS.diagnostics = {
  render(root) { root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`; this.load(); },
  async load() {
    try {
      const data = await api('/api/admin/health');
      this.paint(data);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paint(h) {
    const content = document.getElementById('content');
    if (!h) return;
    const mem = h.node?.memory || {};
    const heapPct = mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;
    content.innerHTML = `
      <div class="metrics-grid">
        <div class="metric"><div class="metric-label">Uptime proceso</div><div class="metric-value">${fmtUptime(h.node?.uptimeSec || 0)}</div><div class="metric-hint">Node ${esc(h.node?.version || '')}</div></div>
        <div class="metric"><div class="metric-label">Heap</div><div class="metric-value">${heapPct}%</div><div class="metric-hint">${fmtBytes(mem.heapUsed || 0)} / ${fmtBytes(mem.heapTotal || 0)}</div></div>
        <div class="metric"><div class="metric-label">RSS</div><div class="metric-value">${fmtBytes(mem.rss || 0)}</div><div class="metric-hint">memoria residente</div></div>
        <div class="metric"><div class="metric-label">Circuit LLM</div><div class="metric-value ${h.llm?.circuit?.state === 'closed' ? 'success' : h.llm?.circuit?.state === 'open' ? 'danger' : 'warning'}">${esc(h.llm?.circuit?.state || '?')}</div><div class="metric-hint">${h.llm?.circuit?.consecutiveFailures || 0} fallos seguidos</div></div>
      </div>
      <div class="diag-grid">
        <div class="card">
          <div class="card-header"><div><div class="card-title">Sistema</div><div class="card-sub">Loop y módulos</div></div></div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Estado</span><span class="v">${h.system?.running ? 'running' : 'stopped'}</span></div>
            <div class="session-row"><span class="k">Ciclos</span><span class="v">${h.system?.cycleCount || 0}</span></div>
            <div class="session-row"><span class="k">Fallidos</span><span class="v">${h.system?.metrics?.failedCycles || 0}</span></div>
          </div>
          <div class="card-sub mt-16 mb-8">Módulos (${h.system?.modules?.length || 0})</div>
          <div class="module-grid">${(h.system?.modules || []).map(m => `<div class="module-card"><span class="module-name">${esc(m)}</span><span class="module-dot"></span></div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="card-header"><div><div class="card-title">LLM</div><div class="card-sub">${esc(h.llm?.provider || '')} · ${esc(h.llm?.model || '')}</div></div></div>
          <div class="meter"><div class="meter-head"><span class="meter-label">Llamadas</span><span class="meter-value">${h.llm?.metrics?.totalCalls || 0}</span></div></div>
          <div class="meter"><div class="meter-head"><span class="meter-label">Exitosas</span><span class="meter-value">${h.llm?.metrics?.successfulCalls || 0}</span></div><div class="meter-bar"><div class="meter-fill success" style="width: ${h.llm?.metrics?.totalCalls ? Math.round((h.llm.metrics.successfulCalls / h.llm.metrics.totalCalls) * 100) : 0}%"></div></div></div>
          <div class="meter"><div class="meter-head"><span class="meter-label">Fallidas</span><span class="meter-value">${h.llm?.metrics?.failedCalls || 0}</span></div><div class="meter-bar"><div class="meter-fill danger" style="width: ${h.llm?.metrics?.totalCalls ? Math.round((h.llm.metrics.failedCalls / h.llm.metrics.totalCalls) * 100) : 0}%"></div></div></div>
          <div class="meter"><div class="meter-head"><span class="meter-label">Latencia media</span><span class="meter-value">${h.llm?.metrics?.avgLatencyMs || 0}ms</span></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div><div class="card-title">DB</div><div class="card-sub">SQLite</div></div></div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Actions</span><span class="v">${h.db?.actions ?? 0}</span></div>
            <div class="session-row"><span class="k">Pending</span><span class="v">${h.db?.pending ?? 0}</span></div>
            <div class="session-row"><span class="k">Signals</span><span class="v">${h.db?.signals ?? 0}</span></div>
            <div class="session-row"><span class="k">Audit</span><span class="v">${h.db?.audit ?? 0}</span></div>
            <div class="session-row"><span class="k">Crisis</span><span class="v">${h.db?.crisis ?? 0}</span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div><div class="card-title">Crisis & Ingest</div><div class="card-sub">Subsistemas</div></div></div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Crisis activa</span><span class="v">${h.crisis?.paused ? 'sí' : 'no'}</span></div>
            <div class="session-row"><span class="k">Negativas</span><span class="v">${h.crisis?.negativeSignalsInWindow || 0} / ${h.crisis?.negativeThreshold || 0}</span></div>
            <div class="session-row"><span class="k">Señales nuevas</span><span class="v">${h.ingester?.metrics?.signalsNew || 0}</span></div>
            <div class="session-row"><span class="k">Clasificadas</span><span class="v">${h.classifier?.metrics?.classified || 0}</span></div>
            <div class="session-row"><span class="k">Eventos bus</span><span class="v">${h.eventBus?.emitted || 0}</span></div>
          </div>
        </div>
      </div>
    `;
  },
};

// ------------------------------------------------------------
// VIEW: CRISIS
// ------------------------------------------------------------

VIEWS.crisis = {
  render(root) { root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`; this.load(); },
  async load() {
    try {
      const data = await api('/api/admin/crisis');
      this.paint(data);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paint(data) {
    const content = document.getElementById('content');
    const current = data.current || {};
    const events = data.events || [];
    const isPaused = current.paused;
    content.innerHTML = `
      <div class="crisis-hero ${isPaused ? '' : 'ok'}">
        <div class="crisis-hero-icon">${isPaused ? ICONS.warning : ICONS.check}</div>
        <div class="crisis-hero-body">
          <div class="crisis-hero-title">${isPaused ? 'Crisis activa — loop pausado' : 'Sistema operativo'}</div>
          <div class="crisis-hero-desc">${isPaused ? `Razón: <strong>${esc(current.pauseReason || '—')}</strong>. Pausa restante: <strong>${Math.ceil((current.pauseRemainingMs || 0) / 60000)}min</strong>.` : 'Sin crisis activa.'}</div>
          <div class="crisis-hero-actions">
            ${isPaused ? `<button class="btn btn-success" id="crisis-resume">${ICONS.play} Resolver</button>` : `<button class="btn btn-warning" id="crisis-force">${ICONS.warning} Forzar crisis</button>`}
          </div>
        </div>
      </div>
      <div class="card mb-16">
        <div class="card-header"><div><div class="card-title">Umbral</div></div></div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Negativas en ventana</span><span class="v">${current.negativeSignalsInWindow || 0} / ${current.negativeThreshold || 0}</span></div>
          <div class="session-row"><span class="k">Ventana</span><span class="v">${current.windowMin || 0} min</span></div>
          <div class="session-row"><span class="k">Detectadas</span><span class="v">${current.metrics?.crisisDetected || 0}</span></div>
          <div class="session-row"><span class="k">Resueltas</span><span class="v">${current.metrics?.crisisResolved || 0}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Historial</div><div class="card-sub">${events.length} evento${events.length === 1 ? '' : 's'}</div></div></div>
        ${events.length === 0 ? `<div class="empty"><div class="empty-title">Sin crisis registradas</div></div>` : `<div>${events.map(e => `<div class="crisis-event"><div class="crisis-event-body"><div class="crisis-event-title">${esc(e.reason)}</div><div class="crisis-event-meta">${fmtDate(e.detected_at)}${e.signal_ids?.length ? ` · ${e.signal_ids.length} señales` : ''}${e.resumed_at ? ` · resuelta ${rel(e.resumed_at)}` : ' · <span style="color: var(--danger-hi);">activa</span>'}</div></div><span class="badge ${e.resumed_at ? 'badge-success' : 'badge-danger'}">${e.resumed_at ? 'resuelta' : 'activa'}</span></div>`).join('')}</div>`}
      </div>
    `;
    content.querySelector('#crisis-resume')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/admin/crisis/resume', { method: 'POST' });
        toast('Crisis resuelta', 'success');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
    });
    content.querySelector('#crisis-force')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const reason = prompt('Razón:', 'intervencion_manual');
      if (!reason) return;
      btn.disabled = true;
      try {
        await api('/api/admin/crisis/force', { method: 'POST', body: { reason } });
        toast('Crisis forzada', 'warning');
        this.load();
      } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); btn.disabled = false; }
    });
  },
};

// ------------------------------------------------------------
// VIEW: PLAYGROUND
// ------------------------------------------------------------

VIEWS.playground = {
  render(root) {
    root.innerHTML = `
      <div class="playground-split">
        <div class="playground-panel">
          <div class="playground-panel-header"><div><div class="card-title">Input</div><div class="card-sub">Configura la señal</div></div></div>
          <div class="stack">
            <div class="label-row">
              <div><label class="label">Plataforma</label><select class="select" id="pg-platform"><option value="twitter">Twitter</option><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></select></div>
              <div><label class="label">Kind</label><select class="select" id="pg-kind"><option value="proactive_post">proactive_post</option><option value="mention">mention</option><option value="dm">dm</option><option value="comment">comment</option></select></div>
            </div>
            <div><label class="label">Author</label><input class="input" id="pg-author" placeholder="@usuario"></div>
            <div><label class="label">Texto de la señal</label><textarea class="textarea" id="pg-text" placeholder="Hola, me encanta tu contenido..."></textarea></div>
            <div><label class="label">Task custom</label><textarea class="textarea" id="pg-task" style="min-height: 60px;" placeholder="Instrucción específica al LLM"></textarea></div>
            <div class="row" style="flex-wrap: wrap; gap: 8px;">
              <button class="btn btn-secondary" id="pg-preview">${ICONS.code} Preview prompts</button>
              <button class="btn btn-primary" id="pg-test">${ICONS.zap} Generar (consume tokens)</button>
            </div>
          </div>
        </div>
        <div class="playground-panel">
          <div class="playground-panel-header"><div><div class="card-title">Output</div><div class="card-sub" id="pg-output-sub">Esperando…</div></div></div>
          <div id="pg-output" style="flex: 1; display: flex; flex-direction: column;">
            <div class="empty" style="padding-top: 40px; margin: auto 0;"><div class="empty-icon">${ICONS.zap}</div><div class="empty-title">Sin resultados</div><div class="empty-desc">Preview o genera un draft.</div></div>
          </div>
        </div>
      </div>
    `;
    root.querySelector('#pg-preview').addEventListener('click', () => this.preview());
    root.querySelector('#pg-test').addEventListener('click', () => this.test());
  },
  refresh() {},
  buildBody() {
    return {
      platform: document.getElementById('pg-platform').value,
      kind: document.getElementById('pg-kind').value,
      author: document.getElementById('pg-author').value.trim() || null,
      text: document.getElementById('pg-text').value.trim() || null,
      task: document.getElementById('pg-task').value.trim() || null,
    };
  },
  async preview() {
    const btn = document.getElementById('pg-preview');
    btn.disabled = true;
    const out = document.getElementById('pg-output');
    const sub = document.getElementById('pg-output-sub');
    sub.textContent = 'Generando…';
    try {
      const data = await api('/api/admin/llm/preview', { method: 'POST', body: this.buildBody() });
      sub.textContent = `${data.provider} · ${data.model} · ${data.estimatedInputChars} chars`;
      out.innerHTML = `
        <div class="text-xs muted mb-8">SYSTEM PROMPT</div>
        <div class="output-pre" style="min-height: 200px; max-height: 300px; overflow: auto; margin-bottom: 14px;">${esc(data.systemPrompt)}</div>
        <div class="text-xs muted mb-8">USER MESSAGE</div>
        <div class="output-pre" style="min-height: 80px; max-height: 150px; overflow: auto;">${esc(data.userMessage)}</div>
      `;
    } catch (err) {
      if (err.message !== 'auth_required') { sub.textContent = 'Error'; toast(err.message, 'error'); }
    } finally { btn.disabled = false; }
  },
  async test() {
    const btn = document.getElementById('pg-test');
    btn.disabled = true;
    const out = document.getElementById('pg-output');
    const sub = document.getElementById('pg-output-sub');
    sub.textContent = 'Llamando al LLM…';
    out.innerHTML = `<div class="empty" style="padding-top: 40px; margin: auto 0;"><div class="empty-icon">${ICONS.zap}</div><div class="empty-title">Generando…</div></div>`;
    try {
      const data = await api('/api/admin/llm/test', { method: 'POST', body: this.buildBody() });
      if (!data.ok) {
        sub.textContent = `Error: ${data.error}`;
        out.innerHTML = `<div class="alert alert-danger"><div class="alert-icon">${ICONS.error}</div><div class="alert-body">${esc(data.error)}</div></div>`;
        return;
      }
      const guard = data.guard;
      const usage = data.usage || {};
      const usageStr = usage.total_tokens ? `${usage.total_tokens} tokens` : '—';
      sub.textContent = `${data.latencyMs}ms · v${data.personaVersion}`;
      out.innerHTML = `
        <div class="row mb-12" style="flex-wrap: wrap; gap: 6px;">
          <span class="usage-chip">${ICONS.clock} ${data.latencyMs}ms</span>
          <span class="usage-chip">${esc(usageStr)}</span>
          ${data.skipped ? '<span class="badge badge-warning">SKIPPED</span>' : '<span class="badge badge-success">ok</span>'}
        </div>
        <div class="output-draft">${esc(data.text || '(vacío)')}</div>
        ${guard ? `
          <div class="text-xs muted mb-8 mt-16">GUARD</div>
          <div class="alert ${guard.ok ? 'alert-success' : 'alert-danger'}">
            <div class="alert-icon">${guard.ok ? ICONS.check : ICONS.error}</div>
            <div class="alert-body"><strong>${guard.ok ? 'Aprobado' : 'Rechazado'}</strong> · <span class="inline-code">${esc(guard.decision)}</span></div>
          </div>
          ${guard.errors?.length ? `<div class="guard-checks mt-12">${guard.errors.map(e => `<div class="guard-check err"><span class="guard-check-icon">${ICONS.error}</span><span><strong>${esc(e.code)}</strong>: ${esc(e.detail || '')}</span></div>`).join('')}</div>` : ''}
          ${guard.warnings?.length ? `<div class="guard-checks mt-12">${guard.warnings.map(w => `<div class="guard-check warn"><span class="guard-check-icon">${ICONS.warning}</span><span><strong>${esc(w.code)}</strong>: ${esc(w.detail || '')}</span></div>`).join('')}</div>` : ''}
        ` : ''}
      `;
    } catch (err) {
      if (err.message !== 'auth_required') {
        sub.textContent = 'Error';
        out.innerHTML = `<div class="alert alert-danger"><div class="alert-icon">${ICONS.error}</div><div class="alert-body">${esc(err.message)}</div></div>`;
      }
    } finally { btn.disabled = false; }
  },
};

// ------------------------------------------------------------
// VIEW: AUDIT
// ------------------------------------------------------------

VIEWS.audit = {
  render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <select class="select" id="audit-category"><option value="">Todas</option><option value="system">system</option><option value="social">social</option><option value="persona">persona</option><option value="crisis">crisis</option></select>
        <button class="btn btn-primary btn-sm" id="audit-refresh">${ICONS.refresh} Refrescar</button>
      </div>
      <div id="audit-list"><div class="skeleton" style="height: 300px;"></div></div>
    `;
    root.querySelector('#audit-refresh').addEventListener('click', () => this.load());
    root.querySelector('#audit-category').addEventListener('change', () => this.load());
    this.load();
  },
  async load() {
    try {
      const category = document.getElementById('audit-category')?.value || '';
      const qs = category ? `?category=${category}&limit=200` : '?limit=200';
      const data = await api(`/api/social/audit${qs}`);
      this.paint(data.audit || []);
    } catch (err) { if (err.message !== 'auth_required') toast(err.message, 'error'); }
  },
  refresh() { this.load(); },
  paint(items) {
    const list = document.getElementById('audit-list');
    if (!list) return;
    if (items.length === 0) {
      list.innerHTML = `<div class="empty" style="padding-top: 80px;"><div class="empty-icon">${ICONS.info}</div><div class="empty-title">Sin eventos</div></div>`;
      return;
    }
    list.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Fecha</th><th>Categoría</th><th>Evento</th><th>Severidad</th><th>Detalles</th></tr></thead>
          <tbody>${items.map(a => {
            const sevClass = a.severity === 'error' ? 'badge-danger' : a.severity === 'warn' ? 'badge-warning' : a.severity === 'info' ? 'badge-info' : 'badge-neutral';
            const detailText = a.details ? `<details><summary class="text-xs muted" style="cursor: pointer;">ver</summary><pre class="mono text-xs mt-4" style="background: var(--bg-1); padding: 8px; border-radius: 6px; max-width: 400px; overflow: auto;">${esc(JSON.stringify(a.details, null, 2))}</pre></details>` : '—';
            return `<tr><td class="cell-muted cell-mono">${fmtDate(a.timestamp)}</td><td class="cell-mono text-xs">${esc(a.category)}</td><td class="text-sm">${esc(a.event)}</td><td><span class="badge ${sevClass}">${esc(a.severity)}</span></td><td>${detailText}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    `;
  },
};

// ------------------------------------------------------------
// VIEW: SETTINGS
// ------------------------------------------------------------

VIEWS.settings = {
  render(root) {
    root.innerHTML = `
      <div class="card mb-16">
        <div class="card-header"><div><div class="card-title">API Key</div><div class="card-sub">Se guarda en localStorage</div></div></div>
        <div class="stack">
          <div><label class="label">VB_AMBER_ADMIN_API_KEY</label><input class="input" id="settings-api-key" type="password" value="${esc(state.apiKey)}" autocomplete="off"></div>
          <div class="row"><button class="btn btn-primary" id="settings-save-key">Guardar</button><button class="btn btn-secondary" id="settings-clear-key">Borrar</button></div>
        </div>
      </div>
      <div class="card mb-16">
        <div class="card-header"><div><div class="card-title">Export / Backup</div><div class="card-sub">Descarga la DB en JSON</div></div></div>
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <a class="btn btn-primary" href="/api/admin/export" download>${ICONS.download} Export completo</a>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div><div class="card-title">Sistema</div><div class="card-sub">Solo lectura</div></div></div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Transport</span><span class="v">${esc(state.config.transport)}</span></div>
          <div class="session-row"><span class="k">NODE_ENV</span><span class="v">${esc(state.lastHealth?.env || '—')}</span></div>
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
      } catch (err) { toast('API Key inválida', 'error'); }
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
// SETUP
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
    } catch (err) {}
  }

  await pollHealth();
  state.timers.health = setInterval(pollHealth, HEALTH_MS);

  const initial = location.hash.replace(/^#\//, '') || 'overview';
  navigate(initial);
}

boot();
