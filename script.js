/* =========================================================================
   WADAAG — Somali Educational PDF Platform
   Full application logic
   ========================================================================= */

const APP = {
  name: 'WADAAG',
  tagline: 'Buugaaga. Fasalkaaga. Waxbarashadaada.',
  defaultWhatsApp: '+252614429017',
  defaultUpgradePrice: 1,
  defaultCurrency: 'USD',
  salt: 'wadaag::v1::2025',
  sessionKey: 'wadaag.session',
  themeKey: 'wadaag.theme',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => { try { return new Date(d).toLocaleDateString('so-SO', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };
const fmtDateTime = d => { try { return new Date(d).toLocaleString('so-SO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtBytes = b => { if (!b) return '—'; const k = 1024, u = ['B', 'KB', 'MB', 'GB']; let i = 0, n = b; while (n >= k && i < u.length - 1) { n /= k; i++; } return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; };

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const hashPassword = pw => sha256(pw + APP.salt);

/* ---------------- IndexedDB ---------------- */
const STORES = ['users', 'classes', 'subjects', 'books', 'upgradeRequests', 'notifications', 'announcements', 'auditLogs', 'downloads', 'settings'];
const DB = {
  db: null,
  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('wadaag_db', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = e => { this.db = e.target.result; resolve(); };
      req.onerror = e => reject(e);
    });
  },
  _tx(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); },
  async all(store) { return new Promise((res, rej) => { const r = this._tx(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); },
  async get(store, id) { return new Promise((res, rej) => { const r = this._tx(store).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async put(store, obj) { return new Promise((res, rej) => { const r = this._tx(store, 'readwrite').put(obj); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async delete(store, id) { return new Promise((res, rej) => { const r = this._tx(store, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
  async clear(store) { return new Promise((res, rej) => { const r = this._tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); },
};

const State = {
  user: null,
  isAdmin: false,
  settings: {},
  classes: [],
  subjects: [],
  route: '',
};

/* ---------------- Toasts & Modal ---------------- */
function toast(msg, type = 'info', ms = 3200) {
  const colors = { info: 'bg-ink-900 text-white', success: 'bg-leaf-700 text-white', error: 'bg-ember-700 text-white', warn: 'bg-gold-600 text-ink-900' };
  const el = document.createElement('div');
  el.className = `fixed z-[9999] left-1/2 -translate-x-1/2 bottom-24 sm:bottom-8 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium fade-in ${colors[type] || colors.info}`;
  el.style.maxWidth = '90vw';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .35s, transform .35s'; el.style.opacity = '0'; el.style.transform = 'translate(-50%,10px)'; setTimeout(() => el.remove(), 400); }, ms);
}

function confirmBox({ title = 'Ma hubtaa?', message = '', confirmText = 'Haa', danger = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[9998] bg-ink-900/50 backdrop-blur-sm flex items-center justify-center p-4 fade-in';
    wrap.innerHTML = `
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl slide-up">
        <div class="p-6">
          <h3 class="text-lg font-bold text-ink-900">${esc(title)}</h3>
          ${message ? `<p class="mt-2 text-sm text-ink-500 leading-relaxed">${esc(message)}</p>` : ''}
        </div>
        <div class="px-6 pb-6 flex gap-3 justify-end">
          <button data-cancel class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-50">Jooji</button>
          <button data-ok class="px-4 py-2.5 rounded-xl text-sm font-semibold text-white ${danger ? 'bg-ember-600 hover:bg-ember-700' : 'bg-brand-800 hover:bg-brand-900'}">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = v => { wrap.remove(); resolve(v); };
    wrap.querySelector('[data-cancel]').onclick = () => close(false);
    wrap.querySelector('[data-ok]').onclick = () => close(true);
    wrap.onclick = e => { if (e.target === wrap) close(false); };
  });
}

function modal(html, { width = 'max-w-lg' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[9998] bg-ink-900/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto fade-in';
  wrap.innerHTML = `<div class="bg-white rounded-2xl w-full ${width} shadow-2xl slide-up my-4">${html}</div>`;
  document.body.appendChild(wrap);
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
  wrap.close = () => wrap.remove();
  return wrap;
}

/* ---------------- Seed ---------------- */
async function seedIfNeeded() {
  const cls = await DB.all('classes');
  if (cls.length === 0) {
    const names = ['F8', 'F9', 'F10', 'F11', 'F12'];
    for (const n of names) {
      await DB.put('classes', { id: uid('c_'), name: n, description: `Fasalka ${n}`, isActive: true, createdAt: Date.now() });
    }
  }
  const subs = await DB.all('subjects');
  if (subs.length === 0) {
    const subjects = ['Xisaabta', 'Ingiriisi', 'Fiisigis', 'Kimistari', 'Bayoloji', 'Juqraafi', 'Taariikh', 'Soomaali', 'Carabi', 'ICT'];
    for (const s of subjects) await DB.put('subjects', { id: uid('s_'), name: s, classId: null, isActive: true, createdAt: Date.now() });
  }
  const settings = await DB.all('settings');
  if (!settings.find(s => s.id === 'main')) {
    await DB.put('settings', {
      id: 'main',
      websiteName: APP.name,
      tagline: APP.tagline,
      whatsapp: APP.defaultWhatsApp,
      upgradePrice: APP.defaultUpgradePrice,
      currency: APP.defaultCurrency,
      supportMessage: 'Nala soo xiriir WhatsApp. Waxaan ku caawin doonaa 24/7.',
      contactEmail: 'support@wadaag.so',
      footerText: '© WADAAG — Waxbarashada Soomaaliyeed.',
      registrationOpen: true,
      maintenanceMode: false,
      maxUploadMB: 25,
    });
  }
  const users = await DB.all('users');
  const adminEmail = 'victordev252@gmail.com';
  if (!users.find(u => u.email === adminEmail)) {
    const passwordHash = await hashPassword('ANASMENO1@');
    await DB.put('users', {
      id: uid('u_'),
      name: 'Victor Admin',
      username: 'admin',
      email: adminEmail,
      phone: APP.defaultWhatsApp,
      passwordHash,
      classId: null,
      role: 'SUPER_ADMIN',
      isActive: true,
      upgradeStatus: 'NONE',
      upgradeType: null,
      upgradedAt: null,
      approvedBy: null,
      mustChangePassword: false,
      createdAt: Date.now(),
    });
  }
}

async function loadSettings() {
  const s = await DB.get('settings', 'main');
  State.settings = s || {};
  return State.settings;
}

async function audit(action, targetType = '', targetId = '', details = '') {
  const u = State.user;
  await DB.put('auditLogs', {
    id: uid('a_'),
    adminId: u?.id || 'system',
    adminEmail: u?.email || 'system',
    action, targetType, targetId,
    details: typeof details === 'string' ? details : JSON.stringify(details),
    ip: '-', createdAt: Date.now(),
  });
}

async function notify(userId, title, message, type = 'info') {
  await DB.put('notifications', {
    id: uid('n_'), userId, title, message, type, isRead: false, createdAt: Date.now(), readAt: null,
  });
}
async function notifyMany(userIds, title, message, type = 'info') {
  for (const u of userIds) await notify(u, title, message, type);
}

/* ---------------- Theme ---------------- */
function getTheme() { return localStorage.getItem(APP.themeKey) || 'system'; }
function applyTheme() {
  const t = getTheme();
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- Icons ---------------- */
const ICON = {
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 3l9 7v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3 7 8 1-6 6 2 8-7-4-7 4 2-8-6-6 8-1z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6z"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3.5-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="3"/><path d="M14 15c1.5-1 4-1 6 1"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3-3 3 3 5-7"/></svg>`,
  cog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  megaphone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-8v18L3 13z"/><path d="M11.6 16.8 10 21"/><path d="M5 12v3a3 3 0 0 0 3 3h2"/></svg>`,
  db: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  wa: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.3A7.9 7.9 0 0 0 12 4a8 8 0 0 0-6.8 12.2L4 20l3.9-1a8 8 0 0 0 12-6.6 7.9 7.9 0 0 0-2.3-6.1zm-5.6 12.4a6.6 6.6 0 0 1-3.4-.9l-.3-.2-2.3.6.6-2.3-.2-.3A6.6 6.6 0 1 1 12 18.7zm3.7-4.9c-.2-.1-1.2-.6-1.4-.7-.2-.1-.3-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2a7 7 0 0 1-1.3-1.6c-.1-.2 0-.4.1-.5l.3-.4.2-.4v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.3 1 2.5.1.2 1.7 2.6 4.1 3.6 2.4 1 2.4.7 2.8.6.4 0 1.4-.5 1.6-1 .2-.5.2-1 .1-1z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

function Logo({ size = 32, dark = false } = {}) {
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">
    <rect width="40" height="40" rx="9" fill="${dark ? '#0b1220' : '#0f1e3d'}"/>
    <path d="M8 12c4.5-1.6 9-1.6 11 1.2v15.4c-2-2.8-6.5-2.8-11-1.2z" fill="#f7f7f5"/>
    <path d="M32 12c-4.5-1.6-9-1.6-11 1.2v15.4c2-2.8 6.5-2.8 11-1.2z" fill="#e5b955"/>
    <circle cx="20" cy="9" r="1.6" fill="#e5b955"/>
  </svg>`;
}

/* ---------------- Session ---------------- */
function saveSession(userId) { localStorage.setItem(APP.sessionKey, userId); }
function clearSession() { localStorage.removeItem(APP.sessionKey); }
async function loadSession() {
  const id = localStorage.getItem(APP.sessionKey);
  if (!id) { State.user = null; State.isAdmin = false; return; }
  const u = await DB.get('users', id);
  if (!u || !u.isActive) { clearSession(); State.user = null; State.isAdmin = false; return; }
  State.user = u;
  State.isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role);
}

/* ---------------- Router ---------------- */
function navigate(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
function currentRoute() { return location.hash.replace(/^#/, '') || '/'; }

function guard() {
  const r = currentRoute();
  const publicRoutes = ['/', '/about', '/login', '/register', '/admin/login'];
  if (!State.user && !publicRoutes.includes(r)) { navigate('/login'); return false; }
  if (State.user && !State.isAdmin && r.startsWith('/admin')) { navigate('/dashboard'); return false; }
  if (State.user && State.isAdmin && r.startsWith('/admin') && r !== '/admin/login') return true;
  if (State.user && r === '/admin/login') { navigate('/admin'); return false; }
  if (State.user && (r === '/login' || r === '/register')) { navigate(State.isAdmin ? '/admin' : '/dashboard'); return false; }
  return true;
}

/* ---------------- Layouts ---------------- */
function publicHeader() {
  return `
  <header class="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-ink-100">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <a href="#/" class="flex items-center gap-2.5 group">
        ${Logo({ size: 34 })}
        <div class="leading-none">
          <div class="font-display font-bold text-[22px] tracking-tight text-ink-900 group-hover:text-brand-800 transition">WADAAG</div>
          <div class="text-[10px] uppercase tracking-[0.18em] text-ink-400 mt-0.5 hidden sm:block">Buugaaga • Fasalkaaga</div>
        </div>
      </a>
      <nav class="hidden md:flex items-center gap-1 text-sm">
        <a href="#/" class="px-3.5 py-2 rounded-lg text-ink-600 hover:text-ink-900 hover:bg-ink-50 font-medium">Bogga hore</a>
        <a href="#/about" class="px-3.5 py-2 rounded-lg text-ink-600 hover:text-ink-900 hover:bg-ink-50 font-medium">Nagu saabsan</a>
      </nav>
      <div class="flex items-center gap-2">
        <a href="#/login" class="px-3.5 py-2 text-sm font-semibold text-ink-700 hover:text-ink-900 rounded-lg hover:bg-ink-50">Gal</a>
        <a href="#/register" class="px-4 py-2 text-sm font-semibold text-white bg-brand-800 hover:bg-brand-900 rounded-lg transition shadow-sm">Bilow</a>
      </div>
    </div>
  </header>`;
}

function publicFooter() {
  return `
  <footer class="border-t border-ink-100 bg-white mt-20">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
      <div class="md:col-span-2">
        <div class="flex items-center gap-2.5">${Logo({ size: 34 })}
          <div class="font-display font-bold text-2xl text-ink-900">WADAAG</div>
        </div>
        <p class="mt-3 text-sm text-ink-500 leading-relaxed max-w-sm">${esc(State.settings.tagline || APP.tagline)}</p>
        <div class="mt-5 flex gap-2">
          <a href="https://wa.me/${(State.settings.whatsapp || APP.defaultWhatsApp).replace(/\D/g, '')}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-leaf-700 hover:bg-leaf-600 text-white text-sm font-semibold">
            ${ICON.wa.replace('<svg', '<svg width="16" height="16"')} WhatsApp
          </a>
        </div>
      </div>
      <div>
        <div class="text-xs font-bold text-ink-900 uppercase tracking-wider">Bogag</div>
        <ul class="mt-4 space-y-2.5 text-sm text-ink-500">
          <li><a href="#/" class="hover:text-ink-900">Bogga hore</a></li>
          <li><a href="#/about" class="hover:text-ink-900">Nagu saabsan</a></li>
          <li><a href="#/login" class="hover:text-ink-900">Gal</a></li>
          <li><a href="#/register" class="hover:text-ink-900">Diiwaangeli</a></li>
        </ul>
      </div>
      <div>
        <div class="text-xs font-bold text-ink-900 uppercase tracking-wider">Xiriir</div>
        <ul class="mt-4 space-y-2.5 text-sm text-ink-500">
          <li>${esc(State.settings.whatsapp || APP.defaultWhatsApp)}</li>
          <li>${esc(State.settings.contactEmail || 'support@wadaag.so')}</li>
          <li class="text-xs">F8 · F9 · F10 · F11 · F12</li>
        </ul>
      </div>
    </div>
    <div class="border-t border-ink-100">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-ink-400 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>${esc(State.settings.footerText || '© WADAAG')}</div>
        <div>Waxaa soo saaray WADAAG Team</div>
      </div>
    </div>
  </footer>`;
}

function publicLayout(content, { bare = false } = {}) {
  return `
  <div class="min-h-screen flex flex-col">
    ${bare ? '' : publicHeader()}
    <main class="flex-1">${content}</main>
    ${bare ? '' : publicFooter()}
  </div>`;
}

function userLayout(content, active = 'dashboard') {
  const u = State.user;
  const items = [
    { id: 'dashboard', href: '#/dashboard', label: 'Bogga', icon: ICON.home },
    { id: 'books', href: '#/books', label: 'Buugaag', icon: ICON.book },
    { id: 'notifications', href: '#/notifications', label: 'Ogeysiis', icon: ICON.bell },
    { id: 'profile', href: '#/profile', label: 'Profile', icon: ICON.user },
  ];
  return `
  <div class="min-h-screen bg-ink-50">
    <header class="sticky top-0 z-40 bg-white border-b border-ink-100">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <a href="#/dashboard" class="flex items-center gap-2.5 shrink-0">${Logo({ size: 32 })}
          <div class="font-display font-bold text-xl text-ink-900">WADAAG</div>
        </a>
        <div class="flex-1 max-w-md hidden md:block">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 w-4 h-4">${ICON.search}</span>
            <input data-quick-search placeholder="Raadi buug..." class="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-ink-50 text-sm ring-focus focus:bg-white" />
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <a href="#/notifications" class="relative p-2.5 rounded-lg hover:bg-ink-50 text-ink-600">${ICON.bell.replace('<svg', '<svg width="20" height="20"')}<span data-notif-badge class="hidden absolute top-1 right-1 w-2 h-2 bg-ember-500 rounded-full ring-2 ring-white"></span></a>
          <a href="#/upgrade" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg ${u.upgradeStatus === 'APPROVED' ? 'bg-leaf-100 text-leaf-700' : 'bg-gold-500 text-ink-900 hover:bg-gold-400'} text-xs font-bold">${u.upgradeStatus === 'APPROVED' ? '★ UPGRADED' : 'UPGRADE $1'}</a>
          <a href="#/profile" class="ml-1 inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-ink-50 hover:bg-ink-100">
            <span class="w-8 h-8 rounded-full bg-brand-800 text-white grid place-items-center text-sm font-bold">${esc((u.name || '?').charAt(0).toUpperCase())}</span>
            <span class="hidden sm:block text-xs font-semibold text-ink-700 max-w-[90px] truncate">${esc(u.name.split(' ')[0])}</span>
          </a>
        </div>
      </div>
    </header>
    <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">${content}</div>
    <nav class="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-ink-100 sm:hidden" style="padding-bottom:env(safe-area-inset-bottom)">
      <div class="grid grid-cols-4">
        ${items.map(i => `
          <a href="${i.href}" class="flex flex-col items-center gap-0.5 py-2.5 ${active === i.id ? 'text-brand-800' : 'text-ink-400'}">
            <span class="w-5 h-5">${i.icon}</span>
            <span class="text-[10px] font-semibold">${i.label}</span>
          </a>`).join('')}
      </div>
    </nav>
  </div>`;
}

function adminLayout(content, active = 'dashboard') {
  const u = State.user;
  const items = [
    { id: 'dashboard', href: '#/admin', label: 'Dashboard', icon: ICON.home },
    { id: 'users', href: '#/admin/users', label: 'Users', icon: ICON.users },
    { id: 'classes', href: '#/admin/classes', label: 'Classes', icon: ICON.book },
    { id: 'subjects', href: '#/admin/subjects', label: 'Subjects', icon: ICON.doc },
    { id: 'books', href: '#/admin/books', label: 'Books', icon: ICON.book },
    { id: 'upgrades', href: '#/admin/upgrades', label: 'Upgrade Requests', icon: ICON.star },
    { id: 'notifications', href: '#/admin/notifications', label: 'Notifications', icon: ICON.bell },
    { id: 'announcements', href: '#/admin/announcements', label: 'Announcements', icon: ICON.megaphone },
    { id: 'downloads', href: '#/admin/downloads', label: 'Downloads', icon: ICON.download },
    { id: 'reports', href: '#/admin/reports', label: 'Reports', icon: ICON.chart },
    { id: 'database', href: '#/admin/database', label: 'Database', icon: ICON.db },
    { id: 'audit', href: '#/admin/audit', label: 'Audit Logs', icon: ICON.shield },
    { id: 'settings', href: '#/admin/settings', label: 'Settings', icon: ICON.cog },
  ];
  return `
  <div class="min-h-screen bg-ink-50 flex">
    <aside class="hidden lg:flex w-64 shrink-0 bg-brand-900 text-white flex-col">
      <div class="h-16 flex items-center gap-2.5 px-5 border-b border-white/10">
        ${Logo({ size: 32, dark: true })}
        <div class="leading-none">
          <div class="font-display font-bold text-lg">WADAAG</div>
          <div class="text-[10px] uppercase tracking-[0.15em] text-gold-400">Admin Panel</div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto py-4 px-3">
        ${items.map(i => `
          <a href="${i.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium ${active === i.id ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}">
            <span class="w-5 h-5">${i.icon}</span>${i.label}
          </a>`).join('')}
      </nav>
      <div class="border-t border-white/10 p-3">
        <div class="flex items-center gap-3 px-2 py-2">
          <span class="w-9 h-9 rounded-full bg-gold-500 text-brand-900 grid place-items-center text-sm font-bold">${esc((u.name || 'A').charAt(0))}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate">${esc(u.name)}</div>
            <div class="text-[11px] text-white/50 uppercase">${esc(u.role)}</div>
          </div>
        </div>
        <button onclick="doLogout()" class="w-full mt-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5 hover:text-white">
          <span class="w-4 h-4">${ICON.logout}</span> Ka bax
        </button>
      </div>
    </aside>

    <div class="flex-1 min-w-0 flex flex-col">
      <header class="sticky top-0 z-30 h-16 bg-white border-b border-ink-100 flex items-center justify-between px-4 sm:px-6">
        <div class="flex items-center gap-3">
          <button data-admin-menu class="lg:hidden p-2 -ml-2 rounded-lg hover:bg-ink-50 text-ink-700">
            <span class="w-6 h-6 inline-block">${ICON.menu}</span>
          </button>
          <div>
            <div class="text-sm font-semibold text-ink-900 capitalize">${esc(active.replace('-', ' '))}</div>
            <div class="text-[11px] text-ink-400">Maamulka WADAAG</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <a href="#/dashboard" class="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900 px-3 py-2 rounded-lg hover:bg-ink-50">
            <span class="w-4 h-4">${ICON.eye}</span> Arag site-ka
          </a>
          <button onclick="toggleTheme()" class="p-2 rounded-lg hover:bg-ink-50 text-ink-600">${ICON.sun.replace('<svg', '<svg width="18" height="18"')}</button>
        </div>
      </header>

      <div id="admin-drawer" class="hidden fixed inset-0 z-50 lg:hidden">
        <div class="absolute inset-0 bg-ink-900/60" data-drawer-close></div>
        <div class="relative w-72 max-w-[85vw] h-full bg-brand-900 text-white flex flex-col slide-up">
          <div class="h-16 flex items-center justify-between px-5 border-b border-white/10">
            <div class="flex items-center gap-2.5">${Logo({ size: 30, dark: true })}<div class="font-display font-bold">WADAAG</div></div>
            <button data-drawer-close class="p-2 -mr-2 rounded-lg hover:bg-white/10">${ICON.x.replace('<svg', '<svg width="20" height="20"')}</button>
          </div>
          <nav class="flex-1 overflow-y-auto py-4 px-3">
            ${items.map(i => `
              <a href="${i.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium ${active === i.id ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}">
                <span class="w-5 h-5">${i.icon}</span>${i.label}
              </a>`).join('')}
            <button onclick="doLogout()" class="w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/70 hover:bg-white/5">
              <span class="w-5 h-5">${ICON.logout}</span> Ka bax
            </button>
          </nav>
        </div>
      </div>

      <main class="flex-1 p-4 sm:p-6">${content}</main>
    </div>
  </div>`;
}

/* ======================= PUBLIC PAGES ======================= */
function pageLanding() {
  const cls = State.classes.filter(c => c.isActive);
  return publicLayout(`
    <section class="relative overflow-hidden">
      <div class="absolute inset-0 -z-10" style="background: radial-gradient(1000px 500px at 80% -10%, #e5b95533, transparent 60%), radial-gradient(900px 500px at -10% 20%, #254a8f1a, transparent 60%);"></div>
      <div class="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-24 pb-16">
        <div class="grid lg:grid-cols-12 gap-10 items-center">
          <div class="lg:col-span-7">
            <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-ink-100 text-xs font-semibold text-ink-600">
              <span class="w-1.5 h-1.5 rounded-full bg-leaf-500"></span>
              Waxbarashada Soomaaliyeed ee casriga ah
            </span>
            <h1 class="mt-6 font-display text-[40px] sm:text-6xl lg:text-[68px] leading-[1.02] font-bold text-ink-900 tracking-tight">
              Buugaagta fasalkaaga,<br><span class="text-brand-800">hal meel.</span>
            </h1>
            <p class="mt-6 text-lg sm:text-xl text-ink-500 leading-relaxed max-w-xl">
              Dooro fasalkaaga, hel buugaagtaada, oo si fudud wax u baro. F8 ilaa F12 — buugaag PDF oo si gaar ah loo qoondeeyay fasalkaaga.
            </p>
            <div class="mt-9 flex flex-wrap gap-3">
              <a href="#/register" class="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white font-semibold shadow-sm transition">
                Bilow hadda ${ICON.arrow.replace('<svg', '<svg width="18" height="18"')}
              </a>
              <a href="#/login" class="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white border border-ink-200 hover:border-ink-300 text-ink-800 font-semibold transition">
                Gal account
              </a>
            </div>
            <div class="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-ink-500">
              <div class="flex items-center gap-2"><span class="text-leaf-600 w-4 h-4">${ICON.check}</span> Bilaash inaad iska diiwaangeliso</div>
              <div class="flex items-center gap-2"><span class="text-leaf-600 w-4 h-4">${ICON.check}</span> PDF browser-kaaga</div>
              <div class="flex items-center gap-2"><span class="text-leaf-600 w-4 h-4">${ICON.check}</span> Upgrade $1 oo joogto ah</div>
            </div>
          </div>
          <div class="lg:col-span-5">
            <div class="relative">
              <div class="bg-white rounded-3xl border border-ink-100 shadow-[0_24px_60px_-30px_rgba(15,30,61,0.35)] p-5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    ${Logo({ size: 26 })}
                    <div class="font-display font-bold text-ink-900">Fasalka F10</div>
                  </div>
                  <span class="text-[10px] font-bold uppercase tracking-wider text-gold-700 bg-gold-100 px-2 py-1 rounded">F10</span>
                </div>
                <div class="mt-4 grid grid-cols-3 gap-3">
                  ${['Xisaabta', 'Fiisigis', 'Bayoloji', 'Kimistari', 'Ingiriisi', 'Soomaali'].map((s, i) => `
                    <div class="aspect-book rounded-lg bg-gradient-to-br from-brand-800 to-brand-600 flex items-center justify-center shadow-inner">
                      <span class="text-white/90 font-display text-2xl">${['∑', '⚛', '🧬', '⚗', 'A', 'أ'][i]}</span>
                    </div>
                  `).join('')}
                </div>
                <div class="mt-5 flex items-center justify-between text-xs">
                  <div class="text-ink-500">Buugaag cusub oo lagu daray</div>
                  <div class="font-semibold text-leaf-700">+12 sanadkan</div>
                </div>
              </div>
              <div class="absolute -bottom-5 -right-3 sm:-right-6 bg-ink-900 text-white rounded-2xl px-4 py-3 shadow-xl">
                <div class="text-[10px] uppercase tracking-wider text-gold-400 font-bold">Upgrade</div>
                <div class="font-display text-2xl font-bold">$1</div>
                <div class="text-[10px] text-white/60 mt-0.5">Joogto ah</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div class="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 class="font-display text-3xl sm:text-4xl font-bold text-ink-900">Fasallada</h2>
          <p class="mt-2 text-ink-500 max-w-lg">Hal fasal dooro. Buugaagtaada oo dhan waxay ku xirnaan doonaan fasalkaas oo kaliya.</p>
        </div>
      </div>
      <div class="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        ${cls.map(c => `
          <a href="#/register" class="group relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-5 hover:border-brand-300 hover:shadow-lg transition">
            <div class="flex items-center justify-between">
              <span class="font-display text-3xl font-bold text-ink-900">${esc(c.name)}</span>
              <span class="w-8 h-8 rounded-lg bg-ink-50 group-hover:bg-brand-800 group-hover:text-white transition grid place-items-center text-ink-400">${ICON.arrow.replace('<svg', '<svg width="16" height="16"')}</span>
            </div>
            <div class="mt-8 text-xs text-ink-500">${esc(c.description || ('Fasalka ' + c.name))}</div>
          </a>
        `).join('')}
      </div>
    </section>

    <section id="how" class="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div class="max-w-2xl">
        <div class="text-xs font-bold uppercase tracking-wider text-brand-700">Sida loo isticmaalo</div>
        <h2 class="mt-3 font-display text-3xl sm:text-4xl font-bold text-ink-900">Sida fudud ee WADAAG u shaqeeyo</h2>
      </div>
      <div class="mt-10 grid md:grid-cols-3 gap-6">
        ${[
          { n: '01', t: 'Samee account', d: 'Diiwaangeli adigoo isticmaalaya magacaaga, username, iyo fasalka aad ku jirto.' },
          { n: '02', t: 'Dooro fasalkaaga', d: "F8, F9, F10, F11 ama F12. Doorashadan waxay go'aaminaysaa buugaagta aad arki doonto." },
          { n: '03', t: 'Akhri & download', d: 'Buugaagta fasalkaaga ah ayaad arki kartaa, akhrin kartaa, kadibna soo dejisan kartaa.' },
        ].map(s => `
          <div class="rounded-2xl border border-ink-100 bg-white p-6">
            <div class="text-xs font-bold text-brand-700 tracking-widest">${s.n}</div>
            <h3 class="mt-3 font-display text-xl font-bold text-ink-900">${s.t}</h3>
            <p class="mt-2 text-sm text-ink-500 leading-relaxed">${s.d}</p>
          </div>`).join('')}
      </div>
    </section>

    <section class="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
      <div class="rounded-3xl bg-brand-900 text-white p-8 sm:p-12 relative overflow-hidden">
        <div class="absolute inset-0 opacity-15" style="background-image:radial-gradient(circle at 20% 10%, #e5b955 0, transparent 40%), radial-gradient(circle at 90% 90%, #e5b955 0, transparent 40%);"></div>
        <div class="relative grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h3 class="font-display text-3xl sm:text-4xl font-bold leading-tight">Ma diyaar baad tahay inaad bilowdo?</h3>
            <p class="mt-3 text-white/70 max-w-md">Hal account. Hal fasal. Buugaag badan oo tayo leh.</p>
          </div>
          <div class="flex flex-wrap md:justify-end gap-3">
            <a href="#/register" class="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-ink-900 font-bold transition">Diiwaangeli bilaash ${ICON.arrow.replace('<svg', '<svg width="18" height="18"')}</a>
            <a href="#/login" class="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border border-white/25 hover:bg-white/10 font-semibold transition">Gal</a>
          </div>
        </div>
      </div>
    </section>
  `);
}

function pageAbout() {
  return publicLayout(`
    <section class="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <div class="text-xs font-bold uppercase tracking-wider text-brand-700">Nagu saabsan</div>
      <h1 class="mt-3 font-display text-4xl sm:text-5xl font-bold text-ink-900 leading-tight">Waxbarasho fudud oo loogu talagalay ardayda Soomaaliyeed.</h1>
      <p class="mt-6 text-lg text-ink-500 leading-relaxed">
        WADAAG waa madal casri ah oo ardayda Soomaaliyeed ku heli karaan buugaagtooda PDF, iyadoo loo qoondeeyay fasal kasta si gaar ah. Fikradda waa mid fudud — dooro fasalkaaga, hel buugaagtaada.
      </p>
      <div class="mt-10 grid sm:grid-cols-3 gap-4">
        ${[
          { t: 'Hal fasal', d: "Fasalkaaga ayaa go'aaminaya waxa aad arki karto." },
          { t: 'Qaab fudud', d: 'Mobile-friendly, browser kasta, ma jiro app loo baahan yahay.' },
          { t: 'Aamin', d: 'Buugaagtaada waa kuwa fasalkaaga oo kaliya — lama dhaafi karo.' },
        ].map(x => `
          <div class="rounded-2xl border border-ink-100 bg-white p-5">
            <div class="w-9 h-9 rounded-lg bg-brand-50 text-brand-800 grid place-items-center">${ICON.check.replace('<svg', '<svg width="18" height="18"')}</div>
            <div class="mt-4 font-semibold text-ink-900">${x.t}</div>
            <div class="mt-1 text-sm text-ink-500">${x.d}</div>
          </div>`).join('')}
      </div>
    </section>
  `);
}

function pageLogin() {
  return publicLayout(`
    <div class="min-h-[70vh] grid place-items-center px-4 py-12">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          ${Logo({ size: 56 })}
          <h1 class="mt-5 font-display text-3xl font-bold text-ink-900">Ku soo dhawoow WADAAG</h1>
          <p class="mt-2 text-sm text-ink-500">Gal account-kaaga si aad u sii wadato.</p>
        </div>
        <form id="login-form" class="bg-white rounded-2xl border border-ink-100 shadow-[0_10px_40px_-20px_rgba(15,30,61,0.25)] p-6 sm:p-8">
          <div class="space-y-4">
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Email</span>
              <input name="email" type="email" required autocomplete="email" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="email@example.com" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Password</span>
              <input name="password" type="password" required autocomplete="current-password" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="••••••••" />
            </label>
          </div>
          <button class="mt-6 w-full py-3.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white font-semibold transition">Gal</button>
          <div class="mt-5 text-center text-sm text-ink-500">
            Ma haysataa account? <a href="#/register" class="font-semibold text-brand-800 hover:underline">Diiwaangeli</a>
          </div>
          <div class="mt-6 pt-5 border-t border-ink-100 text-center">
            <a href="#/admin/login" class="text-xs text-ink-400 hover:text-ink-700">Admin login →</a>
          </div>
        </form>
      </div>
    </div>
  `);
}

function pageRegister() {
  return publicLayout(`
    <div class="min-h-[80vh] grid place-items-center px-4 py-12">
      <div class="w-full max-w-2xl">
        <div class="text-center mb-8">
          ${Logo({ size: 56 })}
          <h1 class="mt-5 font-display text-3xl font-bold text-ink-900">Samee account WADAAG</h1>
          <p class="mt-2 text-sm text-ink-500">Waxaa lagu geeynayaa tillaabooyin fudud oo 4 ah.</p>
        </div>
        <form id="register-form" class="bg-white rounded-2xl border border-ink-100 shadow-[0_10px_40px_-20px_rgba(15,30,61,0.25)] p-6 sm:p-8">
          <div class="grid sm:grid-cols-2 gap-4">
            <label class="block sm:col-span-2">
              <span class="text-xs font-semibold text-ink-700">Magacaaga oo buuxa *</span>
              <input name="name" required class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="Tusaale: Axmed Cali Warsame" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Username *</span>
              <input name="username" required pattern="[a-zA-Z0-9_]{3,20}" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="axmed123" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Telefoon *</span>
              <input name="phone" required pattern="[0-9+\\s-]{7,20}" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="+252 61 000 0000" />
            </label>
            <label class="block sm:col-span-2">
              <span class="text-xs font-semibold text-ink-700">Email *</span>
              <input name="email" type="email" required class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="email@example.com" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Password *</span>
              <input name="password" type="password" required minlength="6" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="Ugu yaraan 6 xaraf" />
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-ink-700">Confirm password *</span>
              <input name="password2" type="password" required minlength="6" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
            </label>
          </div>
          <div class="mt-6 rounded-xl bg-gold-100 border border-gold-200 p-4 text-xs text-ink-700 leading-relaxed">
            ⚠️ <b>Ogeysiis:</b> Fasalka aad dooranayso waa mid joogto ah. Admin-ka oo kaliya aaa beddeli kara kadib.
          </div>
          <button class="mt-6 w-full py-3.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white font-semibold transition">Sii wad → Dooro fasalka</button>
          <div class="mt-5 text-center text-sm text-ink-500">
            Horey ma u haysataa account? <a href="#/login" class="font-semibold text-brand-800 hover:underline">Gal</a>
          </div>
        </form>
      </div>
    </div>
  `);
}

/* ======================= ONBOARDING (FIXED) ======================= */
async function showOnboardingClassSelect(pendingUser) {
  const cls = State.classes.filter(c => c.isActive);
  let step = 1;
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[9999] bg-ink-900/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto fade-in';
  const render = () => {
    const nextDisabled = step === 2 && !pendingUser.classId;
    wrap.innerHTML = `
      <div class="bg-white rounded-3xl w-full max-w-xl shadow-2xl slide-up my-4 sm:my-6 overflow-hidden">
        <div class="px-5 sm:px-8 pt-6 sm:pt-8 pb-5 sm:pb-6 border-b border-ink-100">
          <div class="flex items-center gap-3">
            ${Logo({ size: 40 })}
            <div>
              <div class="font-display text-lg sm:text-xl font-bold text-ink-900">Ku soo dhowow WADAAG</div>
              <div class="text-xs text-ink-500">Tallaabo ${step} ee 4</div>
            </div>
          </div>
          <div class="mt-4 sm:mt-5 flex gap-1.5">
            ${[1, 2, 3, 4].map(i => `<div class="h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-800' : 'bg-ink-100'}"></div>`).join('')}
          </div>
        </div>
        <div class="px-5 sm:px-8 py-6 sm:py-8">
          ${step === 1 ? `
            <h2 class="font-display text-xl sm:text-2xl font-bold text-ink-900">Ku soo dhowow WADAAG 🎓</h2>
            <p class="mt-3 text-sm sm:text-base text-ink-500 leading-relaxed">Waxaad hadda samaysatay account-kaaga. Waxaa dhiman hal tallaabo oo muhiim ah — dooro fasalkaaga.</p>
            <ul class="mt-5 space-y-2 text-sm text-ink-600">
              <li class="flex items-start gap-2"><span class="text-leaf-600 mt-0.5 w-4 h-4 shrink-0">${ICON.check}</span> Account-kaaga waa diyaar</li>
              <li class="flex items-start gap-2"><span class="text-leaf-600 mt-0.5 w-4 h-4 shrink-0">${ICON.check}</span> Email-kaaga waa la diiwaangeliyay</li>
              <li class="flex items-start gap-2"><span class="text-gold-600 mt-0.5 w-4 h-4 shrink-0">${ICON.check}</span> Dooro fasalkaaga</li>
            </ul>
          ` : ''}
          ${step === 2 ? `
            <h2 class="font-display text-xl sm:text-2xl font-bold text-ink-900">Dooro fasalkaaga</h2>
            <p class="mt-3 text-sm sm:text-base text-ink-500">Fasalka aad dooranayso waxay go'aaminaysaa buugaagta aad arki karto.</p>
            <div class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
              ${cls.map(c => `
                <button type="button" data-pick="${c.id}" class="rounded-2xl border-2 ${pendingUser.classId === c.id ? 'border-brand-800 bg-brand-50' : 'border-ink-200 hover:border-brand-400'} p-3.5 sm:p-4 text-center transition">
                  <div class="font-display text-2xl sm:text-3xl font-bold text-ink-900">${esc(c.name)}</div>
                  <div class="text-[10px] sm:text-[11px] text-ink-500 mt-1">${esc(c.description || '')}</div>
                </button>
              `).join('')}
            </div>
            ${!pendingUser.classId ? `<p class="mt-4 text-xs text-gold-700 text-center">Fadlan dooro fasal si aad u sii wadato.</p>` : ''}
          ` : ''}
          ${step === 3 ? `
            <h2 class="font-display text-xl sm:text-2xl font-bold text-ink-900">Xaqiiji doorashadaada</h2>
            <p class="mt-3 text-sm sm:text-base text-ink-500">Ma hubtaa in fasalkaagu yahay:</p>
            <div class="mt-6 rounded-2xl border-2 border-brand-800 bg-brand-50 p-6 text-center">
              <div class="text-xs font-bold uppercase tracking-widest text-brand-700">Fasalka</div>
              <div class="font-display text-4xl sm:text-5xl font-bold text-ink-900 mt-1">${esc(cls.find(c => c.id === pendingUser.classId)?.name || '')}</div>
            </div>
          ` : ''}
          ${step === 4 ? `
            <div class="text-center">
              <div class="w-16 h-16 rounded-full bg-leaf-100 text-leaf-700 grid place-items-center mx-auto">${ICON.check.replace('<svg', '<svg width="32" height="32"')}</div>
              <h2 class="mt-5 font-display text-xl sm:text-2xl font-bold text-ink-900">Waa la keydiyay!</h2>
              <p class="mt-3 text-sm sm:text-base text-ink-500 leading-relaxed">Doorashada fasalkaaga waa muhiim. Buugaagta iyo waxyaabaha kuu muuqanaya waxay ku xirnaan doonaan fasalkaaga.</p>
              <div class="mt-6 p-4 rounded-xl bg-ink-50 text-xs text-ink-600">
                Ma doonaysaa inaad beddesho fasalka? Admin-ka oo kaliya ayaa beddeli kara.
              </div>
            </div>
          ` : ''}
        </div>
        <div class="px-5 sm:px-8 py-4 sm:py-5 border-t border-ink-100 flex items-center justify-between gap-3" style="padding-bottom:calc(1rem + env(safe-area-inset-bottom))">
          <button type="button" data-back class="px-4 py-2.5 rounded-xl text-sm font-semibold text-ink-500 hover:bg-ink-50 ${step === 1 ? 'invisible' : ''}">← Dib</button>
          ${step < 4 ? `<button type="button" data-next class="px-5 py-2.5 rounded-xl bg-brand-800 text-white text-sm font-semibold transition ${nextDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-brand-900'}">Sii wad →</button>` :
        `<button type="button" data-finish class="px-5 py-2.5 rounded-xl bg-leaf-700 hover:bg-leaf-600 text-white text-sm font-semibold">Tag Dashboard →</button>`}
        </div>
      </div>`;

    wrap.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      pendingUser.classId = b.dataset.pick;
      render();
    });

    const back = wrap.querySelector('[data-back]');
    if (back) back.onclick = () => { step = Math.max(1, step - 1); render(); };

    const next = wrap.querySelector('[data-next]');
    if (next) next.onclick = () => {
      if (step === 2 && !pendingUser.classId) return;
      step = Math.min(4, step + 1);
      render();
    };

    const finish = wrap.querySelector('[data-finish]');
    if (finish) finish.onclick = async () => {
      await DB.put('users', pendingUser);
      await notify(pendingUser.id, 'Ku soo dhowow WADAAG', 'Account-kaaga waa la sameeyay. Ku soo dhowow WADAAG!', 'success');
      saveSession(pendingUser.id);
      State.user = pendingUser;
      State.isAdmin = false;
      wrap.remove();
      navigate('/dashboard');
    };
  };
  document.body.appendChild(wrap);
  render();
}

function pageAdminLogin() {
  return publicLayout(`
    <div class="min-h-[70vh] grid place-items-center px-4 py-12">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-900 text-white text-xs font-bold tracking-widest uppercase">Admin Access</div>
          <h1 class="mt-5 font-display text-3xl font-bold text-ink-900">Admin Login</h1>
          <p class="mt-2 text-sm text-ink-500">Kaliya maamulayaasha WADAAG.</p>
        </div>
        <form id="admin-login-form" class="bg-white rounded-2xl border border-ink-100 shadow-[0_10px_40px_-20px_rgba(15,30,61,0.25)] p-6 sm:p-8">
          <label class="block">
            <span class="text-xs font-semibold text-ink-700">Admin Email</span>
            <input name="email" type="email" required class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
          </label>
          <label class="block mt-4">
            <span class="text-xs font-semibold text-ink-700">Password</span>
            <input name="password" type="password" required class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
          </label>
          <button class="mt-6 w-full py-3.5 rounded-xl bg-brand-900 hover:bg-ink-900 text-white font-semibold transition">Gal Admin Panel</button>
          <div class="mt-5 text-center text-xs text-ink-400">
            <a href="#/login" class="hover:text-ink-700">← User login</a>
          </div>
        </form>
      </div>
    </div>
  `, { bare: true });
}

/* ======================= USER PAGES ======================= */
async function pageDashboard() {
  const u = State.user;
  const cls = State.classes.find(c => c.id === u.classId);
  const allBooks = await DB.all('books');
  const myBooks = allBooks.filter(b => b.classId === u.classId && b.isPublished);
  const recent = [...myBooks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const popular = [...myBooks].sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0)).slice(0, 4);
  const notifs = (await DB.all('notifications')).filter(n => n.userId === u.id && !n.isRead).length;
  const subjects = await DB.all('subjects');
  const mySubjects = subjects.filter(s => s.isActive && (!s.classId || s.classId === u.classId));
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s.name]));

  const hero = `
    <div class="rounded-3xl bg-brand-900 text-white p-6 sm:p-8 relative overflow-hidden">
      <div class="absolute inset-0 opacity-10" style="background-image:radial-gradient(circle at 15% 20%, #e5b955 0, transparent 40%), radial-gradient(circle at 90% 80%, #e5b955 0, transparent 45%);"></div>
      <div class="relative">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div class="text-white/60 text-xs uppercase tracking-widest font-semibold">Ku soo dhowow</div>
            <h1 class="mt-1 font-display text-3xl sm:text-4xl font-bold">${esc(u.name.split(' ')[0])} 👋</h1>
            <div class="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-sm">
              <span class="w-1.5 h-1.5 rounded-full bg-gold-400"></span>
              Fasalkaaga: <b>${esc(cls?.name || '—')}</b>
            </div>
          </div>
          <div class="flex gap-2 flex-wrap">
            ${u.upgradeStatus === 'APPROVED'
      ? `<div class="px-4 py-3 rounded-2xl bg-leaf-700/40 border border-leaf-500/40 backdrop-blur text-sm"><div class="text-[10px] uppercase tracking-widest text-leaf-100/80 font-bold">Account</div><div class="font-bold text-lg">★ Upgraded</div></div>`
      : `<a href="#/upgrade" class="px-4 py-3 rounded-2xl bg-gold-500 text-ink-900 hover:bg-gold-400 text-sm font-bold"><div class="text-[10px] uppercase tracking-widest opacity-70">Fasax</div><div class="font-bold text-lg">Upgrade $1</div></a>`}
          </div>
        </div>
        <div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="rounded-xl bg-white/10 p-3.5">
            <div class="text-[10px] uppercase tracking-wider text-white/60 font-bold">Buugaagta</div>
            <div class="font-display text-2xl font-bold mt-0.5">${myBooks.length}</div>
          </div>
          <div class="rounded-xl bg-white/10 p-3.5">
            <div class="text-[10px] uppercase tracking-wider text-white/60 font-bold">Maaddooyin</div>
            <div class="font-display text-2xl font-bold mt-0.5">${mySubjects.length}</div>
          </div>
          <div class="rounded-xl bg-white/10 p-3.5">
            <div class="text-[10px] uppercase tracking-wider text-white/60 font-bold">Ogeysiis</div>
            <div class="font-display text-2xl font-bold mt-0.5">${notifs}</div>
          </div>
          <div class="rounded-xl bg-white/10 p-3.5">
            <div class="text-[10px] uppercase tracking-wider text-white/60 font-bold">Xaalad</div>
            <div class="font-display text-2xl font-bold mt-0.5">${u.upgradeStatus === 'APPROVED' ? '✓' : 'Bilaash'}</div>
          </div>
        </div>
      </div>
    </div>`;

  const bookCard = (b, subjectName) => `
    <div class="group rounded-2xl border border-ink-100 bg-white overflow-hidden hover:border-brand-300 hover:shadow-lg transition">
      <div class="aspect-book bg-ink-100 relative overflow-hidden">
        ${b.coverData ? `<img src="${b.coverData}" alt="${esc(b.title)}" class="w-full h-full object-cover group-hover:scale-[1.03] transition duration-500" />` :
      `<div class="w-full h-full bg-gradient-to-br from-brand-800 to-brand-600 grid place-items-center p-3"><div class="text-white text-center"><div class="font-display text-2xl font-bold leading-tight">${esc(b.title)}</div><div class="text-white/70 text-[10px] mt-1">${esc(subjectName || '')}</div></div></div>`}
        <span class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/95 text-[10px] font-bold text-ink-900">${esc(cls?.name || '')}</span>
      </div>
      <div class="p-4">
        <div class="flex items-center gap-2 text-[11px] text-ink-500">
          <span class="font-semibold text-brand-700">${esc(subjectName || '—')}</span>
          <span>·</span><span>${esc(b.author || '—')}</span>
        </div>
        <h3 class="mt-1.5 font-semibold text-ink-900 leading-snug line-clamp-2">${esc(b.title)}</h3>
        <p class="mt-1 text-xs text-ink-500 line-clamp-2">${esc(b.description || '')}</p>
        <div class="mt-3 flex gap-2">
          <a href="#/books/${b.id}" class="flex-1 text-center text-xs font-semibold py-2 rounded-lg bg-brand-800 hover:bg-brand-900 text-white">Akhriso</a>
          <button data-download="${b.id}" class="px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50" title="Download">${ICON.download.replace('<svg', '<svg width="16" height="16"')}</button>
        </div>
      </div>
    </div>`;

  const content = `
    ${hero}
    <div class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-2xl font-bold text-ink-900">Buugaagta cusub</h2>
        <a href="#/books" class="text-sm font-semibold text-brand-800 hover:underline">Arag dhammaan →</a>
      </div>
      ${recent.length === 0 ? `
        <div class="mt-4 rounded-2xl border-2 border-dashed border-ink-200 p-10 text-center">
          <div class="w-12 h-12 mx-auto rounded-xl bg-ink-50 grid place-items-center text-ink-400">${ICON.book.replace('<svg', '<svg width="22" height="22"')}</div>
          <div class="mt-3 font-semibold text-ink-700">Fasalkaaga wali buugaag laguma darin.</div>
          <div class="text-xs text-ink-400 mt-1">Admin-ka ayaa dhawaan buugaag ku daraya.</div>
        </div>` :
      `<div class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">${recent.map(b => bookCard(b, subjectMap[b.subjectId])).join('')}</div>`}
    </div>

    <div class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-2xl font-bold text-ink-900">Maaddooyinka</h2>
      </div>
      <div class="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
        ${mySubjects.length === 0 ? `<div class="text-sm text-ink-400">Ma jiraan maaddooyin.</div>` :
      mySubjects.map(s => {
        const cnt = myBooks.filter(b => b.subjectId === s.id).length;
        return `<div class="shrink-0 px-4 py-2.5 rounded-xl bg-white border border-ink-100 text-sm font-semibold text-ink-700">${esc(s.name)} <span class="text-ink-400 font-normal">· ${cnt}</span></div>`;
      }).join('')}
      </div>
    </div>

    ${popular.length > 0 ? `
    <div class="mt-8">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-2xl font-bold text-ink-900">Kuwa ugu badan</h2>
      </div>
      <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">${popular.map(b => bookCard(b, subjectMap[b.subjectId])).join('')}</div>
    </div>` : ''}
  `;
  return userLayout(content, 'dashboard');
}

async function pageBooks() {
  const u = State.user;
  const cls = State.classes.find(c => c.id === u.classId);
  const allBooks = (await DB.all('books')).filter(b => b.classId === u.classId && b.isPublished);
  const subjects = await DB.all('subjects');
  const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s.name]));
  const mySubjects = subjects.filter(s => s.isActive);

  const content = `
    <div class="flex items-end justify-between flex-wrap gap-4">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Buugaagta Fasalka ${esc(cls?.name || '')}</h1>
        <p class="mt-1 text-sm text-ink-500">Buugaagta oo dhan ee loo qoondeeyay fasalkaaga.</p>
      </div>
      <div class="inline-flex items-center gap-2 text-xs text-ink-500">
        <span class="w-1.5 h-1.5 rounded-full bg-leaf-500"></span> Kaliya ${esc(cls?.name || '')}
      </div>
    </div>

    <div class="mt-6 flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 w-4 h-4">${ICON.search}</span>
        <input data-book-search placeholder="Raadi cinwaan, maaddo, qoraa..." class="w-full pl-9 pr-3 py-3 rounded-xl border border-ink-200 bg-white ring-focus text-sm" />
      </div>
      <select data-book-subject class="px-3.5 py-3 rounded-xl border border-ink-200 bg-white text-sm ring-focus">
        <option value="">Dhammaan maaddooyinka</option>
        ${mySubjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select>
    </div>

    <div data-books-grid class="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      ${renderBookGrid(allBooks, subjectMap, cls)}
    </div>
  `;
  return userLayout(content, 'books');
}

function renderBookGrid(books, subjectMap, cls) {
  if (books.length === 0) return `
    <div class="col-span-full rounded-2xl border-2 border-dashed border-ink-200 p-12 text-center">
      <div class="w-12 h-12 mx-auto rounded-xl bg-ink-50 grid place-items-center text-ink-400">${ICON.book.replace('<svg', '<svg width="22" height="22"')}</div>
      <div class="mt-3 font-semibold text-ink-700">Fasalkaaga wali buugaag laguma darin.</div>
      <div class="text-xs text-ink-400 mt-1">Admin-ka ayaa dhawaan buugaag ku daraya.</div>
    </div>`;
  return books.map(b => `
    <div class="group rounded-2xl border border-ink-100 bg-white overflow-hidden hover:border-brand-300 hover:shadow-lg transition">
      <a href="#/books/${b.id}" class="block aspect-book bg-ink-100 relative overflow-hidden">
        ${b.coverData ? `<img src="${b.coverData}" alt="${esc(b.title)}" class="w-full h-full object-cover group-hover:scale-[1.03] transition duration-500" />` :
      `<div class="w-full h-full bg-gradient-to-br from-brand-800 to-brand-600 grid place-items-center p-3"><div class="text-white text-center"><div class="font-display text-2xl font-bold leading-tight">${esc(b.title)}</div></div></div>`}
        <span class="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-white/95 text-[10px] font-bold text-ink-900">${esc(cls?.name || '')}</span>
      </a>
      <div class="p-4">
        <div class="text-[11px] text-brand-700 font-semibold">${esc(subjectMap[b.subjectId] || '—')}</div>
        <h3 class="mt-1 font-semibold text-ink-900 leading-snug line-clamp-2">${esc(b.title)}</h3>
        <p class="mt-1 text-xs text-ink-500 line-clamp-2">${esc(b.description || '')}</p>
        <div class="mt-3 flex gap-2">
          <a href="#/books/${b.id}" class="flex-1 text-center text-xs font-semibold py-2 rounded-lg bg-brand-800 hover:bg-brand-900 text-white">Akhriso</a>
          <button data-download="${b.id}" class="px-3 py-2 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50">${ICON.download.replace('<svg', '<svg width="16" height="16"')}</button>
        </div>
      </div>
    </div>`).join('');
}

async function pageBookView(id) {
  const u = State.user;
  const b = await DB.get('books', id);
  if (!b) return userLayout(`<div class="rounded-2xl border border-ink-100 bg-white p-12 text-center"><div class="text-ink-500">Buuggan lama helin.</div><a href="#/books" class="mt-4 inline-block text-brand-800 font-semibold">← Ku noqo buugaagta</a></div>`);
  if (b.classId !== u.classId || !b.isPublished) {
    return userLayout(`
      <div class="rounded-2xl border-2 border-ember-500/30 bg-ember-100 p-10 text-center max-w-lg mx-auto">
        <div class="w-14 h-14 rounded-2xl bg-ember-500/20 text-ember-700 grid place-items-center mx-auto">${ICON.lock.replace('<svg', '<svg width="26" height="26"')}</div>
        <h2 class="mt-4 font-display text-2xl font-bold text-ink-900">Buuggan fasalkaaga kuma jiro.</h2>
        <p class="mt-2 text-sm text-ink-600">Fasalkaaga kaliya ayaad arki kartaa buugaagta.</p>
        <a href="#/books" class="mt-5 inline-block px-5 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">← Ku noqo buugaagta</a>
      </div>
    `);
  }
  const subjects = await DB.all('subjects');
  const subject = subjects.find(s => s.id === b.subjectId);
  const cls = State.classes.find(c => c.id === b.classId);

  await DB.put('downloads', { id: uid('v_'), userId: u.id, bookId: b.id, kind: 'view', timestamp: Date.now() });

  const content = `
    <a href="#/books" class="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 mb-4">← Ku noqo</a>
    <div class="grid lg:grid-cols-12 gap-6">
      <div class="lg:col-span-4">
        <div class="rounded-2xl overflow-hidden border border-ink-100 bg-white">
          <div class="aspect-book bg-ink-100">
            ${b.coverData ? `<img src="${b.coverData}" alt="${esc(b.title)}" class="w-full h-full object-cover" />` :
      `<div class="w-full h-full bg-gradient-to-br from-brand-800 to-brand-600 grid place-items-center p-6"><div class="text-white text-center font-display text-3xl font-bold">${esc(b.title)}</div></div>`}
          </div>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <a href="#/books/${b.id}/read" class="col-span-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-800 hover:bg-brand-900 text-white font-semibold text-sm">${ICON.book.replace('<svg', '<svg width="16" height="16"')} Akhri buugga</a>
          <button data-download="${b.id}" class="col-span-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-ink-200 text-ink-800 hover:bg-ink-50 font-semibold text-sm">${ICON.download.replace('<svg', '<svg width="16" height="16"')} Download PDF</button>
        </div>
      </div>
      <div class="lg:col-span-8">
        <div class="text-[11px] font-bold uppercase tracking-widest text-brand-700">${esc(subject?.name || '—')} · ${esc(cls?.name || '')}</div>
        <h1 class="mt-2 font-display text-3xl sm:text-4xl font-bold text-ink-900 leading-tight">${esc(b.title)}</h1>
        <div class="mt-3 flex items-center gap-4 text-sm text-ink-500 flex-wrap">
          <div><b class="text-ink-700">Qoraa:</b> ${esc(b.author || '—')}</div>
          ${b.bookCode ? `<div><b class="text-ink-700">Koodh:</b> ${esc(b.bookCode)}</div>` : ''}
        </div>
        <p class="mt-6 text-ink-600 leading-relaxed">${esc(b.description || 'Ma jiro sharaxaad.')}</p>
        <div class="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="rounded-xl border border-ink-100 bg-white p-3">
            <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Bogag</div>
            <div class="font-display text-xl font-bold text-ink-900 mt-0.5">${b.pageCount || '—'}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-white p-3">
            <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Baaxad</div>
            <div class="font-display text-xl font-bold text-ink-900 mt-0.5">${fmtBytes(b.fileSize)}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-white p-3">
            <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Downloads</div>
            <div class="font-display text-xl font-bold text-ink-900 mt-0.5">${b.downloadCount || 0}</div>
          </div>
          <div class="rounded-xl border border-ink-100 bg-white p-3">
            <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Fasalka</div>
            <div class="font-display text-xl font-bold text-ink-900 mt-0.5">${esc(cls?.name || '')}</div>
          </div>
        </div>
      </div>
    </div>`;
  return userLayout(content, 'books');
}

async function pageBookRead(id) {
  const u = State.user;
  const b = await DB.get('books', id);
  if (!b) return userLayout(`<div class="p-12 text-center">Buuggan lama helin.</div>`);
  if (b.classId !== u.classId || !b.isPublished) {
    return userLayout(`<div class="p-12 text-center text-ember-700">Buuggan fasalkaaga kuma jiro.</div>`);
  }
  const content = `
    <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
      <a href="#/books/${b.id}" class="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">← Ku noqo</a>
      <div class="text-sm font-semibold text-ink-700 truncate flex-1 text-center">${esc(b.title)}</div>
      <button data-download="${b.id}" class="text-xs font-semibold px-3 py-2 rounded-lg border border-ink-200 hover:bg-ink-50 inline-flex items-center gap-1.5">${ICON.download.replace('<svg', '<svg width="14" height="14"')} Download</button>
    </div>
    <div class="rounded-2xl overflow-hidden border border-ink-100 bg-white" style="height:min(85vh, 900px)">
      ${b.pdfData ? `<iframe src="${b.pdfData}" class="w-full h-full" title="${esc(b.title)}"></iframe>` :
      `<div class="h-full grid place-items-center text-center p-8 text-ink-400"><div><div class="w-16 h-16 rounded-2xl bg-ink-50 grid place-items-center mx-auto">${ICON.doc.replace('<svg', '<svg width="28" height="28"')}</div><div class="mt-3 font-semibold text-ink-600">PDF-ga lama helin.</div></div></div>`}
    </div>`;
  return userLayout(content, 'books');
}

async function pageNotifications() {
  const u = State.user;
  const list = (await DB.all('notifications')).filter(n => n.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
  const icons = { success: '✓', info: 'ⓘ', warn: '!', error: '✕', announcement: '📣' };
  const colors = { success: 'bg-leaf-100 text-leaf-700', info: 'bg-brand-100 text-brand-800', warn: 'bg-gold-100 text-gold-700', error: 'bg-ember-100 text-ember-700', announcement: 'bg-brand-100 text-brand-800' };
  const content = `
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Ogeysiisyada</h1>
        <p class="mt-1 text-sm text-ink-500">Wax kasta oo ku saabsan account-kaaga.</p>
      </div>
      <button data-mark-all class="text-sm font-semibold text-brand-800 hover:underline">Mark all as read</button>
    </div>
    <div class="mt-6 space-y-2">
      ${list.length === 0 ? `
        <div class="rounded-2xl border-2 border-dashed border-ink-200 p-12 text-center">
          <div class="w-12 h-12 mx-auto rounded-xl bg-ink-50 grid place-items-center text-ink-400">${ICON.bell.replace('<svg', '<svg width="22" height="22"')}</div>
          <div class="mt-3 font-semibold text-ink-700">Wax ogeysiis ah ma jiraan.</div>
        </div>` :
      list.map(n => `
          <div class="rounded-2xl border ${n.isRead ? 'border-ink-100 bg-white' : 'border-brand-200 bg-brand-50/40'} p-4 flex gap-3">
            <div class="w-9 h-9 rounded-lg grid place-items-center shrink-0 ${colors[n.type] || colors.info}">${icons[n.type] || 'ⓘ'}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3">
                <div class="font-semibold text-ink-900">${esc(n.title)}</div>
                <div class="text-[11px] text-ink-400 shrink-0">${fmtDateTime(n.createdAt)}</div>
              </div>
              <p class="mt-1 text-sm text-ink-600">${esc(n.message)}</p>
              <div class="mt-2 flex gap-3 text-xs">
                ${!n.isRead ? `<button data-mark-read="${n.id}" class="text-brand-800 font-semibold hover:underline">Mark as read</button>` : ''}
                <button data-del-notif="${n.id}" class="text-ink-400 hover:text-ember-700">Tirtir</button>
              </div>
            </div>
          </div>`).join('')}
    </div>`;
  return userLayout(content, 'notifications');
}

async function pageProfile() {
  const u = State.user;
  const cls = State.classes.find(c => c.id === u.classId);
  const notifs = (await DB.all('notifications')).filter(n => n.userId === u.id).length;
  const downloads = (await DB.all('downloads')).filter(d => d.userId === u.id && d.kind === 'download').length;
  const content = `
    <div class="max-w-3xl">
      <div class="rounded-2xl bg-white border border-ink-100 p-6 sm:p-8">
        <div class="flex items-center gap-4 flex-wrap">
          <div class="w-16 h-16 rounded-2xl bg-brand-800 text-white grid place-items-center text-2xl font-bold">${esc(u.name.charAt(0).toUpperCase())}</div>
          <div class="min-w-0 flex-1">
            <div class="font-display text-2xl font-bold text-ink-900 truncate">${esc(u.name)}</div>
            <div class="text-sm text-ink-500">@${esc(u.username)}</div>
          </div>
          <div>${u.upgradeStatus === 'APPROVED' ? `<span class="px-3 py-1.5 rounded-full bg-leaf-100 text-leaf-700 text-xs font-bold">★ UPGRADED</span>` : `<a href="#/upgrade" class="px-3 py-1.5 rounded-full bg-gold-500 text-ink-900 text-xs font-bold">Upgrade</a>`}</div>
        </div>
        <div class="mt-6 grid sm:grid-cols-3 gap-3">
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Downloads</div><div class="font-display text-2xl font-bold mt-0.5">${downloads}</div></div>
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Ogeysiis</div><div class="font-display text-2xl font-bold mt-0.5">${notifs}</div></div>
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Fasalka</div><div class="font-display text-2xl font-bold mt-0.5">${esc(cls?.name || '—')}</div></div>
        </div>
      </div>

      <form id="profile-form" class="mt-6 rounded-2xl bg-white border border-ink-100 p-6 sm:p-8">
        <h2 class="font-display text-xl font-bold text-ink-900">Macluumaadkaaga</h2>
        <div class="mt-5 grid sm:grid-cols-2 gap-4">
          <label class="block">
            <span class="text-xs font-semibold text-ink-700">Magaca</span>
            <input name="name" value="${esc(u.name)}" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-ink-700">Username</span>
            <input value="${esc(u.username)}" disabled class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-100 text-sm text-ink-500" />
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-ink-700">Email</span>
            <input value="${esc(u.email)}" disabled class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-100 text-sm text-ink-500" />
          </label>
          <label class="block">
            <span class="text-xs font-semibold text-ink-700">Telefoon</span>
            <input name="phone" value="${esc(u.phone)}" class="mt-1.5 w-full px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
          </label>
          <label class="block sm:col-span-2">
            <span class="text-xs font-semibold text-ink-700">Fasalka</span>
            <div class="mt-1.5 flex items-center justify-between px-3.5 py-3 rounded-xl border border-ink-200 bg-ink-100 text-sm">
              <span class="font-semibold text-ink-900">${esc(cls?.name || '—')}</span>
              <span class="text-[11px] text-ink-500">Fasalka waxaa beddeli kara admin-ka.</span>
            </div>
          </label>
        </div>
        <div class="mt-6 flex flex-wrap gap-3">
          <button data-save class="px-5 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">Keydi isbeddelada</button>
          <button type="button" data-chpw class="px-5 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-50">Beddel password</button>
          <button type="button" onclick="doLogout()" class="ml-auto px-5 py-2.5 rounded-xl border border-ember-500/30 text-ember-700 text-sm font-semibold hover:bg-ember-100">Ka bax</button>
        </div>
      </form>

      <div class="mt-6 rounded-2xl bg-white border border-ink-100 p-6 sm:p-8">
        <h2 class="font-display text-xl font-bold text-ink-900">Account info</h2>
        <div class="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          <div class="flex justify-between py-2 border-b border-ink-100"><span class="text-ink-500">Account la sameeyay</span><span class="font-semibold">${fmtDate(u.createdAt)}</span></div>
          <div class="flex justify-between py-2 border-b border-ink-100"><span class="text-ink-500">Xaalada</span><span class="font-semibold">${u.upgradeStatus === 'APPROVED' ? 'Upgraded' : (u.upgradeStatus === 'PENDING' ? 'Pending' : 'Bilaash')}</span></div>
        </div>
      </div>
    </div>`;
  return userLayout(content, 'profile');
}

async function pageUpgrade() {
  const u = State.user;
  const existing = (await DB.all('upgradeRequests')).filter(r => r.userId === u.id).sort((a, b) => b.createdAt - a.createdAt)[0];
  const price = State.settings.upgradePrice || 1;
  const wa = (State.settings.whatsapp || APP.defaultWhatsApp).replace(/\D/g, '');
  const approved = u.upgradeStatus === 'APPROVED';
  const pending = existing && existing.status === 'PENDING';

  const content = `
    <div class="max-w-3xl mx-auto">
      <div class="rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 text-white p-6 sm:p-10 relative overflow-hidden">
        <div class="absolute inset-0 opacity-10" style="background-image:radial-gradient(circle at 20% 10%, #e5b955 0, transparent 40%)"></div>
        <div class="relative">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-xs font-bold uppercase tracking-widest">${approved ? '★ Account-kaaga waa upgraded' : (pending ? '⏳ Sugitaan' : 'Fasax')}</div>
          <h1 class="mt-4 font-display text-3xl sm:text-4xl font-bold leading-tight">${approved ? 'Waad heshay upgrade-ka WADAAG' : (pending ? 'Upgrade request-kaaga waa la helay' : 'Fur account-kaaga')}</h1>
          <p class="mt-3 text-white/70 max-w-lg">${approved ? 'Waad ku mahadsan tahay taageeradaada. Account-kaaga hadda waa mid upgraded ah — joogto ah.' : (pending ? 'Fadlan sug admin-ka si uu u xaqiijiyo lacag bixinta. Waad heli doontaa ogeysiis.' : 'Upgrade-kaaga waxaa admin-ku ku furayaa kadib xaqiijinta lacag bixinta.')}</p>
          ${!approved ? `
            <div class="mt-6 flex items-baseline gap-2">
              <div class="font-display text-6xl font-bold">$${price}</div>
              <div class="text-white/60 text-sm">lacag bixin hal mar · joogto ah</div>
            </div>` : ''}
        </div>
      </div>

      ${!approved ? `
      <div class="mt-6 grid sm:grid-cols-2 gap-3">
        <button data-upgrade-request class="rounded-2xl bg-gold-500 hover:bg-gold-400 text-ink-900 font-bold py-4 px-5 text-left">
          <div class="text-[10px] uppercase tracking-widest opacity-70">Codso</div>
          <div class="text-lg">Upgrade $${price}</div>
        </button>
        <a href="https://wa.me/${wa}?text=${encodeURIComponent(`Asc Wadaag Admin, waxaan rabaa inaan sameeyo upgrade $${price}. Username: ${u.username}`)}" target="_blank" rel="noopener" class="rounded-2xl bg-leaf-700 hover:bg-leaf-600 text-white font-bold py-4 px-5 flex items-center justify-between">
          <div class="text-left">
            <div class="text-[10px] uppercase tracking-widest opacity-80">WhatsApp</div>
            <div class="text-lg">La xiriir Admin</div>
          </div>
          <span class="w-6 h-6">${ICON.wa}</span>
        </a>
      </div>

      <div class="mt-6 rounded-2xl bg-white border border-ink-100 p-6">
        <h2 class="font-display text-lg font-bold text-ink-900">Sidee upgrade-ku u shaqeeyaa</h2>
        <ol class="mt-4 space-y-3 text-sm text-ink-600">
          <li class="flex gap-3"><span class="w-6 h-6 rounded-full bg-brand-50 text-brand-800 grid place-items-center text-xs font-bold shrink-0">1</span> Riix "Upgrade $${price}" — waxaan diiwaangelinayaa request-kaaga.</li>
          <li class="flex gap-3"><span class="w-6 h-6 rounded-full bg-brand-50 text-brand-800 grid place-items-center text-xs font-bold shrink-0">2</span> La xiriir admin-ka WhatsApp: <b>${esc(State.settings.whatsapp || APP.defaultWhatsApp)}</b>.</li>
          <li class="flex gap-3"><span class="w-6 h-6 rounded-full bg-brand-50 text-brand-800 grid place-items-center text-xs font-bold shrink-0">3</span> Admin-ku wuxuu xaqiijinayaa lacag bixinta.</li>
          <li class="flex gap-3"><span class="w-6 h-6 rounded-full bg-brand-50 text-brand-800 grid place-items-center text-xs font-bold shrink-0">4</span> Waxaad heli doontaa ogeysiis markii la ansixiyo.</li>
        </ol>
        <div class="mt-5 p-4 rounded-xl bg-ink-50 text-xs text-ink-600 leading-relaxed">
          ⚠️ <b>Muhiim:</b> Upgrade-ku <b>ma beddelo</b> fasalkaaga. Waxaad sii ahaanaysaa fasalka ${esc(State.classes.find(c => c.id === u.classId)?.name || '')}. Weli waxaad arki kartaa kaliya buugaagta fasalkaaga.
        </div>
      </div>
      ` : `
      <div class="mt-6 rounded-2xl border border-ink-100 bg-white p-6">
        <div class="grid sm:grid-cols-2 gap-4">
          <div class="rounded-xl bg-leaf-100 p-4"><div class="text-[10px] uppercase tracking-widest text-leaf-700 font-bold">Xaalada</div><div class="font-display text-xl font-bold text-ink-900 mt-1">Approved</div></div>
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Nooca</div><div class="font-display text-xl font-bold text-ink-900 mt-1">Permanent</div></div>
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Taariikhda</div><div class="font-display text-lg font-bold text-ink-900 mt-1">${fmtDate(u.upgradedAt)}</div></div>
          <div class="rounded-xl bg-ink-50 p-4"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Fasalka</div><div class="font-display text-lg font-bold text-ink-900 mt-1">${esc(State.classes.find(c => c.id === u.classId)?.name || '')}</div></div>
        </div>
      </div>`}

      ${existing ? `
      <div class="mt-6 rounded-2xl bg-white border border-ink-100 p-6">
        <h3 class="font-display text-lg font-bold text-ink-900">Taariikhda request-ka</h3>
        <div class="mt-3 space-y-2">
          ${(await DB.all('upgradeRequests')).filter(r => r.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).map(r => `
            <div class="flex items-center justify-between py-2 border-b border-ink-100 last:border-0 text-sm">
              <div><b>$${r.amount}</b> <span class="text-ink-400 text-xs">· ${fmtDateTime(r.createdAt)}</span></div>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${r.status === 'APPROVED' ? 'bg-leaf-100 text-leaf-700' : r.status === 'REJECTED' ? 'bg-ember-100 text-ember-700' : 'bg-gold-100 text-gold-700'}">${esc(r.status)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  return userLayout(content, 'profile');
}

/* ======================= ADMIN PAGES ======================= */
async function adminStats() {
  const [users, books, cls, upgrades, notifs, downloads] = await Promise.all([
    DB.all('users'), DB.all('books'), DB.all('classes'),
    DB.all('upgradeRequests'), DB.all('notifications'), DB.all('downloads'),
  ]);
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const students = users.filter(u => !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role));
  const perClass = {};
  cls.forEach(c => perClass[c.name] = students.filter(u => u.classId === c.id).length);
  return {
    totalUsers: students.length,
    perClass,
    totalBooks: books.length,
    publishedBooks: books.filter(b => b.isPublished).length,
    totalDownloads: downloads.filter(d => d.kind === 'download').length,
    pendingUpgrades: upgrades.filter(u => u.status === 'PENDING').length,
    approvedUpgrades: upgrades.filter(u => u.status === 'APPROVED').length,
    rejectedUpgrades: upgrades.filter(u => u.status === 'REJECTED').length,
    upgradedUsers: students.filter(u => u.upgradeStatus === 'APPROVED').length,
    activeUsers: students.filter(u => u.isActive).length,
    newToday: students.filter(u => now - u.createdAt < day).length,
    newWeek: students.filter(u => now - u.createdAt < 7 * day).length,
    newMonth: students.filter(u => now - u.createdAt < 30 * day).length,
    notificationsSent: notifs.length,
    totalClasses: cls.length,
    totalUsersAll: users.length,
  };
}

async function pageAdminDashboard() {
  const s = await adminStats();
  const allUsers = await DB.all('users');
  const recentUsers = allUsers.filter(u => !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const pendingUps = (await DB.all('upgradeRequests')).filter(r => r.status === 'PENDING').sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const classNames = State.classes.map(c => c.name);

  const stat = (label, value, sub, color = 'text-ink-900') => `
    <div class="rounded-2xl bg-white border border-ink-100 p-5">
      <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">${label}</div>
      <div class="font-display text-3xl font-bold mt-1 ${color}">${value}</div>
      ${sub ? `<div class="text-xs text-ink-500 mt-1">${sub}</div>` : ''}
    </div>`;

  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Dashboard</h1>
        <p class="mt-1 text-sm text-ink-500">Guudmarka WADAAG.</p>
      </div>
      <div class="text-xs text-ink-400">${fmtDateTime(Date.now())}</div>
    </div>

    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${stat('Users', s.totalUsers)}
      ${stat('Buugaag', s.totalBooks, `${s.publishedBooks} la daabacay`)}
      ${stat('Downloads', s.totalDownloads)}
      ${stat('Ogeysiis', s.notificationsSent)}
    </div>

    <div class="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
      ${classNames.map(n => stat('Fasalka ' + n, s.perClass[n] || 0)).join('')}
    </div>

    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${stat('Pending Upgrade', s.pendingUpgrades, '', 'text-gold-700')}
      ${stat('Approved', s.approvedUpgrades, '', 'text-leaf-700')}
      ${stat('Rejected', s.rejectedUpgrades, '', 'text-ember-700')}
      ${stat('Upgraded Users', s.upgradedUsers)}
    </div>

    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${stat('Cusub maanta', s.newToday)}
      ${stat('Toddobaadkan', s.newWeek)}
      ${stat('Bishan', s.newMonth)}
      ${stat('Active', s.activeUsers)}
    </div>

    <div class="mt-8 grid lg:grid-cols-2 gap-4">
      <div class="rounded-2xl bg-white border border-ink-100 p-5">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-lg font-bold text-ink-900">Users-ka cusub</h2>
          <a href="#/admin/users" class="text-xs font-semibold text-brand-800 hover:underline">Arag dhammaan →</a>
        </div>
        <div class="mt-4 divide-y divide-ink-100">
          ${recentUsers.length === 0 ? `<div class="text-sm text-ink-400 py-6 text-center">Ma jiraan.</div>` :
      recentUsers.map(u => {
        const cl = State.classes.find(c => c.id === u.classId);
        return `<div class="flex items-center gap-3 py-2.5">
              <span class="w-9 h-9 rounded-full bg-brand-800 text-white grid place-items-center text-sm font-bold">${esc(u.name.charAt(0))}</span>
              <div class="flex-1 min-w-0"><div class="font-semibold text-sm truncate">${esc(u.name)}</div><div class="text-xs text-ink-400">@${esc(u.username)} · ${esc(u.email)}</div></div>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-ink-50 text-ink-700">${esc(cl?.name || '—')}</span>
            </div>`;
      }).join('')}
        </div>
      </div>

      <div class="rounded-2xl bg-white border border-ink-100 p-5">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-lg font-bold text-ink-900">Upgrade Requests</h2>
          <a href="#/admin/upgrades" class="text-xs font-semibold text-brand-800 hover:underline">Arag dhammaan →</a>
        </div>
        <div class="mt-4 space-y-2">
          ${pendingUps.length === 0 ? `<div class="text-sm text-ink-400 py-6 text-center">Ma jiraan request-yo pending ah.</div>` :
      pendingUps.map(r => {
        const usr = allUsers.find(x => x.id === r.userId);
        const cl = State.classes.find(c => c.id === usr?.classId);
        return `<div class="rounded-xl border border-gold-200 bg-gold-100/50 p-3 flex items-center gap-3">
              <span class="w-9 h-9 rounded-full bg-gold-500 text-ink-900 grid place-items-center text-sm font-bold">$</span>
              <div class="flex-1 min-w-0"><div class="font-semibold text-sm truncate">${esc(usr?.name || '—')}</div><div class="text-xs text-ink-500">@${esc(usr?.username || '')} · ${esc(cl?.name || '')}</div></div>
              <a href="#/admin/upgrades" class="text-xs font-bold text-gold-700">Fur →</a>
            </div>`;
      }).join('')}
        </div>
      </div>
    </div>
  `;
  return adminLayout(content, 'dashboard');
}

async function pageAdminUsers() {
  const users = (await DB.all('users')).filter(u => !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role));
  const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Users</h1>
        <p class="mt-1 text-sm text-ink-500">Maamul ardayda — fasalka, xaalada, upgrade.</p>
      </div>
      <div class="flex gap-2">
        <button data-export-users class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-50">${ICON.download.replace('<svg', '<svg width="14" height="14"')} CSV</button>
      </div>
    </div>

    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="p-4 border-b border-ink-100 flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 w-4 h-4">${ICON.search}</span>
          <input data-user-search placeholder="Raadi magac, username, email..." class="w-full pl-9 pr-3 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
        </div>
        <select data-user-class class="px-3 py-2.5 rounded-xl border border-ink-200 bg-ink-50 text-sm">
          <option value="">Dhammaan fasallada</option>
          ${State.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select>
        <select data-user-upgrade class="px-3 py-2.5 rounded-xl border border-ink-200 bg-ink-50 text-sm">
          <option value="">Xaalad kasta</option>
          <option value="APPROVED">Upgraded</option>
          <option value="PENDING">Pending</option>
          <option value="NONE">Bilaash</option>
        </select>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
              <th class="px-4 py-3 font-semibold">User</th>
              <th class="px-4 py-3 font-semibold">Fasalka</th>
              <th class="px-4 py-3 font-semibold">Upgrade</th>
              <th class="px-4 py-3 font-semibold hidden sm:table-cell">La sameeyay</th>
              <th class="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody data-users-body class="divide-y divide-ink-100">
            ${renderUsersTable(users, classMap)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return adminLayout(content, 'users');
}
function renderUsersTable(users, classMap) {
  if (users.length === 0) return `<tr><td colspan="5" class="px-4 py-12 text-center text-ink-400">Ma jiraan users.</td></tr>`;
  return users.sort((a, b) => b.createdAt - a.createdAt).map(u => `
    <tr class="hover:bg-ink-50/50">
      <td class="px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="w-8 h-8 rounded-full bg-brand-800 text-white grid place-items-center text-xs font-bold">${esc(u.name.charAt(0))}</span>
          <div class="min-w-0">
            <div class="font-semibold text-ink-900 truncate">${esc(u.name)}</div>
            <div class="text-xs text-ink-400 truncate">@${esc(u.username)} · ${esc(u.email)}</div>
          </div>
        </div>
      </td>
      <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-ink-100 text-ink-700">${esc(classMap[u.classId] || '—')}</span></td>
      <td class="px-4 py-3">
        ${u.upgradeStatus === 'APPROVED' ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-leaf-100 text-leaf-700">UPGRADED</span>` :
      u.upgradeStatus === 'PENDING' ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gold-100 text-gold-700">PENDING</span>` :
        `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-ink-100 text-ink-500">BILAASH</span>`}
      </td>
      <td class="px-4 py-3 hidden sm:table-cell text-xs text-ink-500">${fmtDate(u.createdAt)}</td>
      <td class="px-4 py-3 text-right">
        <button data-user-view="${u.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-800 hover:bg-brand-50">Maamul</button>
      </td>
    </tr>`).join('');
}

async function openUserManager(userId) {
  const u = await DB.get('users', userId);
  if (!u) return;
  const cls = State.classes.find(c => c.id === u.classId);
  const downloads = (await DB.all('downloads')).filter(d => d.userId === u.id && d.kind === 'download');
  const w = modal(`
    <div class="p-6 border-b border-ink-100 flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="w-12 h-12 rounded-xl bg-brand-800 text-white grid place-items-center text-lg font-bold">${esc(u.name.charAt(0))}</span>
        <div>
          <div class="font-display text-xl font-bold text-ink-900">${esc(u.name)}</div>
          <div class="text-xs text-ink-500">@${esc(u.username)} · ${esc(u.email)}</div>
        </div>
      </div>
      <button data-close class="p-2 rounded-lg hover:bg-ink-100">${ICON.x.replace('<svg', '<svg width="18" height="18"')}</button>
    </div>
    <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        <div class="rounded-xl bg-ink-50 p-3"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Telefoon</div><div class="mt-0.5 font-semibold">${esc(u.phone || '—')}</div></div>
        <div class="rounded-xl bg-ink-50 p-3"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Fasalka</div><div class="mt-0.5 font-semibold">${esc(cls?.name || '—')}</div></div>
        <div class="rounded-xl bg-ink-50 p-3"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Upgrade</div><div class="mt-0.5 font-semibold">${u.upgradeStatus === 'APPROVED' ? '★ Upgraded (' + (u.upgradeType || 'permanent') + ')' : u.upgradeStatus}</div></div>
        <div class="rounded-xl bg-ink-50 p-3"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Downloads</div><div class="mt-0.5 font-semibold">${downloads.length}</div></div>
      </div>

      <div class="rounded-xl border border-ink-100 p-4">
        <div class="text-xs font-bold text-ink-700 uppercase tracking-wider mb-3">Fasalka beddel</div>
        <div class="flex flex-wrap gap-2">
          ${State.classes.map(c => `<button data-set-class="${c.id}" class="px-3 py-2 rounded-lg text-sm font-semibold border-2 ${u.classId === c.id ? 'border-brand-800 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-700 hover:border-brand-300'}">${esc(c.name)}</button>`).join('')}
        </div>
      </div>

      <div class="rounded-xl border border-ink-100 p-4">
        <div class="text-xs font-bold text-ink-700 uppercase tracking-wider mb-3">Xaalada</div>
        <div class="flex flex-wrap gap-2">
          <button data-act="toggle-active" class="px-3 py-2 rounded-lg text-sm font-semibold border ${u.isActive ? 'border-ember-200 text-ember-700' : 'border-leaf-200 text-leaf-700'} hover:bg-ink-50">${u.isActive ? 'Disable' : 'Enable'}</button>
          ${u.upgradeStatus !== 'APPROVED' ? `<button data-act="approve-upgrade" class="px-3 py-2 rounded-lg text-sm font-semibold bg-leaf-700 text-white hover:bg-leaf-600">Approve upgrade</button>` :
      `<button data-act="revoke-upgrade" class="px-3 py-2 rounded-lg text-sm font-semibold border border-ember-200 text-ember-700 hover:bg-ember-100">Revoke upgrade</button>`}
          <button data-act="reset-password" class="px-3 py-2 rounded-lg text-sm font-semibold border border-ink-200 text-ink-700 hover:bg-ink-50">Reset password</button>
          <button data-act="notify" class="px-3 py-2 rounded-lg text-sm font-semibold border border-ink-200 text-ink-700 hover:bg-ink-50">Send notification</button>
          <button data-act="delete" class="px-3 py-2 rounded-lg text-sm font-semibold border border-ember-200 text-ember-700 hover:bg-ember-100 ml-auto">Delete user</button>
        </div>
      </div>

      <div class="rounded-xl border border-ink-100 p-4">
        <div class="text-xs font-bold text-ink-700 uppercase tracking-wider mb-2">Downloads taariikh</div>
        ${downloads.length === 0 ? `<div class="text-xs text-ink-400">Ma jiraan downloads.</div>` :
      `<div class="space-y-1 text-xs max-h-40 overflow-y-auto">
          ${downloads.slice(-10).reverse().map(d => `
            <div class="flex justify-between py-1 border-b border-ink-50"><span>${esc(d.bookId.slice(0, 12))}…</span><span class="text-ink-400">${fmtDate(d.timestamp)}</span></div>`).join('')}
        </div>`}
      </div>
    </div>
  `, { width: 'max-w-2xl' });

  w.querySelector('[data-close]').onclick = () => w.close();
  w.querySelectorAll('[data-set-class]').forEach(b => b.onclick = async () => {
    if (!await confirmBox({ title: 'Beddel fasalka?', message: `U beddel user-ka fasalka ${State.classes.find(c => c.id === b.dataset.setClass)?.name}?`, confirmText: 'Haa' })) return;
    u.classId = b.dataset.setClass;
    await DB.put('users', u);
    const cn = State.classes.find(c => c.id === u.classId)?.name;
    await notify(u.id, 'Fasalka waa la beddelay', `Admin-ku wuxuu fasalkaaga u beddelay ${cn}.`, 'warn');
    await audit('change_class', 'user', u.id, { to: cn });
    toast('Fasalka waa la beddelay', 'success');
    w.close(); render();
  });
  w.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const act = b.dataset.act;
    if (act === 'toggle-active') {
      u.isActive = !u.isActive;
      await DB.put('users', u);
      await audit('toggle_user', 'user', u.id, { active: u.isActive });
      toast(u.isActive ? 'La furay' : 'La xidhay', 'success');
      w.close(); render();
    } else if (act === 'approve-upgrade') {
      u.upgradeStatus = 'APPROVED'; u.upgradeType = 'PERMANENT'; u.upgradedAt = Date.now(); u.approvedBy = State.user.id;
      await DB.put('users', u);
      await notify(u.id, 'Upgrade waa laguu furay', 'Upgrade-ka account-kaaga Wadaag waa la ansixiyay.', 'success');
      await audit('approve_upgrade', 'user', u.id, {});
      toast('Upgrade approved', 'success');
      w.close(); render();
    } else if (act === 'revoke-upgrade') {
      if (!await confirmBox({ title: 'Revoke upgrade?', confirmText: 'Haa', danger: true })) return;
      u.upgradeStatus = 'NONE'; u.upgradeType = null; u.upgradedAt = null;
      await DB.put('users', u);
      await notify(u.id, 'Upgrade waa la joojiyay', 'Upgrade-ka account-kaaga waa la joojiyay. La xiriir admin-ka.', 'warn');
      await audit('revoke_upgrade', 'user', u.id, {});
      toast('Upgrade revoked', 'warn');
      w.close(); render();
    } else if (act === 'reset-password') {
      const np = prompt('Password cusub (ugu yaraan 6):');
      if (!np || np.length < 6) return;
      u.passwordHash = await hashPassword(np);
      await DB.put('users', u);
      await audit('reset_password', 'user', u.id, {});
      toast('Password waa la beddelay', 'success');
    } else if (act === 'notify') {
      const t = prompt('Title:') || 'Ogeysiis';
      const m = prompt('Message:') || '';
      if (!m) return;
      await notify(u.id, t, m, 'info');
      await audit('send_notification', 'user', u.id, { title: t });
      toast('Notification la diray', 'success');
    } else if (act === 'delete') {
      if (!await confirmBox({ title: 'Delete user?', message: 'Waa lama noqon karo.', confirmText: 'Delete', danger: true })) return;
      await DB.delete('users', u.id);
      await audit('delete_user', 'user', u.id, {});
      toast('La tirtiray', 'warn');
      w.close(); render();
    }
  });
}

async function pageAdminClasses() {
  const cls = State.classes;
  const users = await DB.all('users');
  const books = await DB.all('books');
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Classes</h1>
        <p class="mt-1 text-sm text-ink-500">Fasallada WADAAG.</p>
      </div>
      <button data-new-class class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.plus.replace('<svg', '<svg width="16" height="16"')} Class cusub</button>
    </div>
    <div class="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${cls.map(c => {
    const uCount = users.filter(u => u.classId === c.id).length;
    const bCount = books.filter(b => b.classId === c.id).length;
    return `<div class="rounded-2xl bg-white border border-ink-100 p-5">
          <div class="flex items-start justify-between">
            <div>
              <div class="font-display text-3xl font-bold text-ink-900">${esc(c.name)}</div>
              <div class="text-xs text-ink-500 mt-1">${esc(c.description || '')}</div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${c.isActive ? 'bg-leaf-100 text-leaf-700' : 'bg-ink-100 text-ink-500'}">${c.isActive ? 'ACTIVE' : 'OFF'}</span>
          </div>
          <div class="mt-4 flex gap-4 text-sm">
            <div><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Users</div><div class="font-semibold">${uCount}</div></div>
            <div><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">Books</div><div class="font-semibold">${bCount}</div></div>
          </div>
          <div class="mt-4 flex gap-2">
            <button data-edit-class="${c.id}" class="text-xs font-semibold text-brand-800 hover:underline">Edit</button>
            <button data-toggle-class="${c.id}" class="text-xs font-semibold text-ink-500 hover:underline">${c.isActive ? 'Disable' : 'Enable'}</button>
            <button data-del-class="${c.id}" class="text-xs font-semibold text-ember-700 hover:underline ml-auto">Delete</button>
          </div>
        </div>`;
  }).join('')}
    </div>`;
  return adminLayout(content, 'classes');
}

async function pageAdminSubjects() {
  const subs = await DB.all('subjects');
  const books = await DB.all('books');
  const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Subjects</h1>
        <p class="mt-1 text-sm text-ink-500">Maaddooyinka guud.</p>
      </div>
      <button data-new-subject class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.plus.replace('<svg', '<svg width="16" height="16"')} Subject cusub</button>
    </div>
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
            <th class="px-4 py-3 font-semibold">Magaca</th>
            <th class="px-4 py-3 font-semibold">Fasalka (optional)</th>
            <th class="px-4 py-3 font-semibold">Buugaag</th>
            <th class="px-4 py-3 font-semibold">Xaalada</th>
            <th class="px-4 py-3 font-semibold text-right">Actions</th>
          </tr></thead>
          <tbody class="divide-y divide-ink-100">
            ${subs.map(s => {
    const cnt = books.filter(b => b.subjectId === s.id).length;
    return `<tr class="hover:bg-ink-50/50">
                <td class="px-4 py-3 font-semibold text-ink-900">${esc(s.name)}</td>
                <td class="px-4 py-3 text-ink-500">${s.classId ? esc(classMap[s.classId] || '—') : 'Dhammaan'}</td>
                <td class="px-4 py-3">${cnt}</td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${s.isActive ? 'bg-leaf-100 text-leaf-700' : 'bg-ink-100 text-ink-500'}">${s.isActive ? 'ACTIVE' : 'OFF'}</span></td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button data-edit-subject="${s.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-800 hover:bg-brand-50">Edit</button>
                  <button data-del-subject="${s.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-ember-700 hover:bg-ember-100">Delete</button>
                </td>
              </tr>`;
  }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return adminLayout(content, 'subjects');
}

async function pageAdminBooks() {
  const books = (await DB.all('books')).sort((a, b) => b.createdAt - a.createdAt);
  const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
  const subs = await DB.all('subjects');
  const subjectMap = Object.fromEntries(subs.map(s => [s.id, s.name]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Books</h1>
        <p class="mt-1 text-sm text-ink-500">Buugaag PDF ee fasallada.</p>
      </div>
      <button data-new-book class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.plus.replace('<svg', '<svg width="16" height="16"')} Buug cusub</button>
    </div>
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
            <th class="px-4 py-3 font-semibold">Buug</th>
            <th class="px-4 py-3 font-semibold">Fasalka</th>
            <th class="px-4 py-3 font-semibold hidden sm:table-cell">Maaddo</th>
            <th class="px-4 py-3 font-semibold hidden md:table-cell">Downloads</th>
            <th class="px-4 py-3 font-semibold">Xaalada</th>
            <th class="px-4 py-3 font-semibold text-right">Actions</th>
          </tr></thead>
          <tbody class="divide-y divide-ink-100">
            ${books.length === 0 ? `<tr><td colspan="6" class="px-4 py-12 text-center text-ink-400">Ma jiraan buugaag.</td></tr>` :
      books.map(b => `
              <tr class="hover:bg-ink-50/50">
                <td class="px-4 py-3">
                  <div class="flex items-center gap-3">
                    <div class="w-9 h-12 rounded bg-ink-100 overflow-hidden shrink-0">
                      ${b.coverData ? `<img src="${b.coverData}" class="w-full h-full object-cover"/>` : `<div class="w-full h-full bg-brand-800"></div>`}
                    </div>
                    <div class="min-w-0">
                      <div class="font-semibold text-ink-900 truncate">${esc(b.title)}</div>
                      <div class="text-xs text-ink-400 truncate">${esc(b.author || '—')}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-ink-100 text-ink-700">${esc(classMap[b.classId] || '—')}</span></td>
                <td class="px-4 py-3 hidden sm:table-cell text-ink-600">${esc(subjectMap[b.subjectId] || '—')}</td>
                <td class="px-4 py-3 hidden md:table-cell text-ink-600">${b.downloadCount || 0}</td>
                <td class="px-4 py-3">
                  <button data-toggle-pub="${b.id}" class="px-2 py-0.5 rounded text-[10px] font-bold ${b.isPublished ? 'bg-leaf-100 text-leaf-700' : 'bg-ink-100 text-ink-500'}">${b.isPublished ? 'PUBLISHED' : 'DRAFT'}</button>
                </td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button data-edit-book="${b.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-800 hover:bg-brand-50">Edit</button>
                  <button data-del-book="${b.id}" class="px-3 py-1.5 rounded-lg text-xs font-semibold text-ember-700 hover:bg-ember-100">Delete</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return adminLayout(content, 'books');
}

async function openBookEditor(bookId) {
  const b = bookId ? await DB.get('books', bookId) : { id: uid('b_'), title: '', description: '', author: '', classId: State.classes[0]?.id || '', subjectId: '', coverData: null, pdfData: null, fileSize: 0, pageCount: null, bookCode: '', isPublished: false, downloadCount: 0, createdAt: Date.now() };
  const subs = await DB.all('subjects');
  const cls = State.classes;
  const w = modal(`
    <form data-book-form class="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
      <div class="flex items-center justify-between">
        <div class="font-display text-2xl font-bold text-ink-900">${bookId ? 'Edit buug' : 'Buug cusub'}</div>
        <button type="button" data-close class="p-2 rounded-lg hover:bg-ink-100">${ICON.x.replace('<svg', '<svg width="18" height="18"')}</button>
      </div>
      <label class="block">
        <span class="text-xs font-semibold text-ink-700">Cinwaanka *</span>
        <input name="title" required value="${esc(b.title)}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
      </label>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">Fasalka *</span>
          <select name="classId" required class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm">
            ${cls.map(c => `<option value="${c.id}" ${b.classId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">Maaddada</span>
          <select name="subjectId" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm">
            <option value="">— Dooro —</option>
            ${subs.map(s => `<option value="${s.id}" ${b.subjectId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">Qoraa</span>
          <input name="author" value="${esc(b.author)}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" />
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">Book code</span>
          <input name="bookCode" value="${esc(b.bookCode || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm" placeholder="MTH-F8-001" />
        </label>
      </div>
      <label class="block">
        <span class="text-xs font-semibold text-ink-700">Sharaxaad gaaban</span>
        <textarea name="description" rows="3" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm">${esc(b.description || '')}</textarea>
      </label>
      <div class="grid sm:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">Cover image (image/*)</span>
          <input type="file" name="cover" accept="image/*" class="mt-1.5 w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-brand-800 file:text-white file:text-xs file:font-semibold" />
          ${b.coverData ? `<img src="${b.coverData}" class="mt-2 h-24 rounded-lg border border-ink-100"/>` : ''}
        </label>
        <label class="block">
          <span class="text-xs font-semibold text-ink-700">PDF file (application/pdf)</span>
          <input type="file" name="pdf" accept="application/pdf" class="mt-1.5 w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-brand-800 file:text-white file:text-xs file:font-semibold" />
          ${b.pdfData ? `<div class="mt-2 text-xs text-ink-500">PDF la keydiyay (${fmtBytes(b.fileSize)})</div>` : ''}
        </label>
      </div>
      <label class="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublished" ${b.isPublished ? 'checked' : ''} class="rounded border-ink-300 text-brand-800 focus:ring-brand-500" />
        <span class="font-semibold text-ink-700">Publish (muuji ardayda)</span>
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" data-close class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold">Jooji</button>
        <button type="submit" class="px-5 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">Keydi</button>
      </div>
    </form>
  `, { width: 'max-w-2xl' });

  w.querySelectorAll('[data-close]').forEach(b2 => b2.onclick = () => w.close());
  const form = w.querySelector('[data-book-form]');
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const coverFile = fd.get('cover');
    const pdfFile = fd.get('pdf');
    if (coverFile && coverFile.size) {
      if (!coverFile.type.startsWith('image/')) return toast('Cover waa inuu image yahay', 'error');
      b.coverData = await fileToDataUrl(coverFile);
    }
    if (pdfFile && pdfFile.size) {
      if (pdfFile.type !== 'application/pdf') return toast('PDF-ga lama aqbalin.', 'error');
      const maxMB = State.settings.maxUploadMB || 25;
      if (pdfFile.size > maxMB * 1024 * 1024) return toast(`PDF-ga waa inuu ka yar yahay ${maxMB}MB`, 'error');
      b.pdfData = await fileToDataUrl(pdfFile);
      b.fileSize = pdfFile.size;
    }
    b.title = fd.get('title');
    b.classId = fd.get('classId');
    b.subjectId = fd.get('subjectId') || null;
    b.author = fd.get('author');
    b.bookCode = fd.get('bookCode');
    b.description = fd.get('description');
    b.isPublished = !!fd.get('isPublished');
    b.updatedAt = Date.now();
    await DB.put('books', b);
    await audit(bookId ? 'edit_book' : 'create_book', 'book', b.id, { title: b.title });
    if (!bookId && b.isPublished) {
      const users = (await DB.all('users')).filter(u => u.classId === b.classId && !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role));
      await notifyMany(users.map(u => u.id), 'Buug cusub', `Buug cusub: ${b.title}`, 'success');
    }
    toast(bookId ? 'Buugga waa la cusboonaysiiyay' : 'Buugga waa lagu daray', 'success');
    w.close(); render();
  };
}

function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function pageAdminUpgrades() {
  const reqs = (await DB.all('upgradeRequests')).sort((a, b) => b.createdAt - a.createdAt);
  const users = await DB.all('users');
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Upgrade Requests</h1>
        <p class="mt-1 text-sm text-ink-500">Codsiyada upgrade-ka ee $1.</p>
      </div>
    </div>
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
            <th class="px-4 py-3 font-semibold">User</th>
            <th class="px-4 py-3 font-semibold">Fasalka</th>
            <th class="px-4 py-3 font-semibold">Qiimaha</th>
            <th class="px-4 py-3 font-semibold">Xaalada</th>
            <th class="px-4 py-3 font-semibold hidden sm:table-cell">Taariikhda</th>
            <th class="px-4 py-3 font-semibold text-right">Actions</th>
          </tr></thead>
          <tbody class="divide-y divide-ink-100">
            ${reqs.length === 0 ? `<tr><td colspan="6" class="px-4 py-12 text-center text-ink-400">Ma jiraan codsiyo.</td></tr>` :
      reqs.map(r => {
        const u = userMap[r.userId];
        return `<tr class="hover:bg-ink-50/50">
                <td class="px-4 py-3">
                  <div class="font-semibold text-ink-900">${esc(u?.name || '—')}</div>
                  <div class="text-xs text-ink-400">@${esc(u?.username || '')} · ${esc(u?.phone || '')}</div>
                </td>
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold bg-ink-100 text-ink-700">${esc(classMap[u?.classId] || '—')}</span></td>
                <td class="px-4 py-3 font-semibold">$${r.amount}</td>
                <td class="px-4 py-3">
                  ${r.status === 'APPROVED' ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-leaf-100 text-leaf-700">APPROVED</span>` :
            r.status === 'REJECTED' ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-ember-100 text-ember-700">REJECTED</span>` :
              `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gold-100 text-gold-700">PENDING</span>`}
                </td>
                <td class="px-4 py-3 hidden sm:table-cell text-xs text-ink-500">${fmtDate(r.createdAt)}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  ${r.status === 'PENDING' ? `
                    <button data-appr="${r.id}" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-leaf-700 text-white hover:bg-leaf-600">Approve</button>
                    <button data-rej="${r.id}" class="px-3 py-1.5 rounded-lg text-xs font-bold border border-ember-200 text-ember-700 hover:bg-ember-100">Reject</button>
                  ` : `<span class="text-xs text-ink-400">—</span>`}
                </td>
              </tr>`;
      }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return adminLayout(content, 'upgrades');
}

async function pageAdminNotifications() {
  const users = await DB.all('users');
  const notifications = (await DB.all('notifications')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Notifications</h1>
        <p class="mt-1 text-sm text-ink-500">Dir ogeysiis ardayda.</p>
      </div>
      <button data-new-notif class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.plus.replace('<svg', '<svg width="16" height="16"')} Ogeysiis cusub</button>
    </div>

    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="p-4 border-b border-ink-100 text-sm font-semibold text-ink-700">Ogeysiisyada ugu dambeeyay (${notifications.length})</div>
      <div class="divide-y divide-ink-100 max-h-[70vh] overflow-y-auto">
        ${notifications.length === 0 ? `<div class="p-12 text-center text-ink-400 text-sm">Ma jiraan.</div>` :
      notifications.map(n => `
          <div class="p-4 flex gap-3">
            <div class="w-8 h-8 rounded-lg bg-brand-50 text-brand-800 grid place-items-center shrink-0">${ICON.bell.replace('<svg', '<svg width="16" height="16"')}</div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <div class="font-semibold text-sm text-ink-900 truncate">${esc(n.title)}</div>
                <div class="text-[11px] text-ink-400 shrink-0">${fmtDateTime(n.createdAt)}</div>
              </div>
              <div class="text-sm text-ink-600 mt-0.5">${esc(n.message)}</div>
              <div class="text-[11px] text-ink-400 mt-1">→ ${esc(userMap[n.userId]?.name || '—')}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  return adminLayout(content, 'notifications');
}

async function pageAdminAnnouncements() {
  const anns = (await DB.all('announcements')).sort((a, b) => b.createdAt - a.createdAt);
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Announcements</h1>
        <p class="mt-1 text-sm text-ink-500">Ogeysiisyada guud ee fasallada.</p>
      </div>
      <button data-new-ann class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.plus.replace('<svg', '<svg width="16" height="16"')} Ku dar</button>
    </div>
    <div class="mt-6 space-y-3">
      ${anns.length === 0 ? `<div class="rounded-2xl border-2 border-dashed border-ink-200 p-12 text-center text-ink-400">Ma jiraan.</div>` :
      anns.map(a => {
        const cls = State.classes.find(c => c.id === a.targetClass);
        return `<div class="rounded-2xl bg-white border border-ink-100 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="font-display text-lg font-bold text-ink-900">${esc(a.title)}</div>
              <div class="text-xs text-ink-400 mt-1">${fmtDateTime(a.createdAt)} · ${a.targetClass ? esc(cls?.name || '—') : 'Dhammaan'}</div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${a.status === 'ACTIVE' ? 'bg-leaf-100 text-leaf-700' : 'bg-ink-100 text-ink-500'}">${esc(a.status)}</span>
          </div>
          <p class="mt-3 text-sm text-ink-600">${esc(a.message)}</p>
          <div class="mt-4 flex gap-2">
            <button data-del-ann="${a.id}" class="text-xs font-semibold text-ember-700 hover:underline ml-auto">Tirtir</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  return adminLayout(content, 'announcements');
}

async function pageAdminDownloads() {
  const downloads = (await DB.all('downloads')).filter(d => d.kind === 'download').sort((a, b) => b.timestamp - a.timestamp);
  const users = await DB.all('users');
  const books = await DB.all('books');
  const uMap = Object.fromEntries(users.map(u => [u.id, u]));
  const bMap = Object.fromEntries(books.map(b => [b.id, b]));
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Downloads</h1>
        <p class="mt-1 text-sm text-ink-500">Dhammaan downloads-ka.</p>
      </div>
      <button data-export-dl class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold text-ink-700 hover:bg-ink-50">${ICON.download.replace('<svg', '<svg width="14" height="14"')} CSV</button>
    </div>
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
            <th class="px-4 py-3 font-semibold">User</th>
            <th class="px-4 py-3 font-semibold">Buug</th>
            <th class="px-4 py-3 font-semibold">Taariikhda</th>
          </tr></thead>
          <tbody class="divide-y divide-ink-100">
            ${downloads.length === 0 ? `<tr><td colspan="3" class="px-4 py-12 text-center text-ink-400">Ma jiraan.</td></tr>` :
      downloads.slice(0, 200).map(d => `
              <tr class="hover:bg-ink-50/50">
                <td class="px-4 py-3 font-semibold text-ink-900">${esc(uMap[d.userId]?.name || '—')}</td>
                <td class="px-4 py-3 text-ink-700">${esc(bMap[d.bookId]?.title || '—')}</td>
                <td class="px-4 py-3 text-xs text-ink-500">${fmtDateTime(d.timestamp)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return adminLayout(content, 'downloads');
}

async function pageAdminReports() {
  const s = await adminStats();
  const books = await DB.all('books');
  const users = await DB.all('users');
  const topBooks = [...books].sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0)).slice(0, 10);
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Reports</h1>
        <p class="mt-1 text-sm text-ink-500">Guudmarka xogta.</p>
      </div>
    </div>
    <div class="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
      ${[['Users', s.totalUsers], ['Buugaag', s.totalBooks], ['Downloads', s.totalDownloads], ['Ogeysiis', s.notificationsSent]].map(([l, v]) => `
        <div class="rounded-2xl bg-white border border-ink-100 p-5"><div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">${l}</div><div class="font-display text-3xl font-bold mt-1">${v}</div></div>
      `).join('')}
    </div>

    <div class="mt-6 grid lg:grid-cols-2 gap-4">
      <div class="rounded-2xl bg-white border border-ink-100 p-5">
        <h3 class="font-display text-lg font-bold text-ink-900">Buugaagta ugu badan</h3>
        <div class="mt-4 space-y-2 text-sm">
          ${topBooks.map((b, i) => `
            <div class="flex items-center gap-3">
              <span class="w-6 text-ink-400 font-mono text-xs">${String(i + 1).padStart(2, '0')}</span>
              <span class="flex-1 truncate font-medium text-ink-800">${esc(b.title)}</span>
              <span class="text-ink-500">${b.downloadCount || 0}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="rounded-2xl bg-white border border-ink-100 p-5">
        <h3 class="font-display text-lg font-bold text-ink-900">Per class</h3>
        <div class="mt-4 space-y-2 text-sm">
          ${State.classes.map(c => {
    const uc = users.filter(u => u.classId === c.id).length;
    const bc = books.filter(b => b.classId === c.id).length;
    return `<div class="flex items-center justify-between py-1.5 border-b border-ink-100 last:border-0"><span class="font-semibold">${esc(c.name)}</span><span class="text-ink-500">${uc} users · ${bc} books</span></div>`;
  }).join('')}
        </div>
      </div>
    </div>`;
  return adminLayout(content, 'reports');
}

async function pageAdminDatabase() {
  const counts = {};
  for (const s of STORES) counts[s] = (await DB.all(s)).length;
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Database</h1>
        <p class="mt-1 text-sm text-ink-500">Xogta WADAAG (IndexedDB).</p>
      </div>
      <button data-backup class="px-4 py-2.5 rounded-xl bg-brand-800 hover:bg-brand-900 text-white text-sm font-semibold">${ICON.download.replace('<svg', '<svg width="14" height="14"')} Backup JSON</button>
    </div>
    <div class="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      ${STORES.map(s => `
        <div class="rounded-2xl bg-white border border-ink-100 p-4">
          <div class="text-[10px] uppercase tracking-widest text-ink-400 font-bold">${s}</div>
          <div class="font-display text-2xl font-bold mt-1">${counts[s]}</div>
        </div>`).join('')}
    </div>
    <div class="mt-6 grid sm:grid-cols-3 gap-3">
      <button data-export-users class="rounded-2xl border border-ink-200 bg-white hover:bg-ink-50 p-5 text-left"><div class="font-bold text-ink-900">Export Users CSV</div><div class="text-xs text-ink-500 mt-1">Dhammaan users-ka</div></button>
      <button data-export-books class="rounded-2xl border border-ink-200 bg-white hover:bg-ink-50 p-5 text-left"><div class="font-bold text-ink-900">Export Books CSV</div><div class="text-xs text-ink-500 mt-1">Metadata buugaagta</div></button>
      <button data-export-upg class="rounded-2xl border border-ink-200 bg-white hover:bg-ink-50 p-5 text-left"><div class="font-bold text-ink-900">Export Upgrades CSV</div><div class="text-xs text-ink-500 mt-1">Codsiyada upgrade-ka</div></button>
    </div>
    <div class="mt-6 rounded-2xl border border-gold-200 bg-gold-100 p-5 text-sm text-ink-700">
      ⚠️ <b>Ogeysiis:</b> Ma jiro SQL console furan. Read-only. Backup-ga waa JSON — keydi meel aamin ah.
    </div>`;
  return adminLayout(content, 'database');
}

async function pageAdminAudit() {
  const logs = (await DB.all('auditLogs')).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300);
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Audit Logs</h1>
        <p class="mt-1 text-sm text-ink-500">Dhammaan falalka admin-ka.</p>
      </div>
    </div>
    <div class="mt-6 rounded-2xl bg-white border border-ink-100 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs uppercase tracking-wider text-ink-400 border-b border-ink-100 bg-ink-50">
            <th class="px-4 py-3 font-semibold">Action</th>
            <th class="px-4 py-3 font-semibold">Admin</th>
            <th class="px-4 py-3 font-semibold hidden sm:table-cell">Target</th>
            <th class="px-4 py-3 font-semibold">Taariikhda</th>
          </tr></thead>
          <tbody class="divide-y divide-ink-100">
            ${logs.length === 0 ? `<tr><td colspan="4" class="px-4 py-12 text-center text-ink-400">Ma jiraan logs.</td></tr>` :
      logs.map(l => `
              <tr class="hover:bg-ink-50/50">
                <td class="px-4 py-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-ink-100 text-ink-700">${esc(l.action)}</span></td>
                <td class="px-4 py-3 text-ink-700">${esc(l.adminEmail || '—')}</td>
                <td class="px-4 py-3 hidden sm:table-cell text-ink-500 text-xs">${esc(l.targetType || '')} ${esc((l.targetId || '').slice(0, 8))}</td>
                <td class="px-4 py-3 text-xs text-ink-500">${fmtDateTime(l.createdAt)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  return adminLayout(content, 'audit');
}

async function pageAdminSettings() {
  const s = State.settings;
  const content = `
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 class="font-display text-3xl font-bold text-ink-900">Settings</h1>
        <p class="mt-1 text-sm text-ink-500">Habaynta WADAAG.</p>
      </div>
    </div>
    <form data-settings-form class="mt-6 grid lg:grid-cols-2 gap-4">
      <div class="rounded-2xl bg-white border border-ink-100 p-6 space-y-4">
        <div class="font-display text-lg font-bold text-ink-900">Site-ka</div>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Website name</span><input name="websiteName" value="${esc(s.websiteName || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Tagline</span><input name="tagline" value="${esc(s.tagline || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Footer text</span><input name="footerText" value="${esc(s.footerText || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
      </div>
      <div class="rounded-2xl bg-white border border-ink-100 p-6 space-y-4">
        <div class="font-display text-lg font-bold text-ink-900">Xiriir & Upgrade</div>
        <label class="block"><span class="text-xs font-semibold text-ink-700">WhatsApp number</span><input name="whatsapp" value="${esc(s.whatsapp || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Contact email</span><input name="contactEmail" value="${esc(s.contactEmail || '')}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block"><span class="text-xs font-semibold text-ink-700">Upgrade price</span><input name="upgradePrice" type="number" value="${esc(s.upgradePrice || 1)}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
          <label class="block"><span class="text-xs font-semibold text-ink-700">Max upload (MB)</span><input name="maxUploadMB" type="number" value="${esc(s.maxUploadMB || 25)}" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm"/></label>
        </div>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Support message</span><textarea name="supportMessage" rows="3" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 focus:bg-white ring-focus text-sm">${esc(s.supportMessage || '')}</textarea></label>
      </div>
      <div class="rounded-2xl bg-white border border-ink-100 p-6 space-y-4 lg:col-span-2">
        <div class="font-display text-lg font-bold text-ink-900">Xaalada</div>
        <div class="flex flex-wrap gap-6">
          <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="registrationOpen" ${s.registrationOpen !== false ? 'checked' : ''} class="rounded border-ink-300 text-brand-800 focus:ring-brand-500"/> Diiwaangelinta furan</label>
          <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="maintenanceMode" ${s.maintenanceMode ? 'checked' : ''} class="rounded border-ink-300 text-brand-800 focus:ring-brand-500"/> Maintenance mode</label>
        </div>
      </div>
      <div class="lg:col-span-2 flex justify-end">
        <button class="px-6 py-3 rounded-xl bg-brand-800 hover:bg-brand-900 text-white font-semibold">Keydi settings-ka</button>
      </div>
    </form>`;
  return adminLayout(content, 'settings');
}

/* ======================= RENDER ======================= */
async function render() {
  if (!guard()) return;
  const r = currentRoute();
  const [path, ...rest] = r.split('/').filter(Boolean);
  const app = $('#app');

  try {
    if (r === '/') { app.innerHTML = pageLanding(); return; }
    if (r === '/about') { app.innerHTML = pageAbout(); return; }
    if (r === '/login') { app.innerHTML = pageLogin(); attachLoginHandlers(); return; }
    if (r === '/register') { app.innerHTML = pageRegister(); attachRegisterHandlers(); return; }
    if (r === '/admin/login') { app.innerHTML = pageAdminLogin(); attachAdminLoginHandlers(); return; }

    if (!State.user) { navigate('/login'); return; }

    if (path === 'admin') {
      if (!State.isAdmin) { navigate('/dashboard'); return; }
      let html = '';
      const sub = rest[0] || '';
      if (!sub) html = await pageAdminDashboard();
      else if (sub === 'users') html = await pageAdminUsers();
      else if (sub === 'classes') html = await pageAdminClasses();
      else if (sub === 'subjects') html = await pageAdminSubjects();
      else if (sub === 'books') html = await pageAdminBooks();
      else if (sub === 'upgrades') html = await pageAdminUpgrades();
      else if (sub === 'notifications') html = await pageAdminNotifications();
      else if (sub === 'announcements') html = await pageAdminAnnouncements();
      else if (sub === 'downloads') html = await pageAdminDownloads();
      else if (sub === 'reports') html = await pageAdminReports();
      else if (sub === 'database') html = await pageAdminDatabase();
      else if (sub === 'audit') html = await pageAdminAudit();
      else if (sub === 'settings') html = await pageAdminSettings();
      else html = await pageAdminDashboard();
      app.innerHTML = html;
      attachAdminHandlers();
      return;
    }

    if (path === 'dashboard') { app.innerHTML = await pageDashboard(); attachUserHandlers(); return; }
    if (path === 'books') {
      if (rest[0]) {
        if (rest[1] === 'read') app.innerHTML = await pageBookRead(rest[0]);
        else app.innerHTML = await pageBookView(rest[0]);
      } else {
        app.innerHTML = await pageBooks();
      }
      attachUserHandlers();
      return;
    }
    if (path === 'notifications') { app.innerHTML = await pageNotifications(); attachUserHandlers(); return; }
    if (path === 'profile') { app.innerHTML = await pageProfile(); attachUserHandlers(); return; }
    if (path === 'upgrade') { app.innerHTML = await pageUpgrade(); attachUserHandlers(); return; }

    app.innerHTML = await pageDashboard();
    attachUserHandlers();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="p-12 text-center text-ink-500">Waxbaa khaldamay. Fadlan isku day mar kale.</div>`;
  }
}

/* ======================= HANDLERS ======================= */
function attachLoginHandlers() {
  const f = $('#login-form'); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const password = String(fd.get('password') || '');
    const users = await DB.all('users');
    const u = users.find(x => x.email.toLowerCase() === email);
    if (!u || !u.isActive) return toast('Email-ka ama password-ka waa khalad.', 'error');
    const h = await hashPassword(password);
    if (h !== u.passwordHash) return toast('Email-ka ama password-ka waa khalad.', 'error');
    saveSession(u.id);
    State.user = u;
    State.isAdmin = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role);
    toast('Ku soo dhowow ' + u.name.split(' ')[0], 'success');
    navigate(State.isAdmin ? '/admin' : '/dashboard');
  };
}

function attachAdminLoginHandlers() {
  const f = $('#admin-login-form'); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const password = String(fd.get('password') || '');
    const users = await DB.all('users');
    const u = users.find(x => x.email.toLowerCase() === email);
    if (!u || !u.isActive) return toast('Email-ka ama password-ka waa khalad.', 'error');
    if (!['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role)) return toast('Ma lihid fasax admin.', 'error');
    const h = await hashPassword(password);
    if (h !== u.passwordHash) return toast('Email-ka ama password-ka waa khalad.', 'error');
    saveSession(u.id);
    State.user = u;
    State.isAdmin = true;
    await audit('admin_login', '', '', {});
    toast('Ku soo dhowow Admin', 'success');
    navigate('/admin');
  };
}

function attachRegisterHandlers() {
  const f = $('#register-form'); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    if (State.settings.registrationOpen === false) return toast('Diiwaangelinta hadda waa xidhan.', 'error');
    const fd = new FormData(f);
    const name = String(fd.get('name') || '').trim();
    const username = String(fd.get('username') || '').trim();
    const email = String(fd.get('email') || '').trim().toLowerCase();
    const phone = String(fd.get('phone') || '').trim();
    const password = String(fd.get('password') || '');
    const password2 = String(fd.get('password2') || '');
    if (password !== password2) return toast('Password-ka laba waa kala duwan.', 'error');
    if (password.length < 6) return toast('Password waa inuu ka badan yahay 6 xaraf.', 'error');
    const users = await DB.all('users');
    if (users.some(u => u.email.toLowerCase() === email)) return toast('Email-kan horey ayaa loo isticmaalay.', 'error');
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return toast('Username-kan horey ayaa loo isticmaalay.', 'error');

    const pending = {
      id: uid('u_'), name, username, email, phone,
      passwordHash: await hashPassword(password),
      classId: null, role: 'STUDENT', isActive: true,
      upgradeStatus: 'NONE', upgradeType: null, upgradedAt: null, approvedBy: null,
      mustChangePassword: false, createdAt: Date.now(),
    };
    await audit('register', 'user', pending.id, { email });
    await showOnboardingClassSelect(pending);
  };
}

function attachUserHandlers() {
  const qs = document.querySelector('[data-quick-search]');
  if (qs) qs.oninput = () => { location.hash = '/books'; setTimeout(() => { const s = document.querySelector('[data-book-search]'); if (s) { s.value = qs.value; s.dispatchEvent(new Event('input')); } }, 60); };

  (async () => {
    const badge = document.querySelector('[data-notif-badge]');
    if (!badge) return;
    const list = (await DB.all('notifications')).filter(n => n.userId === State.user.id && !n.isRead);
    if (list.length) badge.classList.remove('hidden');
  })();

  const bs = document.querySelector('[data-book-search]');
  if (bs) {
    const run = async () => {
      const q = bs.value.toLowerCase().trim();
      const sub = document.querySelector('[data-book-subject]')?.value || '';
      const u = State.user;
      const books = (await DB.all('books')).filter(b => b.classId === u.classId && b.isPublished);
      const subjects = await DB.all('subjects');
      const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s.name]));
      const cls = State.classes.find(c => c.id === u.classId);
      const filtered = books.filter(b => {
        if (sub && b.subjectId !== sub) return false;
        if (!q) return true;
        return (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q) || (b.bookCode || '').toLowerCase().includes(q) || (subjectMap[b.subjectId] || '').toLowerCase().includes(q);
      });
      const grid = document.querySelector('[data-books-grid]');
      if (grid) grid.innerHTML = renderBookGrid(filtered, subjectMap, cls);
      attachDownloadButtons();
    };
    bs.oninput = run;
  }
  const bsub = document.querySelector('[data-book-subject]');
  if (bsub) bsub.onchange = () => bs?.dispatchEvent(new Event('input'));

  attachDownloadButtons();

  document.querySelectorAll('[data-mark-read]').forEach(b => b.onclick = async () => {
    const n = await DB.get('notifications', b.dataset.markRead);
    if (!n) return;
    n.isRead = true; n.readAt = Date.now();
    await DB.put('notifications', n);
    render();
  });
  document.querySelectorAll('[data-del-notif]').forEach(b => b.onclick = async () => {
    await DB.delete('notifications', b.dataset.delNotif);
    render();
  });
  const ma = document.querySelector('[data-mark-all]');
  if (ma) ma.onclick = async () => {
    const list = (await DB.all('notifications')).filter(n => n.userId === State.user.id && !n.isRead);
    for (const n of list) { n.isRead = true; n.readAt = Date.now(); await DB.put('notifications', n); }
    toast('Dhammaan waa la akhriyay', 'success');
    render();
  };

  const pf = document.getElementById('profile-form');
  if (pf) {
    pf.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(pf);
      State.user.name = String(fd.get('name') || '').trim() || State.user.name;
      State.user.phone = String(fd.get('phone') || '').trim();
      await DB.put('users', State.user);
      toast('Waa la keydiyay', 'success');
      render();
    };
    const chpw = pf.querySelector('[data-chpw]');
    if (chpw) chpw.onclick = async () => {
      const oldP = prompt('Password-ka hore:');
      if (!oldP) return;
      const oldHash = await hashPassword(oldP);
      if (oldHash !== State.user.passwordHash) return toast('Password-ka hore waa khalad.', 'error');
      const np = prompt('Password cusub (ugu yaraan 6):');
      if (!np || np.length < 6) return toast('Password waa inuu ka badan yahay 6 xaraf.', 'error');
      State.user.passwordHash = await hashPassword(np);
      await DB.put('users', State.user);
      toast('Password waa la beddelay', 'success');
    };
  }

  const upBtn = document.querySelector('[data-upgrade-request]');
  if (upBtn) upBtn.onclick = async () => {
    const existing = (await DB.all('upgradeRequests')).filter(r => r.userId === State.user.id && r.status === 'PENDING');
    if (existing.length) return toast('Codsi horey ayaa loo diray.', 'warn');
    const price = State.settings.upgradePrice || 1;
    await DB.put('upgradeRequests', {
      id: uid('r_'), userId: State.user.id, amount: price, currency: State.settings.currency || 'USD',
      status: 'PENDING', note: '', approvedBy: null, createdAt: Date.now(), processedAt: null,
    });
    State.user.upgradeStatus = 'PENDING';
    await DB.put('users', State.user);
    await notify(State.user.id, 'Codsi upgrade la helay', 'Codsi upgrade-kaaga waa la helay. Sug admin-ka.', 'info');
    await audit('upgrade_request', 'user', State.user.id, { price });
    toast('Upgrade request-kaaga waa la helay.', 'success');
    render();
  };
}

function attachDownloadButtons() {
  document.querySelectorAll('[data-download]').forEach(b => b.onclick = async () => {
    const bId = b.dataset.download;
    const book = await DB.get('books', bId);
    if (!book) return toast('Buuggan lama helin.', 'error');
    if (book.classId !== State.user.classId || !book.isPublished) return toast('Buuggan fasalkaaga kuma jiro.', 'error');
    await DB.put('downloads', { id: uid('d_'), userId: State.user.id, bookId: book.id, kind: 'download', timestamp: Date.now(), userAgent: navigator.userAgent });
    book.downloadCount = (book.downloadCount || 0) + 1;
    await DB.put('books', book);
    if (!book.pdfData) return toast('PDF-ga lama helin.', 'error');
    const a = document.createElement('a');
    a.href = book.pdfData;
    a.download = (book.title || 'wadaag').replace(/[^\w\-]+/g, '_') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    toast('Download la bilaabay', 'success');
    if (currentRoute().startsWith('/admin')) render();
  });
}

function attachAdminHandlers() {
  const dm = document.querySelector('[data-admin-menu]');
  const dr = document.getElementById('admin-drawer');
  if (dm && dr) dm.onclick = () => dr.classList.remove('hidden');
  document.querySelectorAll('[data-drawer-close]').forEach(b => b.onclick = () => dr.classList.add('hidden'));

  const us = document.querySelector('[data-user-search]');
  const uc = document.querySelector('[data-user-class]');
  const uu = document.querySelector('[data-user-upgrade]');
  const filterUsers = async () => {
    const users = (await DB.all('users')).filter(u => !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role));
    const q = (us?.value || '').toLowerCase().trim();
    const cid = uc?.value || '';
    const up = uu?.value || '';
    const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
    const filtered = users.filter(u => {
      if (cid && u.classId !== cid) return false;
      if (up === 'APPROVED' && u.upgradeStatus !== 'APPROVED') return false;
      if (up === 'PENDING' && u.upgradeStatus !== 'PENDING') return false;
      if (up === 'NONE' && (u.upgradeStatus && u.upgradeStatus !== 'NONE')) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
    const tb = document.querySelector('[data-users-body]');
    if (tb) tb.innerHTML = renderUsersTable(filtered, classMap);
    bindUserActions();
  };
  if (us) us.oninput = filterUsers;
  if (uc) uc.onchange = filterUsers;
  if (uu) uu.onchange = filterUsers;
  bindUserActions();

  document.querySelector('[data-new-class]')?.addEventListener('click', addClass);
  document.querySelectorAll('[data-edit-class]').forEach(b => b.onclick = () => editClass(b.dataset.editClass));
  document.querySelectorAll('[data-toggle-class]').forEach(b => b.onclick = async () => {
    const c = await DB.get('classes', b.dataset.toggleClass);
    c.isActive = !c.isActive;
    await DB.put('classes', c);
    await audit('toggle_class', 'class', c.id, { active: c.isActive });
    render();
  });
  document.querySelectorAll('[data-del-class]').forEach(b => b.onclick = async () => {
    const c = await DB.get('classes', b.dataset.delClass);
    const users = (await DB.all('users')).filter(u => u.classId === c.id);
    const books = (await DB.all('books')).filter(bk => bk.classId === c.id);
    if (users.length || books.length) return toast(`Lama tirtiri karo: ${users.length} users iyo ${books.length} books ku xiran.`, 'error');
    if (!await confirmBox({ title: 'Delete class?', confirmText: 'Delete', danger: true })) return;
    await DB.delete('classes', c.id);
    await audit('delete_class', 'class', c.id, {});
    render();
  });

  document.querySelector('[data-new-subject]')?.addEventListener('click', addSubject);
  document.querySelectorAll('[data-edit-subject]').forEach(b => b.onclick = () => editSubject(b.dataset.editSubject));
  document.querySelectorAll('[data-del-subject]').forEach(b => b.onclick = async () => {
    const s = await DB.get('subjects', b.dataset.delSubject);
    const books = (await DB.all('books')).filter(bk => bk.subjectId === s.id);
    if (books.length) return toast(`Lama tirtiri karo: ${books.length} books ku xiran.`, 'error');
    if (!await confirmBox({ title: 'Delete subject?', confirmText: 'Delete', danger: true })) return;
    await DB.delete('subjects', s.id);
    await audit('delete_subject', 'subject', s.id, {});
    render();
  });

  document.querySelector('[data-new-book]')?.addEventListener('click', () => openBookEditor(null));
  document.querySelectorAll('[data-edit-book]').forEach(b => b.onclick = () => openBookEditor(b.dataset.editBook));
  document.querySelectorAll('[data-toggle-pub]').forEach(b => b.onclick = async () => {
    const bk = await DB.get('books', b.dataset.togglePub);
    bk.isPublished = !bk.isPublished;
    await DB.put('books', bk);
    await audit('toggle_publish', 'book', bk.id, { isPublished: bk.isPublished });
    render();
  });
  document.querySelectorAll('[data-del-book]').forEach(b => b.onclick = async () => {
    if (!await confirmBox({ title: 'Delete buug?', message: 'Waa lama noqon karo.', confirmText: 'Delete', danger: true })) return;
    await DB.delete('books', b.dataset.delBook);
    await audit('delete_book', 'book', b.dataset.delBook, {});
    toast('Buugga waa la tirtiray', 'warn');
    render();
  });

  document.querySelectorAll('[data-appr]').forEach(b => b.onclick = async () => {
    const r = await DB.get('upgradeRequests', b.dataset.appr);
    r.status = 'APPROVED'; r.processedAt = Date.now(); r.approvedBy = State.user.id;
    await DB.put('upgradeRequests', r);
    const u = await DB.get('users', r.userId);
    if (u) {
      u.upgradeStatus = 'APPROVED'; u.upgradeType = 'PERMANENT'; u.upgradedAt = Date.now(); u.approvedBy = State.user.id;
      await DB.put('users', u);
      await notify(u.id, 'Upgrade waa laguu furay', 'Upgrade-ka account-kaaga Wadaag waa la ansixiyay.', 'success');
    }
    await audit('approve_upgrade', 'upgrade', r.id, { userId: r.userId });
    toast('Upgrade waa la ansixiyay', 'success');
    render();
  });
  document.querySelectorAll('[data-rej]').forEach(b => b.onclick = async () => {
    const r = await DB.get('upgradeRequests', b.dataset.rej);
    r.status = 'REJECTED'; r.processedAt = Date.now();
    await DB.put('upgradeRequests', r);
    const u = await DB.get('users', r.userId);
    if (u) {
      u.upgradeStatus = 'NONE';
      await DB.put('users', u);
      await notify(u.id, 'Upgrade waa la diiday', 'Codsi upgrade-kaaga waa la diiday. La xiriir admin-ka.', 'error');
    }
    await audit('reject_upgrade', 'upgrade', r.id, {});
    toast('Upgrade waa la diiday', 'warn');
    render();
  });

  document.querySelector('[data-new-notif]')?.addEventListener('click', async () => {
    const students = (await DB.all('users')).filter(u => !['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role));
    const w = modal(`
      <form data-nf class="p-6 space-y-4">
        <div class="flex items-center justify-between"><div class="font-display text-xl font-bold">Ogeysiis cusub</div><button type="button" data-close class="p-2 rounded-lg hover:bg-ink-100">${ICON.x.replace('<svg', '<svg width="18" height="18"')}</button></div>
        <label class="block"><span class="text-xs font-semibold text-ink-700">U dir</span>
          <select name="target" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm">
            <option value="all">Dhammaan ardayda (${students.length})</option>
            ${State.classes.map(c => `<option value="cls:${c.id}">Fasalka ${esc(c.name)} (${students.filter(u => u.classId === c.id).length})</option>`).join('')}
          </select>
        </label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Title</span><input name="title" required class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm"/></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Message</span><textarea name="message" required rows="4" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm"></textarea></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Priority</span>
          <select name="type" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm">
            <option value="info">Normal</option><option value="warn">Important</option><option value="error">Urgent</option><option value="success">Success</option>
          </select>
        </label>
        <div class="flex justify-end gap-2"><button type="button" data-close class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold">Jooji</button><button class="px-5 py-2.5 rounded-xl bg-brand-800 text-white text-sm font-semibold">Dir</button></div>
      </form>
    `);
    w.querySelectorAll('[data-close]').forEach(b => b.onclick = () => w.close());
    w.querySelector('[data-nf]').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const target = String(fd.get('target'));
      const title = String(fd.get('title'));
      const message = String(fd.get('message'));
      const type = String(fd.get('type'));
      let ids = [];
      if (target === 'all') ids = students.map(u => u.id);
      else if (target.startsWith('cls:')) ids = students.filter(u => u.classId === target.slice(4)).map(u => u.id);
      for (const id of ids) await notify(id, title, message, type);
      await audit('send_notification', 'bulk', '', { count: ids.length, title });
      toast(`Ogeysiis la diray ${ids.length} qof`, 'success');
      w.close(); render();
    };
  });

  document.querySelector('[data-new-ann]')?.addEventListener('click', async () => {
    const w = modal(`
      <form data-af class="p-6 space-y-4">
        <div class="flex items-center justify-between"><div class="font-display text-xl font-bold">Announcement cusub</div><button type="button" data-close class="p-2 rounded-lg hover:bg-ink-100">${ICON.x.replace('<svg', '<svg width="18" height="18"')}</button></div>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Title</span><input name="title" required class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm"/></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Message</span><textarea name="message" required rows="4" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm"></textarea></label>
        <label class="block"><span class="text-xs font-semibold text-ink-700">Target</span>
          <select name="targetClass" class="mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-ink-200 bg-ink-50 ring-focus text-sm">
            <option value="">Dhammaan</option>${State.classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <div class="flex justify-end gap-2"><button type="button" data-close class="px-4 py-2.5 rounded-xl border border-ink-200 text-sm font-semibold">Jooji</button><button class="px-5 py-2.5 rounded-xl bg-brand-800 text-white text-sm font-semibold">Publish</button></div>
      </form>
    `);
    w.querySelectorAll('[data-close]').forEach(b => b.onclick = () => w.close());
    w.querySelector('[data-af]').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await DB.put('announcements', {
        id: uid('an_'), title: fd.get('title'), message: fd.get('message'),
        targetClass: fd.get('targetClass') || null, status: 'ACTIVE', createdAt: Date.now(),
      });
      const students = (await DB.all('users')).filter(u => {
        if (['SUPER_ADMIN', 'ADMIN', 'MODERATOR'].includes(u.role)) return false;
        const tc = fd.get('targetClass');
        return !tc || u.classId === tc;
      });
      for (const u of students) await notify(u.id, '📣 ' + fd.get('title'), fd.get('message'), 'announcement');
      await audit('create_announcement', 'announcement', '', { title: fd.get('title') });
      toast('Announcement la daabacay', 'success');
      w.close(); render();
    };
  });
  document.querySelectorAll('[data-del-ann]').forEach(b => b.onclick = async () => {
    if (!await confirmBox({ title: 'Tirtir announcement?', confirmText: 'Tirtir', danger: true })) return;
    await DB.delete('announcements', b.dataset.delAnn);
    render();
  });

  document.querySelectorAll('[data-export-dl]').forEach(b => b.onclick = async () => {
    const dl = (await DB.all('downloads')).filter(d => d.kind === 'download');
    const users = Object.fromEntries((await DB.all('users')).map(u => [u.id, u]));
    const books = Object.fromEntries((await DB.all('books')).map(b => [b.id, b]));
    const csv = toCSV(['user', 'email', 'book', 'timestamp'], dl.map(d => [users[d.userId]?.name || '', users[d.userId]?.email || '', books[d.bookId]?.title || '', new Date(d.timestamp).toISOString()]));
    downloadFile('wadaag-downloads.csv', csv);
  });

  const sf = document.querySelector('[data-settings-form]');
  if (sf) sf.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(sf);
    State.settings = {
      ...State.settings,
      websiteName: fd.get('websiteName'),
      tagline: fd.get('tagline'),
      footerText: fd.get('footerText'),
      whatsapp: fd.get('whatsapp'),
      contactEmail: fd.get('contactEmail'),
      upgradePrice: Number(fd.get('upgradePrice')) || 1,
      maxUploadMB: Number(fd.get('maxUploadMB')) || 25,
      supportMessage: fd.get('supportMessage'),
      registrationOpen: !!fd.get('registrationOpen'),
      maintenanceMode: !!fd.get('maintenanceMode'),
      id: 'main',
    };
    await DB.put('settings', State.settings);
    await audit('update_settings', 'settings', '', {});
    toast('Waa la keydiyay', 'success');
  };

  document.querySelectorAll('[data-export-users]').forEach(b => b.onclick = async () => {
    const users = await DB.all('users');
    const csv = toCSV(['name', 'username', 'email', 'phone', 'role', 'classId', 'upgradeStatus', 'isActive', 'createdAt'], users.map(u => [u.name, u.username, u.email, u.phone, u.role, u.classId || '', u.upgradeStatus, u.isActive, new Date(u.createdAt).toISOString()]));
    downloadFile('wadaag-users.csv', csv);
  });
  document.querySelectorAll('[data-export-books]').forEach(b => b.onclick = async () => {
    const books = await DB.all('books');
    const classMap = Object.fromEntries(State.classes.map(c => [c.id, c.name]));
    const subs = Object.fromEntries((await DB.all('subjects')).map(s => [s.id, s.name]));
    const csv = toCSV(['title', 'author', 'class', 'subject', 'code', 'published', 'downloads', 'createdAt'], books.map(b => [b.title, b.author, classMap[b.classId] || '', subs[b.subjectId] || '', b.bookCode || '', b.isPublished, b.downloadCount || 0, new Date(b.createdAt).toISOString()]));
    downloadFile('wadaag-books.csv', csv);
  });
  document.querySelectorAll('[data-export-upg]').forEach(b => b.onclick = async () => {
    const reqs = await DB.all('upgradeRequests');
    const users = Object.fromEntries((await DB.all('users')).map(u => [u.id, u]));
    const csv = toCSV(['user', 'email', 'amount', 'currency', 'status', 'createdAt', 'processedAt'], reqs.map(r => [users[r.userId]?.name || '', users[r.userId]?.email || '', r.amount, r.currency, r.status, new Date(r.createdAt).toISOString(), r.processedAt ? new Date(r.processedAt).toISOString() : '']));
    downloadFile('wadaag-upgrades.csv', csv);
  });
  document.querySelector('[data-backup]')?.addEventListener('click', async () => {
    const dump = {};
    for (const s of STORES) dump[s] = await DB.all(s);
    downloadFile('wadaag-backup.json', JSON.stringify(dump, null, 2), 'application/json');
    toast('Backup la soo dejiyay', 'success');
  });
}

function bindUserActions() {
  document.querySelectorAll('[data-user-view]').forEach(b => b.onclick = () => openUserManager(b.dataset.userView));
}

async function addClass() {
  const name = prompt('Magaca fasalka (e.g. F8):');
  if (!name) return;
  const desc = prompt('Sharaxaad (optional):') || `Fasalka ${name}`;
  await DB.put('classes', { id: uid('c_'), name, description: desc, isActive: true, createdAt: Date.now() });
  await audit('create_class', 'class', '', { name });
  render();
}
async function editClass(id) {
  const c = await DB.get('classes', id);
  const name = prompt('Magaca fasalka:', c.name); if (!name) return;
  const description = prompt('Sharaxaad:', c.description) || c.description;
  c.name = name; c.description = description;
  await DB.put('classes', c);
  await audit('edit_class', 'class', c.id, { name });
  render();
}
async function addSubject() {
  const name = prompt('Magaca maaddada (e.g. Xisaabta):');
  if (!name) return;
  await DB.put('subjects', { id: uid('s_'), name, classId: null, isActive: true, createdAt: Date.now() });
  await audit('create_subject', 'subject', '', { name });
  render();
}
async function editSubject(id) {
  const s = await DB.get('subjects', id);
  const name = prompt('Magaca:', s.name); if (!name) return;
  s.name = name;
  await DB.put('subjects', s);
  await audit('edit_subject', 'subject', s.id, { name });
  render();
}

function toCSV(headers, rows) {
  const esc2 = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.map(esc2).join(','), ...rows.map(r => r.map(esc2).join(','))].join('\n');
}
function downloadFile(name, content, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

window.doLogout = async function () {
  if (State.user) await audit('logout', '', '', {});
  clearSession();
  State.user = null;
  State.isAdmin = false;
  toast('Waad ka baxday', 'info');
  navigate('/');
};
window.toggleTheme = () => {
  const cur = getTheme();
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem(APP.themeKey, next);
  applyTheme();
  toast(`Theme: ${next}`, 'info', 1500);
};

async function boot() {
  applyTheme();
  await DB.init();
  await seedIfNeeded();
  await loadSettings();
  State.classes = (await DB.all('classes')).sort((a, b) => a.name.localeCompare(b.name));
  State.subjects = await DB.all('subjects');
  await loadSession();
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/';
  render();
}
boot();
