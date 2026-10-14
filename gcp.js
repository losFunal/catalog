// gcp.js – georeferencovanie skenu na body: plán ↔ body z merania (S-JTSK), rez ↔ profilový priestor
import { el, api, toast, followJob, confirmBox } from './ui.js';
import { drawTiles, invert, apply } from './map.js';

// ------------------------------------------------------------------ plátno s posunom / zoomom (obrázok alebo mapa)
class Pane {
  // kind 'img' (y dolu, súradnice px skenu) alebo 'map' (S-JTSK, y hore)
  constructor(host, kind, app, opts = {}) {
    this.kind = kind; this.app = app; this.opts = opts;
    this.wrap = el('div', { class: 'pane' });
    this.cv = el('canvas');
    this.cap = el('div', { class: 'cap' }, opts.caption || '');
    this.wrap.append(this.cv, this.cap);
    host.append(this.wrap);
    this.ctx = this.cv.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.v = null;
    this.ptr = new Map();
    this.act = null;
    this.onTap = null; this.onDraw = null; this.hitPoint = null; this.onPointMove = null; this.onPointDelete = null;
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    const c = this.cv;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => { this.ptr.delete(e.pointerId); this.act = null; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); const [X, Y] = this.xy(e); this.zoomAt(X, Y, Math.exp(-e.deltaY * 0.0018)); }, { passive: false });
  }
  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.cw = Math.max(50, r.width); this.ch = Math.max(50, r.height);
    this.cv.width = Math.round(this.cw * this.dpr); this.cv.height = Math.round(this.ch * this.dpr);
    if (!this.v && this.opts.fit) this.opts.fit();
    this.request();
  }
  // obrázok: X = (x - ox) * s ; mapa: X = (x - x0) * s, Y = (y0 - y) * s
  w2c(x, y) { const v = this.v; return this.kind === 'img' ? [(x - v.ox) * v.s, (y - v.oy) * v.s] : [(x - v.x) * v.s, (v.y - y) * v.s]; }
  c2w(X, Y) { const v = this.v; return this.kind === 'img' ? [v.ox + X / v.s, v.oy + Y / v.s] : [v.x + X / v.s, v.y - Y / v.s]; }
  fitBox(x0, y0, x1, y1, k = 0.96) {
    const s = Math.min(this.cw / (x1 - x0), this.ch / (y1 - y0)) * k;
    this.v = this.kind === 'img' ? { s, ox: (x0 + x1) / 2 - this.cw / 2 / s, oy: (y0 + y1) / 2 - this.ch / 2 / s }
      : { s, x: (x0 + x1) / 2 - this.cw / 2 / s, y: (y0 + y1) / 2 + this.ch / 2 / s };
    this.request();
  }
  zoomAt(X, Y, f) {
    if (!this.v) return;
    const [x, y] = this.c2w(X, Y);
    const s = this.kind === 'img' ? Math.min(Math.max(this.v.s * f, 0.01), 12) : Math.min(Math.max(this.v.s * f, 10), 40000);
    this.v = this.kind === 'img' ? { s, ox: x - X / s, oy: y - Y / s } : { s, x: x - X / s, y: y + Y / s };
    this.request();
  }
  panBy(dX, dY) {
    if (!this.v) return;
    if (this.kind === 'img') { this.v.ox -= dX / this.v.s; this.v.oy -= dY / this.v.s; }
    else { this.v.x -= dX / this.v.s; this.v.y += dY / this.v.s; }
    this.request();
  }
  request() { if (this._p) return; this._p = true; requestAnimationFrame(() => { this._p = false; this.render(); }); }
  render() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = this.kind === 'img' ? '#808080' : '#f4f4f4';
    c.fillRect(0, 0, this.cw, this.ch);
    if (this.v && this.onDraw) this.onDraw(c);
  }
  xy(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  down(e) {
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    const [X, Y] = this.xy(e);
    this.ptr.set(e.pointerId, { X, Y });
    if (this.ptr.size === 2) {
      const P = [...this.ptr.values()];
      this.act = { type: 'pinch', d0: Math.hypot(P[0].X - P[1].X, P[0].Y - P[1].Y), m0: [(P[0].X + P[1].X) / 2, (P[0].Y + P[1].Y) / 2] };
      return;
    }
    if (this.ptr.size > 2) return;
    const penOnly = this.app.map.penOnly && e.pointerType === 'touch';
    const alt = e.button === 2 || (e.pointerType === 'pen' && (e.buttons & 2));
    if (e.button === 1 || (e.button === 2 && e.pointerType === 'mouse' && !(this.hitPoint && this.hitPoint(X, Y, 10) !== null))) {
      this.act = { type: 'pan', X, Y }; return;
    }
    const hp = !penOnly && this.hitPoint ? this.hitPoint(X, Y, e.pointerType === 'touch' ? 20 : 12) : null;
    if (hp !== null && hp !== undefined) {
      if (alt) { this.onPointDelete && this.onPointDelete(hp); this.act = { type: 'none' }; return; }
      this.act = { type: 'point', k: hp, sX: X, sY: Y, moved: false };
      this.act.lp = setTimeout(() => { if (this.act && this.act.type === 'point' && !this.act.moved) { this.onPointDelete && this.onPointDelete(hp); this.act = { type: 'none' }; } }, 650);
      return;
    }
    this.act = { type: 'tap', X, Y, sX: X, sY: Y, penOnly, alt, shift: e.shiftKey };
  }
  move(e) {
    const [X, Y] = this.xy(e);
    const p = this.ptr.get(e.pointerId);
    if (p) { p.X = X; p.Y = Y; }
    const a = this.act;
    if (!a) return;
    if (a.type === 'pinch') {
      const P = [...this.ptr.values()];
      if (P.length < 2) return;
      const d = Math.hypot(P[0].X - P[1].X, P[0].Y - P[1].Y), m = [(P[0].X + P[1].X) / 2, (P[0].Y + P[1].Y) / 2];
      this.panBy(m[0] - a.m0[0], m[1] - a.m0[1]);
      if (a.d0 > 10) this.zoomAt(m[0], m[1], d / a.d0);
      a.d0 = d; a.m0 = m; return;
    }
    if (a.type === 'tap' && Math.abs(X - a.sX) + Math.abs(Y - a.sY) > 7) { a.type = 'pan'; a.X = a.sX; a.Y = a.sY; }
    if (a.type === 'pan') { this.panBy(X - a.X, Y - a.Y); a.X = X; a.Y = Y; return; }
    if (a.type === 'point') {
      if (!a.moved && Math.abs(X - a.sX) + Math.abs(Y - a.sY) < 4) return;
      a.moved = true; clearTimeout(a.lp);
      this.onPointMove && this.onPointMove(a.k, this.c2w(X, Y), false);
    }
  }
  up(e) {
    const [X, Y] = this.xy(e);
    this.ptr.delete(e.pointerId);
    const a = this.act;
    if (this.ptr.size) { if (a && a.type === 'pinch') this.act = { type: 'none' }; return; }
    this.act = null;
    if (!a) return;
    if (a.lp) clearTimeout(a.lp);
    if (a.type === 'tap' && !a.penOnly && this.onTap) this.onTap(X, Y, a);
    if (a.type === 'point' && a.moved) this.onPointMove && this.onPointMove(a.k, this.c2w(X, Y), true);
  }
}

function screen(title) {
  const root = el('div', { class: 'screen' });
  const top = el('div', { class: 'screen-top' }, el('span', { class: 't' }, title));
  const msg = el('div', { class: 'screen-msg' });
  const body = el('div', { class: 'screen-body' });
  root.append(top, msg, body);
  document.body.append(root);
  const keys = [];
  const onKey = e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (document.querySelector('.modal-back')) return;
    for (const [k, fn] of keys) if (k === e.key || k === e.key.toLowerCase()) { e.preventDefault(); fn(e); return; }
  };
  document.addEventListener('keydown', onKey);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  return { root, top, msg, body, keys, close };
}
const B = (txt, fn, cls = '', title = '') => el('button', { class: 'tool ' + cls, title, onclick: e => { e.stopPropagation(); fn(); } }, txt);
const chk = (txt, val, fn) => { const i = el('input', { type: 'checkbox' }); i.checked = val; i.onchange = () => fn(i.checked); return el('label', { class: 'tool' }, i, txt); };

function rawToDisp(c, r, W, H, e) {
  if (e === 8) return [r, W - 1 - c];
  if (e === 6) return [H - 1 - r, c];
  if (e === 3) return [W - 1 - c, H - 1 - r];
  return [c, r];
}
function dispToRaw(x, y, W, H, e) {
  if (e === 8) return [W - 1 - y, x];
  if (e === 6) return [y, H - 1 - x];
  if (e === 3) return [W - 1 - x, H - 1 - y];
  return [x, y];
}
function scanTiles(pane, app, id, d) {
  // dlaždice skenu v zobrazení po EXIF otočení
  const info = { W: d.W, H: d.H, levels: d.levels };
  const swap = d.exif === 6 || d.exif === 8;
  const Wd = swap ? d.H : d.W, Hd = swap ? d.W : d.H;
  const v = pane.v;
  let lvl = 0;
  while (lvl + 1 < d.levels.length && v.s * pane.dpr * 2 ** (lvl + 1) <= 1.0) lvl++;
  const mat = (L, lw, lh) => { const fx = Wd / lw, fy = Hd / lh; return [v.s * fx, 0, 0, v.s * fy, -v.ox * v.s, -v.oy * v.s]; };
  drawTiles(pane.ctx, app.map.tiles, id, info, lvl, mat, pane.cw, pane.ch, d.exif || 1);
  return [Wd, Hd];
}
function cross(c, X, Y, r, col, w = 2) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(X - r, Y); c.lineTo(X + r, Y); c.moveTo(X, Y - r); c.lineTo(X, Y + r); c.stroke(); }
function label(c, t, X, Y, col, font = 'bold 12px system-ui') { c.font = font; c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = '#fff'; c.strokeText(t, X, Y); c.fillStyle = col; c.fillText(t, X, Y); }

async function prepare(title, path, body) {
  const r = await api(path, body);
  return followJob(title, r.job, { autoClose: true });
}

// ------------------------------------------------------------------ K: georeferencovanie na body z merania
export async function openGcp(app, scan) {
  let d;
  try { d = await prepare('Georef na body – príprava skenu (mm sieť)', '/api/gcp/open', { g: app.G.g, scan: scan.id, dr: app.dr }); } catch (e) { return; }
  const S = screen(`Georeferencovanie na body – ${d.g} – ${d.name}`);
  const st = { pairs: [], pending: null, res: null, free: true, snap: true };
  const swap = d.exif === 6 || d.exif === 8;
  const Wd = swap ? d.H : d.W, Hd = swap ? d.W : d.H;
  const list = el('div', { class: 'pairs' });
  const side = el('div', { class: 'side' }, el('h4', {}, 'Páry (sken ↔ bod), odchýlka cm'), list,
    el('div', { class: 'hint' }, '1) ťukni na krížik na skene (prichytí sa na stred) · 2) ťukni na bod v mape → pár. Od 2 párov výsledok: oranžové krúžky na skene = body premietnuté späť (musia sedieť na krížikoch).'));
  const ps = new Pane(S.body, 'img', app, { caption: 'sken', fit: () => ps.fitBox(0, 0, Wd, Hd, 0.98) });
  const pm = new Pane(S.body, 'map', app, { caption: 'body z merania (oranžové 2009–2013, červené LB, zelené osi / rezy)', fit: () => fitMap() });
  S.body.append(side);
  function fitMap() {
    let [x0, y0, x1, y1] = d.square;
    if (d.refs.length) {
      const xs = d.refs.map(r => r.x).concat([x0, x1]), ys = d.refs.map(r => r.y).concat([y0, y1]);
      x0 = Math.min(...xs) - 0.2; x1 = Math.max(...xs) + 0.2; y0 = Math.min(...ys) - 0.2; y1 = Math.max(...ys) + 0.2;
    }
    pm.fitBox(x0, y0, x1, y1, 0.95);
  }
  const btnSave = B('💾 Uložiť (S)', () => save(), 'primary', 'Uložiť world file (S-JTSK)');
  btnSave.disabled = true;
  S.top.append(B('↶ Zmazať posledný', () => undo(), '', 'Backspace'), B('Zmazať všetko', () => { st.pairs = []; st.pending = null; compute(); }),
    chk('presne na body – voľná mierka', true, v => { st.free = v; compute(); }), chk('prichytiť na krížik', true, v => (st.snap = v)),
    B('⤢ Celé', () => { ps.fitBox(0, 0, Wd, Hd, 0.98); fitMap(); }, '', 'F'), el('span', { class: 'spacer' }), btnSave, B('✕ Zavrieť', () => S.close(), '', 'Esc'));
  S.msg.textContent = 'Ťukni krížik na skene, potom zodpovedajúci bod v mape (aspoň 2 páry, lepšie 3–4).';
  S.keys.push(['Escape', () => S.close()], ['Backspace', () => undo()], ['s', () => save()], ['f', () => { ps.fitBox(0, 0, Wd, Hd, 0.98); fitMap(); }]);

  ps.onTap = async (X, Y, a) => {
    let [x, y] = ps.c2w(X, Y);
    let how = ' (bez prichytenia)';
    if (st.snap && !a.shift && !a.alt) {
      try {
        const r = await api('/api/gcp/snapcross', { scan: d.scan, x, y, exif: d.exif, px_mm: d.px_mm }, { quiet: true });
        if (r.pt) { [x, y] = r.pt; how = ' (prichytený na stred krížika)'; }
      } catch (e) { /* */ }
    }
    st.pending = dispToRaw(x, y, d.W, d.H, d.exif);
    S.msg.textContent = 'Bod na skene vybraný' + how + ' – teraz ťukni zodpovedajúci bod v mape.';
    S.msg.className = 'screen-msg';
    ps.request();
  };
  pm.onTap = (X, Y) => {
    if (!st.pending) { S.msg.textContent = 'Najprv ťukni krížik na skene (vľavo).'; return; }
    let best = null, bd = app.touchUI ? 26 : 16;
    for (const r of d.refs) { const [PX, PY] = pm.w2c(r.x, r.y); const dd = Math.hypot(PX - X, PY - Y); if (dd < bd) { best = r; bd = dd; } }
    if (!best) { S.msg.textContent = 'V blízkosti nie je bod – ťukni presnejšie na bod v mape.'; return; }
    st.pairs = st.pairs.filter(p => p.wx !== best.x || p.wy !== best.y);
    st.pairs.push({ rx: st.pending[0], ry: st.pending[1], wx: best.x, wy: best.y, lab: best.lab });
    st.pending = null;
    compute();
  };
  function undo() { if (st.pending) st.pending = null; else st.pairs.pop(); compute(); }
  async function compute() {
    st.res = null; btnSave.disabled = true;
    if (st.pairs.length >= 2) {
      try {
        const r = await api('/api/gcp/compute', { scan: d.scan, g: d.g, pairs: st.pairs, free: st.free });
        st.res = r.res;
      } catch (e) { /* */ }
    }
    const R = st.res;
    if (R) {
      S.msg.textContent = `${st.pairs.length} párov  RMSE ${(R.rmse * 100).toFixed(1)} cm  max ${(Math.max(...R.resid) * 100).toFixed(1)} cm  voľná mierka ${R.sf.toFixed(3)}  rotácia ${R.rot.toFixed(1)}°   ` +
        (R.ok ? '→ sedí? 💾 Uložiť' : R.rmse >= 0.03 ? '→ veľká odchýlka – skontroluj páry' : '→ mierka nesedí s mm sieťou (skús voľnú mierku)');
      S.msg.className = 'screen-msg ' + (R.ok ? 'ok' : 'warn');
      btnSave.disabled = false;
    } else if (st.pairs.length === 1) { S.msg.textContent = '1 pár – pridaj aspoň ešte jeden.'; S.msg.className = 'screen-msg'; }
    list.innerHTML = '';
    st.pairs.forEach((p, i) => list.append(el('div', {}, `${i + 1}. ${p.lab}`, R ? el('b', {}, (R.resid[i] * 100).toFixed(1)) : '',
      el('button', { class: 'tool', style: { height: '32px', minWidth: '32px' }, onclick: () => { st.pairs.splice(i, 1); compute(); } }, '✕'))));
    ps.request(); pm.request();
  }
  async function save() {
    if (!st.res) return;
    try {
      const r = await api('/api/gcp/save', { scan: d.scan, g: d.g, pairs: st.pairs, free: st.free, n_refs: d.refs.length });
      toast(r.msg, 'ok');
      S.close();
      app.afterGeoref();
    } catch (e) { /* */ }
  }
  ps.onDraw = c => {
    scanTiles(ps, app, d.scan, d);
    const R = st.res;
    if (R) {
      const A = R.A2, Ai = invert([A[0][0], A[1][0], A[0][1], A[1][1], 0, 0]);
      for (const r of d.refs) {
        const q = apply(Ai, r.x - R.t[0], r.y - R.t[1]);
        const [X, Y] = ps.w2c(...rawToDisp(q[0], q[1], d.W, d.H, d.exif));
        if (X < -20 || Y < -20 || X > ps.cw + 20 || Y > ps.ch + 20) continue;
        c.strokeStyle = r.col; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 9, 0, 7); c.stroke();
        label(c, r.lab, X + 11, Y - 11, r.col);
      }
    }
    st.pairs.forEach((p, i) => {
      const [X, Y] = ps.w2c(...rawToDisp(p.rx, p.ry, d.W, d.H, d.exif));
      cross(c, X, Y, 12, '#ff0000'); label(c, String(i + 1), X - 22, Y + 14, '#ff0000', 'bold 14px system-ui');
    });
    if (st.pending) {
      const [X, Y] = ps.w2c(...rawToDisp(st.pending[0], st.pending[1], d.W, d.H, d.exif));
      c.strokeStyle = '#ffff00'; c.lineWidth = 3; c.beginPath(); c.arc(X, Y, 10, 0, 7); c.stroke();
    }
    label(c, `zoom ${Math.round(ps.v.s * 100)} %`, 8, ps.ch - 12, '#000', '12px system-ui');
  };
  pm.onDraw = c => {
    c.setLineDash([6, 3]); c.strokeStyle = '#202020'; c.lineWidth = 1;
    for (const ring of d.rings) { c.beginPath(); ring.forEach((p, i) => { const [X, Y] = pm.w2c(...p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke(); }
    c.strokeStyle = '#00a000'; c.setLineDash([5, 3]);
    for (const sg of d.segs) { c.beginPath(); sg.forEach((p, i) => { const [X, Y] = pm.w2c(...p); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke(); }
    c.setLineDash([]);
    const R = st.res;
    if (R) {
      const A = R.A2, cor = [[0, 0], [d.W, 0], [d.W, d.H], [0, d.H], [0, 0]];
      c.strokeStyle = '#4060ff'; c.lineWidth = 2; c.beginPath();
      cor.forEach(([cc, rr], i) => { const x = A[0][0] * cc + A[0][1] * rr + R.t[0], y = A[1][0] * cc + A[1][1] * rr + R.t[1]; const [X, Y] = pm.w2c(x, y); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
      c.stroke();
    }
    const used = new Map(st.pairs.map((p, i) => [p.wx + ',' + p.wy, i + 1]));
    for (const r of d.refs) {
      const [X, Y] = pm.w2c(r.x, r.y);
      cross(c, X, Y, 7, r.col);
      const n = used.get(r.x + ',' + r.y);
      if (n) { c.strokeStyle = '#ff0000'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 10, 0, 7); c.stroke(); }
      label(c, r.lab + (n ? ` [${n}]` : ''), X + 9, Y - 9, r.col);
    }
  };
}

// ------------------------------------------------------------------ K pre rez: sken ↔ profilový priestor (vzdialenosť od začiatku rezu, výška)
export async function openRezGeo(app, scan, rez0 = null) {
  let d;
  try { d = await prepare('Rez – príprava', '/api/rezgeo/open', { g: app.G.g, scan: scan.id, rez: rez0 }); } catch (e) { return; }
  const prof = app.G.profily || {};
  const st = { pairs: [], pending: null, res: null, rez: d.rez || (d.rezy[0] || null), cur: d.cur };
  const sameImg = p => (p.img || null) === (d.img_path || null);
  const loadRez = () => {
    st.cur = (d.placed || []).find(p => p.rez === st.rez && sameImg(p)) || null;
    st.pairs = st.cur && st.cur.pary && st.cur.zdroj === 'body' ? st.cur.pary.map(p => ({ ...p })) : [];
    st.pending = null;
  };
  loadRez();
  const swap = d.exif === 6 || d.exif === 8;
  const Wd = swap ? d.H : d.W, Hd = swap ? d.W : d.H;
  const S = screen(`Rez na body – ${d.g} – ${d.name}`);
  const list = el('div', { class: 'pairs' });
  const rezRow = el('div', { class: 'qrtabs' });
  const side = el('div', { class: 'side' }, el('h4', {}, 'Rez'), rezRow, el('h4', {}, 'Páry (sken ↔ profil), odchýlka cm'), list,
    el('div', { class: 'hint' }, '1) ťukni na bod na skene (koniec šnúry, roh profilu…) · 2) ťukni na ten istý bod vpravo: zelené A/B = konce šnúry, oranžové = body z merania, fialové vrcholy = vektorizovaný profil. Od 2 párov sa profil premietne na sken.'));
  const ps = new Pane(S.body, 'img', app, { caption: 'sken rezu', fit: () => ps.fitBox(0, 0, Wd, Hd, 0.98) });
  const pm = new Pane(S.body, 'map', app, { caption: 'profil: vodorovne m od začiatku rezu, zvislo výška n. m.', fit: () => fitProf() });
  S.body.append(side);
  const P = () => prof[st.rez] || null;
  function refs() {
    const p = P(); if (!p) return [];
    const out = (p.refs || []).map(r => ({ ...r }));
    p.lines.forEach((ln, li) => ln.P.forEach((q, i) => out.push({ s: q[0], z: q[1], lab: `${ln.typ === 'os' ? 'šnúra' : 'profil'} ${li + 1}.${i + 1}`, col: ln.typ === 'os' ? '#00a000' : '#c000c0', vtx: true })));
    return out;
  }
  function fitProf() {
    const p = P();
    const pts = p ? [].concat(...p.lines.map(l => l.P), (p.refs || []).map(r => [r.s, r.z])) : [];
    if (pts.length) pts.push([0, pts[0][1]], [p.L, pts[0][1]]);
    if (!pts.length) { pm.fitBox(-0.2, 173.5, 3, 175.5, 0.9); return; }
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    pm.fitBox(Math.min(...xs) - 0.15, Math.min(...ys) - 0.15, Math.max(...xs) + 0.15, Math.max(...ys) + 0.15, 0.95);
  }
  function renderRez() {
    rezRow.innerHTML = '';
    for (const r of ['AB', 'CD', 'EF', 'GH']) {
      const has = !!prof[r];
      const placed = (d.placed || []).some(p => p.rez === r && sameImg(p));
      rezRow.append(el('button', { class: 'chip mini' + (st.rez === r ? ' on' : ''), title: (has ? 'má vektorizovaný profil' : 'bez profilu') + (placed ? ' · na obrázku už umiestnený' : ''),
        onclick: () => { st.rez = r; loadRez(); renderRez(); renderTop(); fitProf(); compute(); } }, has ? (placed ? '✓' + r : r) : el('span', { style: { opacity: 0.5 } }, r)));
    }
  }
  renderRez();
  const btnSave = B('💾 Uložiť (S)', () => save(), 'primary', 'Uložiť umiestnenie rezu');
  btnSave.disabled = true;
  const clrBtn = B('Zrušiť ručné', () => clearMan(), '', 'Zrušiť ručné umiestnenie tohto rezu (vráti sa QField / bez umiestnenia)');
  S.top.append(B('↶ Zmazať posledný', () => undo(), '', 'Backspace'), B('Zmazať všetko', () => { st.pairs = []; st.pending = null; compute(); }),
    B('⤢ Celé', () => { ps.fitBox(0, 0, Wd, Hd, 0.98); fitProf(); }, '', 'F'), clrBtn,
    el('span', { class: 'spacer' }), btnSave, B('✕ Zavrieť', () => S.close(), '', 'Esc'));
  function renderTop() { clrBtn.style.display = st.cur && st.cur.zdroj === 'body' ? '' : 'none'; }
  renderTop();
  S.msg.textContent = (d.placed || []).length > 1 ? `Na obrázku je ${(d.placed || []).length} rezov – rez prepneš vpravo hore (✓ = umiestnený). ` : '';
  S.msg.textContent += st.cur ? `Aktuálne: ${st.cur.zdroj}. Fialová = vektorizovaný profil premietnutý na sken – ak sedí, netreba nič robiť; inak pridaj páry.`
    : 'Ťukni bod na skene, potom ten istý bod v profile (aspoň 2 páry, napr. konce šnúry A a B).';
  S.keys.push(['Escape', () => S.close()], ['Backspace', () => undo()], ['s', () => save()], ['f', () => { ps.fitBox(0, 0, Wd, Hd, 0.98); fitProf(); }]);

  ps.onTap = (X, Y) => {
    const [x, y] = ps.c2w(X, Y);
    st.pending = dispToRaw(x, y, d.W, d.H, d.exif);
    S.msg.textContent = 'Bod na skene vybraný – teraz ťukni ten istý bod v profile (vpravo).';
    S.msg.className = 'screen-msg';
    ps.request();
  };
  pm.onTap = (X, Y) => {
    if (!st.pending) { S.msg.textContent = 'Najprv ťukni bod na skene (vľavo).'; return; }
    let best = null, bd = app.touchUI ? 26 : 16;
    for (const r of refs()) { const [PX, PY] = pm.w2c(r.s, r.z); const dd = Math.hypot(PX - X, PY - Y) + (r.vtx ? 3 : 0); if (dd < bd) { best = r; bd = dd; } }
    if (!best) { S.msg.textContent = 'V blízkosti nie je bod ani vrchol profilu – ťukni presnejšie.'; return; }
    st.pairs = st.pairs.filter(p => p.s !== best.s || p.z !== best.z);
    st.pairs.push({ rx: st.pending[0], ry: st.pending[1], s: best.s, z: best.z, lab: best.lab });
    st.pending = null;
    compute();
  };
  function undo() { if (st.pending) st.pending = null; else st.pairs.pop(); compute(); }
  async function compute() {
    st.res = null; btnSave.disabled = true;
    if (st.pairs.length >= 2) {
      try { st.res = (await api('/api/rezgeo/compute', { pairs: st.pairs })).res; } catch (e) { /* */ }
    }
    const R = st.res;
    if (R) {
      S.msg.textContent = `${st.pairs.length} párov  RMSE ${(R.rmse * 100).toFixed(1)} cm  max ${(Math.max(...R.resid) * 100).toFixed(1)} cm  ${R.mm_px.toFixed(3)} mm/px  rotácia ${R.rot.toFixed(1)}°   ` +
        (R.ok ? '→ sedí? 💾 Uložiť' : '→ veľká odchýlka – skontroluj páry');
      S.msg.className = 'screen-msg ' + (R.ok ? 'ok' : 'warn');
      btnSave.disabled = !st.rez;
    } else if (st.pairs.length === 1) { S.msg.textContent = '1 pár – pridaj aspoň ešte jeden.'; S.msg.className = 'screen-msg'; }
    list.innerHTML = '';
    st.pairs.forEach((p, i) => list.append(el('div', {}, `${i + 1}. ${p.lab}`, R ? el('b', {}, (R.resid[i] * 100).toFixed(1)) : '',
      el('button', { class: 'tool', style: { height: '32px', minWidth: '32px' }, onclick: () => { st.pairs.splice(i, 1); compute(); } }, '✕'))));
    ps.request(); pm.request();
  }
  async function save() {
    if (!st.res) return;
    try {
      const r = await api('/api/rezgeo/save', { scan: d.scan, g: d.g, rez: st.rez, pairs: st.pairs, img_path: d.img_path });
      toast(r.msg, 'ok'); S.close(); app.afterGeoref(st.rez);
    } catch (e) { /* */ }
  }
  async function clearMan() {
    if (!(await confirmBox('Zrušiť ručné umiestnenie rezu?', 'Zrušiť umiestnenie'))) return;
    try { const r = await api('/api/rezgeo/clear', { scan: d.scan, g: d.g, rez: st.rez }); toast(r.msg, 'ok'); S.close(); app.afterGeoref(); } catch (e) { /* */ }
  }
  // afinná px -> (s, z) a späť
  const curAff = () => (st.res ? st.res.aff : (st.pairs.length < 2 && st.cur ? st.cur.aff : null));
  ps.onDraw = c => {
    scanTiles(ps, app, d.img || d.scan, d);
    for (const o of d.placed || []) {          // ostatné rezy na tom istom obrázku (svetlo)
      const po = prof[o.rez];
      if (o.rez === st.rez || !po || !sameImg(o)) continue;
      const Mo = o.aff, Mi = invert([Mo[0], Mo[3], Mo[1], Mo[4], Mo[2], Mo[5]]);
      c.strokeStyle = 'rgba(0,150,255,0.75)'; c.lineWidth = 2; c.setLineDash([6, 4]);
      for (const ln of po.lines) {
        c.beginPath(); ln.P.forEach((q, i) => { const a = apply(Mi, q[0], q[1]); const [X, Y] = ps.w2c(...rawToDisp(a[0], a[1], d.W, d.H, d.exif)); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.stroke();
      }
      c.setLineDash([]);
      const a = apply(Mi, 0, po.lines[0].P[0][1]); const [X, Y] = ps.w2c(...rawToDisp(a[0], a[1], d.W, d.H, d.exif));
      label(c, o.rez, X, Y - 14, '#0070d0', 'bold 14px system-ui');
    }
    const M = curAff(), p = P();
    if (M && p) {
      const Mi = invert([M[0], M[3], M[1], M[4], M[2], M[5]]);
      const toC = (s, z) => { const q = apply(Mi, s, z); return ps.w2c(...rawToDisp(q[0], q[1], d.W, d.H, d.exif)); };
      c.lineJoin = 'round';
      for (const ln of p.lines) {
        c.strokeStyle = ln.typ === 'os' ? '#00c000' : '#ff00ff'; c.lineWidth = 2.5; c.setLineDash(ln.typ === 'os' ? [8, 5] : []);
        c.beginPath(); ln.P.forEach((q, i) => { const [X, Y] = toC(q[0], q[1]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); if (ln.poly) c.closePath(); c.stroke();
      }
      c.setLineDash([]);
      for (const r of p.refs || []) { const [X, Y] = toC(r.s, r.z); c.strokeStyle = r.col; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 9, 0, 7); c.stroke(); label(c, r.lab, X + 11, Y - 11, r.col); }
    }
    st.pairs.forEach((q, i) => {
      const [X, Y] = ps.w2c(...rawToDisp(q.rx, q.ry, d.W, d.H, d.exif));
      cross(c, X, Y, 12, '#ff0000'); label(c, String(i + 1), X - 22, Y + 14, '#ff0000', 'bold 14px system-ui');
    });
    if (st.pending) {
      const [X, Y] = ps.w2c(...rawToDisp(st.pending[0], st.pending[1], d.W, d.H, d.exif));
      c.strokeStyle = '#ffff00'; c.lineWidth = 3; c.beginPath(); c.arc(X, Y, 10, 0, 7); c.stroke();
    }
  };
  pm.onDraw = c => {
    const p = P();
    // výškové čiary
    const [x0, y0] = pm.c2w(0, pm.ch), [x1, y1] = pm.c2w(pm.cw, 0);
    c.lineWidth = 1;
    for (let z = Math.floor(y0 * 10) / 10; z <= y1 && z - y0 < 20; z += 0.1) {
      const [, Y] = pm.w2c(0, z); const major = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6;
      c.strokeStyle = major ? '#9bb8de' : '#dde6f2'; c.beginPath(); c.moveTo(0, Y); c.lineTo(pm.cw, Y); c.stroke();
      if (major) label(c, z.toFixed(1), 4, Y - 7, '#3060a0', '11px system-ui');
    }
    if (!p) { label(c, `Rez ${st.rez || '?'} nemá vektorizovaný profil ani zamerané konce šnúry.`, 12, 20, '#a00000', 'bold 13px system-ui'); return; }
    for (const [ch, s] of [[st.rez[0], 0], [st.rez[1], p.L]]) {
      const [X] = pm.w2c(s, 0); c.strokeStyle = '#00a000'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(X, 0); c.lineTo(X, pm.ch); c.stroke(); c.setLineDash([]);
      label(c, ch, X + 4, 14, '#00a000', 'bold 13px system-ui');
    }
    for (const ln of p.lines) {
      c.strokeStyle = ln.typ === 'os' ? '#00a000' : '#c000c0'; c.lineWidth = 2; c.setLineDash(ln.typ === 'os' ? [8, 5] : []);
      c.beginPath(); ln.P.forEach((q, i) => { const [X, Y] = pm.w2c(q[0], q[1]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }); if (ln.poly) c.closePath(); c.stroke();
      c.setLineDash([]);
      c.fillStyle = c.strokeStyle;
      for (const q of ln.P) { const [X, Y] = pm.w2c(q[0], q[1]); c.fillRect(X - 2.5, Y - 2.5, 5, 5); }
    }
    const used = new Map(st.pairs.map((q, i) => [q.s + ',' + q.z, i + 1]));
    for (const r of refs()) {
      const n = used.get(r.s + ',' + r.z);
      if (r.vtx && !n) continue;
      const [X, Y] = pm.w2c(r.s, r.z);
      if (!r.vtx) cross(c, X, Y, 8, r.col);
      if (n) { c.strokeStyle = '#ff0000'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 10, 0, 7); c.stroke(); }
      if (!r.vtx || n) label(c, r.lab + (n ? ` [${n}]` : ''), X + 9, Y - 9, r.col);
    }
  };
  compute();
}
