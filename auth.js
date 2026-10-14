// auth.js – pripojenie na server na PC a prihlásenie
// Stránka môže bežať zo servera (base = '') alebo z GitHub Pages: vtedy base = adresa servera (https://<pc>.ts.net),
// ktorá sa zadá raz (alebo príde v ?server=… z QR kódu) a pamätá sa v prehliadači.
import { el, CONN } from './ui.js';

const LS = {
  get: k => { try { return localStorage.getItem('kw_' + k); } catch (e) { return null; } },
  set: (k, v) => { try { if (v === null || v === undefined) localStorage.removeItem('kw_' + k); else localStorage.setItem('kw_' + k, v); } catch (e) { /* */ } },
};
const tokKey = base => 'sess:' + (base || location.origin);
let SELF = null;                                 // stránka je zo servera katalógu (nie z GitHub Pages)?
const onServer = () => SELF;
async function pingSelf() {
  if (location.protocol === 'file:' || /\.github\.io$/i.test(location.hostname)) return false;
  try { const r = await fetch('/api/ping', { cache: 'no-store' }); return r.ok && !!(await r.json()).ok; } catch (e) { return false; }
}

function normBase(u) {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

async function probe(base, token) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const r = await fetch(base + '/api/auth', { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// -> true = môže sa spustiť aplikácia
export async function connect() {
  SELF = await pingSelf();
  const qp = new URLSearchParams(location.search);
  if (qp.get('server')) {                       // z QR kódu: ?server=https://pc.ts.net
    LS.set('server', normBase(qp.get('server')));
    qp.delete('server');
    history.replaceState(null, '', location.pathname + (qp.toString() ? '?' + qp : '') + location.hash);
  }
  let base = onServer() ? '' : (LS.get('server') || '');
  if (!onServer() && !base) { showLogin({ needServer: true }); return false; }
  CONN.base = base;
  CONN.token = LS.get(tokKey(base));
  let a;
  try { a = await probe(base, CONN.token); } catch (e) {
    showLogin({ needServer: !onServer(), err: `Server ${base || location.host} nie je dostupný (${e.message}). Beží katalog_web.bat na PC a Tailscale?` });
    return false;
  }
  CONN.ucty = a.ucty;
  if (a.user) { CONN.user = a.user; CONN.rola = a.rola; CONN.local = a.local; }
  else if (a.ucty) { showLogin({}); return false; }
  CONN.onAuth = () => { if (!document.getElementById('login')) showLogin({ err: 'Prihlásenie vypršalo – prihlás sa znova.' }); };
  return true;
}

export async function logout() {
  try {
    await fetch(CONN.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CONN.token }, body: '{"logout":true}' });
  } catch (e) { /* */ }
  LS.set(tokKey(CONN.base), null);
  location.reload();
}

export function serverBase() { return CONN.base || location.origin; }

function showLogin(o = {}) {
  const old = document.getElementById('login'); if (old) old.remove();
  const srv = el('input', { class: 'inp', placeholder: 'https://moj-pc.tailxxxx.ts.net', value: LS.get('server') || '', autocomplete: 'url' });
  const user = el('input', { class: 'inp', placeholder: 'meno', autocomplete: 'username', autocapitalize: 'none' });
  const pass = el('input', { class: 'inp', type: 'password', placeholder: 'heslo', autocomplete: 'current-password' });
  const msg = el('div', { class: 'login-err' }, o.err || '');
  const showSrv = o.needServer || !onServer();
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Prihlásiť');
  const form = el('form', { class: 'login-box', onsubmit: async e => {
    e.preventDefault();
    msg.textContent = ''; btn.disabled = true;
    const base = showSrv ? normBase(srv.value) : '';
    try {
      if (showSrv) {
        if (!base) throw new Error('Zadaj adresu servera.');
        LS.set('server', base);
      }
      const a = await probe(base, null).catch(err => { throw new Error(`Server ${base || location.host} nie je dostupný (${err.message}).`); });
      if (a.ucty) {
        const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user.value, pass: pass.value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
        LS.set(tokKey(base), j.token);
      }
      location.reload();
    } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  } },
  el('div', { class: 'login-logo' }, '⚱'),
  el('h2', {}, 'Katalóg hrobov'),
  el('div', { class: 'login-sub' }, 'Mušov – Roviny · dáta zostávajú na PC'),
  showSrv ? el('label', { class: 'lbl' }, 'Server (PC cez Tailscale)') : null, showSrv ? srv : null,
  el('label', { class: 'lbl' }, 'Meno'), user,
  el('label', { class: 'lbl' }, 'Heslo'), pass,
  msg, btn,
  el('div', { class: 'login-hint' }, showSrv ? 'Adresu servera ukáže na PC ⋯ → 📱 Pripojiť tablet (Tailscale HTTPS). Tablet musí mať zapnutý Tailscale.'
    : 'Účty sa zakladajú na PC: ucty.bat'));
  document.body.append(el('div', { id: 'login', class: 'login-back' }, form));
  setTimeout(() => (showSrv && !srv.value ? srv : user).focus(), 50);
}
