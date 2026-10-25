// src/http/static/app.js
// SPA vanilla del dashboard. Sin dependencias externas. Hash routing.

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
  timers: {
    health: null,
    route: null,
  },
  lastHealth: null,
  lastHealthAt: 0,
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

function fmtUptime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtBytes(b) {
  if (!b || b < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${units[i]}`;
}

function truncate(s, n = 100) {
  if (!s) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
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
      if (e.status === 404) return;
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
    if (badge && crisis?.paused) {
      badge.removeAttribute('hidden');
    } else if (badge) {
      badge.setAttribute('hidden', '');
    }
  } catch (_) {}
}

function updateSidebarStatus(data) {
  const el = document.getElementById('sidebar-status');
  if (!el) return;
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
// ROUTER
// ============================================================

const ROUTES = {
  overview: { title: 'Overview', sub: 'Estado general del agente' },
  pending: { title: 'Pending', sub: 'Acciones esperando aprobación' },
  signals: { title: 'Signals', sub: 'Señales ingeridas del sistema' },
  actions: { title: 'Actions', sub: 'Historial de acciones publicadas' },
  persona: { title: 'Persona', sub: 'Configuración de identidad y voz' },
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
      }

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
      <div class="metric">
        <div class="metric-label">Uptime</div>
        <div class="metric-value">${health ? fmtUptime(Math.round(health.uptimeMs / 1000)) : '—'}</div>
        <div class="metric-hint">${health?.ready ? 'ready' : 'no ready'}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Ciclos</div>
        <div class="metric-value">${s?.metrics?.totalCycles ?? 0}</div>
        <div class="metric-hint">${s?.metrics?.failedCycles ?? 0} fallidos</div>
      </div>
      <div class="metric">
        <div class="metric-label">Pending</div>
        <div class="metric-value ${pendingCount > 0 ? 'warning' : ''}">${pendingCount}</div>
        <div class="metric-hint">${pendingCount > 0 ? 'requiere atención' : 'todo al día'}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Acciones</div>
        <div class="metric-value">${s?.metrics?.draftsPublished ?? 0}</div>
        <div class="metric-hint">publicadas</div>
      </div>
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
          <div>
            <div class="card-title">Estado del sistema</div>
            <div class="card-sub">Loop autónomo y subsistemas</div>
          </div>
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
      if (s.paused) {
        pauseBtn.innerHTML = `${ICONS.play} Reanudar`;
        pauseBtn.dataset.action = 'resume';
      } else {
        pauseBtn.innerHTML = `${ICONS.pause} Pausar`;
        pauseBtn.dataset.action = 'pause';
      }
    }
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
    root.querySelector('#btn-tick')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
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

    root.querySelector('#btn-resume-crisis')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/social/crisis/resume', { method: 'POST' });
        toast('Crisis resuelta', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    root.querySelector('#btn-view-diagnostics')?.addEventListener('click', () => {
      location.hash = '#/diagnostics';
    });

    root.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        location.hash = `#/${btn.dataset.nav}`;
      });
    });
  },
};

// ------------------------------------------------------------
// VIEW: PERSONA (con editor visual + toggles)
// ------------------------------------------------------------

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
        this.showEditor(null);
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
          <button class="btn btn-secondary" id="btn-persona-edit">${ICONS.settings} Editar JSON</button>
          <button class="btn btn-secondary" id="btn-persona-view-json">${ICONS.code} Ver JSON</button>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div>
            <div class="card-title">Modo operativo</div>
            <div class="card-sub">Cambia sin reescribir toda la persona</div>
          </div>
        </div>
        <div class="label-row">
          <div>
            <label class="label">Operating Mode</label>
            <select class="select" id="sel-operating-mode">
              <option value="draft" ${persona.operatingMode === 'draft' ? 'selected' : ''}>draft (requiere aprobación)</option>
              <option value="auto" ${persona.operatingMode === 'auto' ? 'selected' : ''}>auto (publica sin aprobación)</option>
            </select>
          </div>
          <div>
            <label class="label">Safety Level</label>
            <select class="select" id="sel-safety-level">
              <option value="strict" ${persona.safetyLevel === 'strict' ? 'selected' : ''}>strict</option>
              <option value="normal" ${persona.safetyLevel === 'normal' ? 'selected' : ''}>normal</option>
              <option value="permissive" ${persona.safetyLevel === 'permissive' ? 'selected' : ''}>permissive</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary mt-12" id="btn-persona-mode-save">Guardar modo</button>
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
        <div class="card-header">
          <div>
            <div class="card-title">Plataformas</div>
            <div class="card-sub">Activa o desactiva sin editar el JSON</div>
          </div>
        </div>
        <div class="stack">
          ${['twitter', 'instagram', 'linkedin'].map(p => {
            const cfg = persona.platforms?.[p] || {};
            const enabled = !!cfg.enabled;
            return `
              <div class="row-between" style="padding: 10px 0; border-bottom: 1px solid var(--border);">
                <div class="row">
                  <span style="text-transform: capitalize; font-weight: 500;">${p}</span>
                </div>
                <div class="row">
                  <span class="badge ${enabled ? 'badge-success' : 'badge-neutral'}" id="plat-badge-${p}">${enabled ? 'enabled' : 'disabled'}</span>
                  <button class="btn btn-sm ${enabled ? 'btn-danger' : 'btn-success'}" data-platform="${p}" data-enabled="${enabled}">
                    ${enabled ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
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
          <div class="stack-sm">
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

    content.querySelector('#btn-persona-edit')?.addEventListener('click', () => this.showEditor(persona));
    content.querySelector('#btn-persona-view-json')?.addEventListener('click', () => this.showJsonView(persona));

    content.querySelector('#btn-persona-mode-save')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const operatingMode = document.getElementById('sel-operating-mode').value;
        const safetyLevel = document.getElementById('sel-safety-level').value;
        await api('/api/admin/persona/mode', {
          method: 'PATCH',
          body: { operatingMode, safetyLevel },
        });
        toast('Modo actualizado', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    content.querySelectorAll('[data-platform]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        const platform = target.dataset.platform;
        const currentEnabled = target.dataset.enabled === 'true';
        target.disabled = true;
        try {
          await api(`/api/admin/persona/platforms/${platform}`, {
            method: 'PATCH',
            body: { enabled: !currentEnabled },
          });
          toast(`${platform} ${!currentEnabled ? 'activada' : 'desactivada'}`, 'success');
          this.load();
        } catch (err) {
          if (err.message !== 'auth_required') toast(err.message, 'error');
          target.disabled = false;
        }
      });
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
    const data = persona || this.defaultPersona();
    const json = JSON.stringify(data, null, 2);
    openModal(`
      <div class="modal modal-wide">
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
      <div class="modal modal-wide">
        <div class="modal-head">
          <div class="modal-title">PersonaConfig</div>
          <div class="modal-desc">Versión ${persona.version ?? '?'} · solo lectura</div>
        </div>
        <div class="modal-body">
          <pre class="output-pre" style="min-height: 400px;">${esc(JSON.stringify(persona, null, 2))}</pre>
        </div>
        <div class="modal-foot">
          <button class="btn btn-primary" onclick="closeModal()">Cerrar</button>
        </div>
      </div>
    `);
  },
};

// ------------------------------------------------------------
// VIEW: PENDING
// ------------------------------------------------------------

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
        <button class="btn btn-secondary btn-sm" id="btn-cleanup-expired">Limpiar expirados</button>
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
    content.querySelector('#btn-cleanup-expired')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await api('/api/admin/cleanup', {
          method: 'POST',
          body: { expiredPendings: true },
        });
        toast(`Limpiados: ${r.report?.expiredPendings || 0}`, 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
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

// ------------------------------------------------------------
// VIEW: SIGNALS
// ------------------------------------------------------------

VIEWS.signals = {
  filters: { platform: '', decision: '', kind: '', search: '' },

  render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <input class="input" id="sig-search" placeholder="Buscar en texto/autor/ID…" value="${esc(this.filters.search)}">
        <select class="select" id="sig-platform">
          <option value="">Todas las plataformas</option>
          <option value="twitter">Twitter</option>
          <option value="instagram">Instagram</option>
          <option value="linkedin">LinkedIn</option>
        </select>
        <select class="select" id="sig-decision">
          <option value="">Todas las decisiones</option>
          <option value="publish">publish</option>
          <option value="pending">pending</option>
          <option value="reject">reject</option>
          <option value="ignore">ignore</option>
          <option value="skip">skip</option>
          <option value="escalate">escalate</option>
          <option value="error">error</option>
        </select>
        <select class="select" id="sig-kind">
          <option value="">Todos los kinds</option>
          <option value="mention">mention</option>
          <option value="dm">dm</option>
          <option value="comment">comment</option>
          <option value="proactive_post">proactive_post</option>
        </select>
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

    search.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(update, 300);
    });
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
        signals = signals.filter(sig =>
          (sig.text || '').toLowerCase().includes(s) ||
          (sig.author || '').toLowerCase().includes(s) ||
          (sig.id || '').toLowerCase().includes(s)
        );
      }

      this.paint(signals, data.counts || {});
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(signals, counts) {
    const countEl = document.getElementById('sig-counts');
    if (countEl) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      countEl.innerHTML = `
        <div class="row" style="flex-wrap: wrap; gap: 6px;">
          <span class="badge badge-neutral">total: ${total}</span>
          ${Object.entries(counts).map(([k, v]) =>
            `<span class="badge badge-neutral">${esc(k)}: ${v}</span>`
          ).join('')}
        </div>
      `;
    }

    const list = document.getElementById('sig-list');
    if (!list) return;

    if (signals.length === 0) {
      list.innerHTML = `
        <div class="empty" style="padding-top: 60px;">
          <div class="empty-icon">${ICONS.signal}</div>
          <div class="empty-title">Sin señales</div>
          <div class="empty-desc">${this.filters.search || this.filters.platform || this.filters.decision || this.filters.kind ? 'Ninguna señal coincide con los filtros.' : 'Aún no se han ingerido señales. El loop las recoge cada 90s.'}</div>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Recibida</th>
              <th>Plataforma</th>
              <th>Kind</th>
              <th>Autor</th>
              <th>Texto</th>
              <th>Decisión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${signals.map(s => {
              const decClass = s.decision === 'publish' ? 'badge-success'
                : s.decision === 'error' ? 'badge-danger'
                : s.decision === 'pending' ? 'badge-warning'
                : s.decision === 'ignore' || s.decision === 'skip' ? 'badge-neutral'
                : 'badge-info';
              const decBadge = s.decision
                ? `<span class="badge ${decClass}">${esc(s.decision)}</span>`
                : '<span class="badge badge-neutral">pending</span>';
              return `
                <tr>
                  <td class="cell-muted cell-mono text-xs">${rel(s.received_at)}</td>
                  <td><span class="badge badge-info">${esc(s.platform)}</span></td>
                  <td class="cell-mono text-xs">${esc(s.kind)}</td>
                  <td class="cell-muted text-xs">${s.author ? '@' + esc(s.author) : '—'}</td>
                  <td class="cell-truncate">${esc(truncate(s.text || '', 100))}</td>
                  <td>${decBadge}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" data-reprocess="${esc(s.id)}" title="Reprocesar">${ICONS.play_circle}</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll('[data-reprocess]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget;
        const id = target.dataset.reprocess;
        target.disabled = true;
        try {
          await api(`/api/admin/signals/${encodeURIComponent(id)}/reprocess`, {
            method: 'POST',
          });
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
        <select class="select" id="act-platform">
          <option value="">Todas las plataformas</option>
          <option value="twitter">Twitter</option>
          <option value="instagram">Instagram</option>
          <option value="linkedin">LinkedIn</option>
        </select>
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
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(actions) {
    const list = document.getElementById('act-list');
    if (!list) return;

    if (actions.length === 0) {
      list.innerHTML = `
        <div class="empty" style="padding-top: 80px;">
          <div class="empty-icon">${ICONS.success}</div>
          <div class="empty-title">Sin acciones publicadas</div>
          <div class="empty-desc">Cuando se apruebe y publique la primera acción, aparecerá aquí.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = `
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

// ------------------------------------------------------------
// VIEW: SESSIONS
// ------------------------------------------------------------

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
      <div class="alert alert-info">
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

// ------------------------------------------------------------
// VIEW: DIAGNOSTICS
// ------------------------------------------------------------

VIEWS.diagnostics = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/admin/health');
      this.paint(data);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(h) {
    const content = document.getElementById('content');
    if (!h) return;

    const mem = h.node?.memory || {};
    const heapPct = mem.heapTotal ? Math.round((mem.heapUsed / mem.heapTotal) * 100) : 0;

    content.innerHTML = `
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-label">Uptime proceso</div>
          <div class="metric-value">${fmtUptime(h.node?.uptimeSec || 0)}</div>
          <div class="metric-hint">Node ${esc(h.node?.version || '')}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Heap</div>
          <div class="metric-value">${heapPct}%</div>
          <div class="metric-hint">${fmtBytes(mem.heapUsed || 0)} / ${fmtBytes(mem.heapTotal || 0)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">RSS</div>
          <div class="metric-value">${fmtBytes(mem.rss || 0)}</div>
          <div class="metric-hint">memoria residente</div>
        </div>
        <div class="metric">
          <div class="metric-label">Circuit LLM</div>
          <div class="metric-value ${h.llm?.circuit?.state === 'closed' ? 'success' : h.llm?.circuit?.state === 'open' ? 'danger' : 'warning'}">${esc(h.llm?.circuit?.state || '?')}</div>
          <div class="metric-hint">${h.llm?.circuit?.consecutiveFailures || 0} fallos seguidos</div>
        </div>
      </div>

      <div class="diag-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Sistema</div>
              <div class="card-sub">Loop y módulos</div>
            </div>
          </div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Estado</span><span class="v">${h.system?.running ? 'running' : 'stopped'}</span></div>
            <div class="session-row"><span class="k">Ciclos</span><span class="v">${h.system?.cycleCount || 0}</span></div>
            <div class="session-row"><span class="k">Último ciclo</span><span class="v">${h.system?.lastCycleMs || 0}ms</span></div>
            <div class="session-row"><span class="k">Fallidos</span><span class="v">${h.system?.metrics?.failedCycles || 0}</span></div>
          </div>
          <div class="card-sub mt-16 mb-8">Módulos registrados (${h.system?.modules?.length || 0})</div>
          <div class="module-grid">
            ${(h.system?.modules || []).map(m => `
              <div class="module-card">
                <span class="module-name">${esc(m)}</span>
                <span class="module-dot"></span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">LLM</div>
              <div class="card-sub">${esc(h.llm?.provider || '')} · ${esc(h.llm?.model || '')}</div>
            </div>
          </div>
          <div class="meter">
            <div class="meter-head">
              <span class="meter-label">Llamadas totales</span>
              <span class="meter-value">${h.llm?.metrics?.totalCalls || 0}</span>
            </div>
          </div>
          <div class="meter">
            <div class="meter-head">
              <span class="meter-label">Exitosas</span>
              <span class="meter-value">${h.llm?.metrics?.successfulCalls || 0}</span>
            </div>
            <div class="meter-bar"><div class="meter-fill success" style="width: ${h.llm?.metrics?.totalCalls ? Math.round((h.llm.metrics.successfulCalls / h.llm.metrics.totalCalls) * 100) : 0}%"></div></div>
          </div>
          <div class="meter">
            <div class="meter-head">
              <span class="meter-label">Fallidas</span>
              <span class="meter-value">${h.llm?.metrics?.failedCalls || 0}</span>
            </div>
            <div class="meter-bar"><div class="meter-fill danger" style="width: ${h.llm?.metrics?.totalCalls ? Math.round((h.llm.metrics.failedCalls / h.llm.metrics.totalCalls) * 100) : 0}%"></div></div>
          </div>
          <div class="meter">
            <div class="meter-head">
              <span class="meter-label">Rechazos por breaker</span>
              <span class="meter-value">${h.llm?.metrics?.rejectionsByBreaker || 0}</span>
            </div>
          </div>
          <div class="meter">
            <div class="meter-head">
              <span class="meter-label">Latencia media</span>
              <span class="meter-value">${h.llm?.metrics?.avgLatencyMs || 0}ms</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">DB</div>
              <div class="card-sub">SQLite</div>
            </div>
          </div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Actions</span><span class="v">${h.db?.actions ?? 0}</span></div>
            <div class="session-row"><span class="k">Pending</span><span class="v">${h.db?.pending ?? 0}</span></div>
            <div class="session-row"><span class="k">Signals</span><span class="v">${h.db?.signals ?? 0}</span></div>
            <div class="session-row"><span class="k">Audit</span><span class="v">${h.db?.audit ?? 0}</span></div>
            <div class="session-row"><span class="k">Crisis</span><span class="v">${h.db?.crisis ?? 0}</span></div>
          </div>
          <div class="card-sub mt-16 mb-8">Signals por decisión</div>
          <div class="stack-sm">
            ${Object.entries(h.dbCounts?.signalsByDecision || {}).map(([k, v]) => `
              <div class="row-between">
                <span class="badge badge-neutral">${esc(k)}</span>
                <span class="mono text-sm">${v}</span>
              </div>
            `).join('') || '<div class="muted text-sm">Sin datos</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Crisis & Ingestion</div>
              <div class="card-sub">Estado de subsistemas</div>
            </div>
          </div>
          <div class="session-rows">
            <div class="session-row"><span class="k">Crisis activa</span><span class="v">${h.crisis?.paused ? 'sí' : 'no'}</span></div>
            <div class="session-row"><span class="k">Negativas ventana</span><span class="v">${h.crisis?.negativeSignalsInWindow || 0} / ${h.crisis?.negativeThreshold || 0}</span></div>
            <div class="session-row"><span class="k">Señales nuevas</span><span class="v">${h.ingester?.metrics?.signalsNew || 0}</span></div>
            <div class="session-row"><span class="k">Clasificadas</span><span class="v">${h.classifier?.metrics?.classified || 0}</span></div>
            <div class="session-row"><span class="k">Eventos bus</span><span class="v">${h.eventBus?.emitted || 0}</span></div>
          </div>
        </div>
      </div>

      <div class="card mt-16">
        <div class="card-header">
          <div>
            <div class="card-title">Node process</div>
            <div class="card-sub">Detalles de ejecución</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="diag-refresh">${ICONS.refresh} Refrescar</button>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">PID</span><span class="v mono">${h.node?.pid || '—'}</span></div>
          <div class="session-row"><span class="k">Plataforma</span><span class="v">${esc(h.node?.platform || '')}</span></div>
          <div class="session-row"><span class="k">Uptime</span><span class="v">${fmtUptime(h.node?.uptimeSec || 0)}</span></div>
        </div>
      </div>
    `;

    content.querySelector('#diag-refresh')?.addEventListener('click', () => this.load());
  },
};

// ------------------------------------------------------------
// VIEW: CRISIS
// ------------------------------------------------------------

VIEWS.crisis = {
  render(root) {
    root.innerHTML = `<div class="skeleton" style="height: 400px;"></div>`;
    this.load();
  },

  async load() {
    try {
      const data = await api('/api/admin/crisis');
      this.paint(data);
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(data) {
    const content = document.getElementById('content');
    const current = data.current || {};
    const events = data.events || [];

    const isPaused = current.paused;
    const heroClass = isPaused ? '' : 'ok';

    content.innerHTML = `
      <div class="crisis-hero ${heroClass}">
        <div class="crisis-hero-icon">${isPaused ? ICONS.warning : ICONS.check}</div>
        <div class="crisis-hero-body">
          <div class="crisis-hero-title">${isPaused ? 'Crisis activa — loop pausado' : 'Sistema operativo'}</div>
          <div class="crisis-hero-desc">
            ${isPaused
              ? `Razón: <strong>${esc(current.pauseReason || '—')}</strong>. Pausa restante: <strong>${Math.ceil((current.pauseRemainingMs || 0) / 60000)}min</strong>. El loop reanudará automáticamente al expirar.`
              : 'Sin crisis activa. El loop opera normalmente. Las crisis se disparan por amenazas legales, DMs urgentes, umbral de negativas o challenge de scraping.'}
          </div>
          <div class="crisis-hero-actions">
            ${isPaused
              ? `<button class="btn btn-success" id="crisis-resume">${ICONS.play} Resolver ahora</button>`
              : `<button class="btn btn-warning" id="crisis-force">${ICONS.warning} Forzar crisis manual</button>`}
          </div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div>
            <div class="card-title">Umbral de crisis</div>
            <div class="card-sub">Negativas por ventana</div>
          </div>
        </div>
        <div class="session-rows">
          <div class="session-row"><span class="k">Negativas en ventana</span><span class="v">${current.negativeSignalsInWindow || 0} / ${current.negativeThreshold || 0}</span></div>
          <div class="session-row"><span class="k">Ventana</span><span class="v">${current.windowMin || 0} min</span></div>
          <div class="session-row"><span class="k">Crisis detectadas</span><span class="v">${current.metrics?.crisisDetected || 0}</span></div>
          <div class="session-row"><span class="k">Crisis resueltas</span><span class="v">${current.metrics?.crisisResolved || 0}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Historial</div>
            <div class="card-sub">${events.length} evento${events.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        ${events.length === 0 ? `
          <div class="empty">
            <div class="empty-title">Sin crisis registradas</div>
            <div class="empty-desc">Las crisis aparecen aquí al detectarse.</div>
          </div>
        ` : `
          <div>
            ${events.map(e => `
              <div class="crisis-event">
                <div class="crisis-event-body">
                  <div class="crisis-event-title">${esc(e.reason)}</div>
                  <div class="crisis-event-meta">
                    ${fmtDate(e.detected_at)}
                    ${e.signal_ids?.length ? ` · ${e.signal_ids.length} señal(es)` : ''}
                    ${e.resumed_at ? ` · resuelta ${rel(e.resumed_at)}` : ' · <span style="color: var(--danger-hi);">activa</span>'}
                  </div>
                </div>
                <span class="badge ${e.resumed_at ? 'badge-success' : 'badge-danger'}">${e.resumed_at ? 'resuelta' : 'activa'}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;

    content.querySelector('#crisis-resume')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api('/api/admin/crisis/resume', { method: 'POST' });
        toast('Crisis resuelta', 'success');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
        btn.disabled = false;
      }
    });

    content.querySelector('#crisis-force')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const reason = prompt('Razón de la crisis manual:', 'intervencion_manual');
      if (!reason) return;
      btn.disabled = true;
      try {
        await api('/api/admin/crisis/force', {
          method: 'POST',
          body: { reason },
        });
        toast('Crisis forzada', 'warning');
        this.load();
      } catch (err) {
        if (err.message !== 'auth_required') toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  },
};

// ------------------------------------------------------------
// VIEW: PLAYGROUND
// ------------------------------------------------------------

VIEWS.playground = {
  lastResult: null,

  render(root) {
    root.innerHTML = `
      <div class="playground-split">
        <div class="playground-panel">
          <div class="playground-panel-header">
            <div>
              <div class="card-title">Input</div>
              <div class="card-sub">Configura la señal de prueba</div>
            </div>
          </div>

          <div class="stack">
            <div class="label-row">
              <div>
                <label class="label">Plataforma</label>
                <select class="select" id="pg-platform">
                  <option value="twitter">Twitter</option>
                  <option value="instagram">Instagram</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
              </div>
              <div>
                <label class="label">Kind</label>
                <select class="select" id="pg-kind">
                  <option value="proactive_post">proactive_post</option>
                  <option value="mention">mention</option>
                  <option value="dm">dm</option>
                  <option value="comment">comment</option>
                </select>
              </div>
            </div>

            <div>
              <label class="label">Author (opcional)</label>
              <input class="input" id="pg-author" placeholder="@usuario">
            </div>

            <div>
              <label class="label">Texto de la señal (opcional)</label>
              <textarea class="textarea" id="pg-text" placeholder="Ej: 'Hola, me encanta tu contenido sobre X'"></textarea>
            </div>

            <div>
              <label class="label">Task custom (opcional)</label>
              <textarea class="textarea" id="pg-task" style="min-height: 60px;" placeholder="Instrucción específica al LLM"></textarea>
            </div>

            <div class="row" style="flex-wrap: wrap; gap: 8px;">
              <button class="btn btn-secondary" id="pg-preview">${ICONS.code} Preview prompts</button>
              <button class="btn btn-primary" id="pg-test">${ICONS.zap} Generar draft (consume tokens)</button>
            </div>
          </div>
        </div>

        <div class="playground-panel">
          <div class="playground-panel-header">
            <div>
              <div class="card-title">Output</div>
              <div class="card-sub" id="pg-output-sub">Esperando…</div>
            </div>
          </div>

          <div id="pg-output" style="flex: 1; display: flex; flex-direction: column;">
            <div class="empty" style="padding-top: 40px; margin: auto 0;">
              <div class="empty-icon">${ICONS.zap}</div>
              <div class="empty-title">Sin resultados</div>
              <div class="empty-desc">Usa "Preview prompts" para ver el prompt sin consumir tokens, o "Generar draft" para probar el LLM de verdad.</div>
            </div>
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
    sub.textContent = 'Generando preview…';
    try {
      const data = await api('/api/admin/llm/preview', {
        method: 'POST',
        body: this.buildBody(),
      });
      sub.textContent = `${data.provider} · ${data.model} · ${data.estimatedInputChars} chars input`;
      out.innerHTML = `
        <div class="text-xs muted mb-8">SYSTEM PROMPT</div>
        <div class="output-pre" style="min-height: 200px; max-height: 300px; overflow: auto; margin-bottom: 14px;">${esc(data.systemPrompt)}</div>
        <div class="text-xs muted mb-8">USER MESSAGE</div>
        <div class="output-pre" style="min-height: 80px; max-height: 150px; overflow: auto;">${esc(data.userMessage)}</div>
      `;
    } catch (err) {
      if (err.message !== 'auth_required') {
        sub.textContent = 'Error';
        toast(err.message, 'error');
      }
    } finally {
      btn.disabled = false;
    }
  },

  async test() {
    const btn = document.getElementById('pg-test');
    btn.disabled = true;
    const out = document.getElementById('pg-output');
    const sub = document.getElementById('pg-output-sub');
    sub.textContent = 'Llamando al LLM…';
    out.innerHTML = `
      <div class="empty" style="padding-top: 40px; margin: auto 0;">
        <div class="empty-icon">${ICONS.zap}</div>
        <div class="empty-title">Generando…</div>
        <div class="empty-desc">Espera mientras el LLM procesa.</div>
      </div>
    `;
    try {
      const data = await api('/api/admin/llm/test', {
        method: 'POST',
        body: this.buildBody(),
      });

      if (!data.ok) {
        sub.textContent = `Error: ${data.error}`;
        out.innerHTML = `
          <div class="alert alert-danger">
            <div class="alert-icon">${ICONS.error}</div>
            <div class="alert-body"><strong>Falló la generación:</strong> ${esc(data.error)}</div>
          </div>
        `;
        return;
      }

      this.lastResult = data;
      const guard = data.guard;
      const usage = data.usage || {};
      const usageStr = usage.total_tokens
        ? `${usage.total_tokens} tokens (${usage.prompt_tokens || 0} in / ${usage.completion_tokens || 0} out)`
        : '—';

      sub.textContent = `${data.latencyMs}ms · v${data.personaVersion}`;

      out.innerHTML = `
        <div class="row mb-12" style="flex-wrap: wrap; gap: 6px;">
          <span class="usage-chip">${ICONS.clock} ${data.latencyMs}ms</span>
          <span class="usage-chip">${esc(usageStr)}</span>
          ${data.skipped ? '<span class="badge badge-warning">SKIPPED</span>' : '<span class="badge badge-success">ok</span>'}
        </div>

        <div class="output-draft">${esc(data.text || '(vacío)')}</div>

        ${guard ? `
          <div class="text-xs muted mb-8 mt-16">GUARD RESULT</div>
          <div class="alert ${guard.ok ? 'alert-success' : 'alert-danger'}">
            <div class="alert-icon">${guard.ok ? ICONS.check : ICONS.error}</div>
            <div class="alert-body">
              <strong>${guard.ok ? 'Aprobado por Guard' : 'Rechazado por Guard'}</strong>
              · decisión: <span class="inline-code">${esc(guard.decision)}</span>
            </div>
          </div>
          ${guard.errors?.length ? `
            <div class="guard-checks mt-12">
              ${guard.errors.map(e => `
                <div class="guard-check err">
                  <span class="guard-check-icon">${ICONS.error}</span>
                  <span><strong>${esc(e.code)}</strong>: ${esc(e.detail || '')}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${guard.warnings?.length ? `
            <div class="guard-checks mt-12">
              ${guard.warnings.map(w => `
                <div class="guard-check warn">
                  <span class="guard-check-icon">${ICONS.warning}</span>
                  <span><strong>${esc(w.code)}</strong>: ${esc(w.detail || '')}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        ` : ''}
      `;
    } catch (err) {
      if (err.message !== 'auth_required') {
        sub.textContent = 'Error';
        out.innerHTML = `
          <div class="alert alert-danger">
            <div class="alert-icon">${ICONS.error}</div>
            <div class="alert-body">${esc(err.message)}</div>
          </div>
        `;
      }
    } finally {
      btn.disabled = false;
    }
  },
};

// ------------------------------------------------------------
// VIEW: AUDIT
// ------------------------------------------------------------

VIEWS.audit = {
  render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <select class="select" id="audit-category">
          <option value="">Todas las categorías</option>
          <option value="system">system</option>
          <option value="social">social</option>
          <option value="persona">persona</option>
          <option value="crisis">crisis</option>
        </select>
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
    } catch (err) {
      if (err.message !== 'auth_required') toast(err.message, 'error');
    }
  },

  refresh() { this.load(); },

  paint(items) {
    const list = document.getElementById('audit-list');
    if (!list) return;

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty" style="padding-top: 80px;">
          <div class="empty-icon">${ICONS.info}</div>
          <div class="empty-title">Sin eventos</div>
          <div class="empty-desc">El audit log registra cada decisión del sistema.</div>
        </div>
      `;
      return;
    }

    list.innerHTML = `
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

// ------------------------------------------------------------
// VIEW: SETTINGS
// ------------------------------------------------------------

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
            <div class="card-title">Export / Backup</div>
            <div class="card-sub">Descarga la DB completa en JSON</div>
          </div>
        </div>
        <div class="row" style="flex-wrap: wrap; gap: 8px;">
          <a class="btn btn-primary" href="/api/admin/export" download>${ICONS.download} Export todo</a>
          <a class="btn btn-secondary" href="/api/admin/export?include=persona,actions" download>${ICONS.download} Solo persona + actions</a>
        </div>
        <div class="text-xs muted mt-8">
          Los archivos exportados incluyen la API key no; necesitas el header <span class="inline-code">x-api-key</span> para descargar.
          Si el navegador no añade el header, ejecuta <span class="inline-code">curl -H "x-api-key: ..." /api/admin/export</span>.
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
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Endpoints disponibles</div>
            <div class="card-sub">Todos requieren x-api-key</div>
          </div>
        </div>
        <div class="stack-sm text-xs mono">
          <div><span class="badge badge-info">GET</span> /health · /health/readyz</div>
          <div><span class="badge badge-info">GET</span> /api/persona · /api/persona/state · /api/persona/history</div>
          <div><span class="badge badge-info">GET</span> /api/social/state · /pending · /actions · /audit</div>
          <div><span class="badge badge-info">GET</span> /api/sessions</div>
          <div><span class="badge badge-info">GET</span> /api/admin/config · /health · /signals · /crisis · /memory · /export · /db/stats</div>
          <div><span class="badge badge-success">POST</span> /api/social/tick · /pause · /resume · /crisis/resume</div>
          <div><span class="badge badge-success">POST</span> /api/admin/crisis/force · /crisis/resume · /cleanup</div>
          <div><span class="badge badge-success">POST</span> /api/admin/llm/preview · /llm/test · /signals/:id/reprocess</div>
          <div><span class="badge badge-warning">PATCH</span> /api/admin/persona/mode · /persona/platforms/:p</div>
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
