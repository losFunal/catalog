// ui.js – pomocné prvky rozhrania: element builder, API, toast, dialógy
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

// spojenie so serverom: base = '' (stránka zo servera) alebo https://<pc>.ts.net (stránka z GitHub Pages), token = prihlásenie
export const CONN = { base: '', token: null, user: null, rola: null, ucty: false };
// adresa pre <img>/<a> (nemôžu poslať hlavičku – token ide v ?s=)
export function apiUrl(path) {
  let u = CONN.base + path;
  if (CONN.token) u += (u.includes('?') ? '&' : '?') + 's=' + encodeURIComponent(CONN.token);
  return u;
}
export async function api(path, body, opts = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (CONN.token) headers.Authorization = 'Bearer ' + CONN.token;
  const init = body === undefined ? { method: 'GET', headers } : { method: 'POST', headers, body: JSON.stringify(body) };
  let r;
  try {
    r = await fetch(CONN.base + path, init);
  } catch (e) {
    throw new Error('Server nedostupný – beží katalog_web na PC? (' + e.message + ')');
  }
  if (r.status === 401 && CONN.onAuth) CONN.onAuth();
  let j = null;
  try { j = await r.json(); } catch (e) { /* */ }
  if (!r.ok || (j && j.error)) {
    const msg = (j && j.error) || ('HTTP ' + r.status);
    if (!opts.quiet) toast(msg.split('\n\n')[0], 'error', 7000);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return j;
}

export async function waitJob(id, onLog) {
  for (;;) {
    const j = await api('/api/job?id=' + id);
    if (onLog) onLog(j);
    if (j.state === 'ok') return j.result || {};
    if (j.state === 'err') throw new Error(j.error || 'chyba úlohy');
    await new Promise(r => setTimeout(r, 600));
  }
}

let toastBox = null;
export function toast(text, kind = 'info', ms = 4000) {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts' });
    document.body.append(toastBox);
  }
  const t = el('div', { class: 'toast ' + kind }, String(text));
  t.addEventListener('click', () => t.remove());
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// modálne okno: vráti {root, body, foot, close}
export function modal(title, opts = {}) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal ' + (opts.cls || '') });
  const head = el('div', { class: 'modal-head' }, el('div', { class: 'modal-title' }, title),
    el('button', { class: 'icon-btn', title: 'Zavrieť (Esc)', onclick: () => close(null) }, '✕'));
  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });
  box.append(head, body, foot);
  back.append(box);
  document.body.append(back);
  let resolver;
  const done = new Promise(r => (resolver = r));
  function close(v) {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
    resolver(v);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
    else if (e.key === 'Enter' && opts.onEnter && !(e.target && e.target.tagName === 'TEXTAREA')) {
      e.stopPropagation(); e.preventDefault(); opts.onEnter();
    } else e.stopPropagation();
  }
  document.addEventListener('keydown', onKey, true);
  if (!opts.noBackClose) back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
  return { root: box, body, foot, close, done };
}

export function confirmBox(text, okText = 'Áno', cancelText = 'Zrušiť', danger = false) {
  const m = modal('Potvrdenie', { onEnter: () => m.close(true) });
  m.body.append(el('div', { class: 'pre' }, text));
  m.foot.append(el('button', { class: 'btn', onclick: () => m.close(false) }, cancelText),
    el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => m.close(true) }, okText));
  return m.done.then(v => !!v);
}

export function infoBox(title, text) {
  const m = modal(title, { onEnter: () => m.close(true) });
  m.body.append(el('div', { class: 'pre' }, text));
  m.foot.append(el('button', { class: 'btn primary', onclick: () => m.close(true) }, 'OK'));
  return m.done;
}

export function promptBox(title, label, value = '', hint = '') {
  const inp = el('input', { class: 'inp', value });
  const m = modal(title, { onEnter: () => m.close(inp.value) });
  m.body.append(el('label', { class: 'lbl' }, label), inp, hint ? el('div', { class: 'hint' }, hint) : null);
  m.foot.append(el('button', { class: 'btn', onclick: () => m.close(null) }, 'Zrušiť'),
    el('button', { class: 'btn primary', onclick: () => m.close(inp.value) }, 'OK'));
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  return m.done;
}

// panel úlohy na pozadí s logom; vráti výsledok
export async function runJob(title, startBody, opts = {}) {
  const r = await api('/api/job/start', startBody);
  return followJob(title, r.job, opts);
}

export async function followJob(title, id, opts = {}) {
  const log = el('div', { class: 'joblog' });
  const m = opts.silent ? null : modal(title, { noBackClose: true });
  if (m) {
    m.body.append(el('div', { class: 'spinner-row' }, el('span', { class: 'spinner' }), el('span', {}, 'Pracujem…')), log);
    m.foot.append(el('button', { class: 'btn', onclick: () => m.close(null) }, 'Skryť (beží ďalej)'));
  }
  try {
    const res = await waitJob(id, j => { log.textContent = (j.log || []).slice(-60).join('\n'); log.scrollTop = 1e9; });
    if (m) {
      m.body.querySelector('.spinner-row').replaceWith(el('div', { class: 'job-ok' }, '✔ ' + (res.msg || 'Hotovo')));
      if (res.lines && res.lines.length) log.textContent = res.lines.join('\n');
      if (res.url) m.body.append(el('a', { class: 'btn primary', href: apiUrl(res.url), download: '' }, '⬇ Stiahnuť súbor'));
      m.foot.innerHTML = '';
      m.foot.append(el('button', { class: 'btn primary', onclick: () => m.close(true) }, 'OK'));
      if (opts.autoClose) m.close(true);
    }
    return res;
  } catch (e) {
    if (m) {
      const sr = m.body.querySelector('.spinner-row');
      if (sr) sr.replaceWith(el('div', { class: 'job-err' }, '✗ ' + e.message.split('\n\n')[0]));
      m.body.append(el('details', {}, el('summary', {}, 'detail'), el('pre', { class: 'pre small' }, e.message)));
      m.foot.innerHTML = '';
      m.foot.append(el('button', { class: 'btn', onclick: () => m.close(null) }, 'Zavrieť'));
    } else toast(e.message.split('\n\n')[0], 'error', 8000);
    throw e;
  }
}

export function fmt(v, d = 2) {
  return v === null || v === undefined ? '–' : Number(v).toFixed(d);
}

export const CTX_PAL = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c',
  '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075'];

export function ctxRGB(label, v = 1.0) {
  const m = String(label || '').match(/\d+/);
  if (!m) return [150, 150, 150];
  const h = CTX_PAL[parseInt(m[0], 10) % CTX_PAL.length];
  return [1, 3, 5].map(i => Math.floor(parseInt(h.substr(i, 2), 16) * v));
}

export function rgb(a, alpha) {
  return alpha === undefined ? `rgb(${a[0]},${a[1]},${a[2]})` : `rgba(${a[0]},${a[1]},${a[2]},${alpha})`;
}

export function drKey(dr) {
  const m = String(dr || '').match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

export function drsOf(v) {
  const out = new Set();
  for (const m of String(v || '').matchAll(/(\d+)\s*\/\s*(\d+)/g)) out.add(`${parseInt(m[1])}/${parseInt(m[2])}`);
  return out;
}
