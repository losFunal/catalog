// map.js – mapa hrobu: sken (dlaždice, georeferencia), vektory, body, úprava vrcholov a kreslenie (myš / prst / pero)
import { api, apiUrl, ctxRGB, rgb, toast } from './ui.js';

const TILE = 512;

// ------------------------------------------------------------------ dlaždice skenov
class Tiles {
  constructor(onload) {
    this.cache = new Map();          // key -> {img, ok}
    this.queue = [];
    this.active = 0;
    this.onload = onload;
    this.max = 260;
  }
  get(id, l, x, y, rot = 1) {
    const key = `${id}|${l}|${x}|${y}|${rot}`;
    let t = this.cache.get(key);
    if (t) {
      this.cache.delete(key);
      this.cache.set(key, t);
      return t.ok ? t.img : null;
    }
    t = { ok: false, img: new Image(), key, url: apiUrl(`/api/tile?id=${encodeURIComponent(id)}&l=${l}&x=${x}&y=${y}&rot=${rot}`) };
    this.cache.set(key, t);
    this.queue.push(t);
    this._pump();
    while (this.cache.size > this.max) {
      const k = this.cache.keys().next().value;
      const old = this.cache.get(k);
      this.cache.delete(k);
      if (!old.ok) this.queue = this.queue.filter(q => q !== old);
    }
    return null;
  }
  _pump() {
    while (this.active < 6 && this.queue.length) {
      const t = this.queue.pop();          // najnovšie požiadavky najprv
      if (!this.cache.has(t.key)) continue;
      this.active++;
      t.img.onload = () => { t.ok = true; this.active--; this.onload(); this._pump(); };
      t.img.onerror = () => { this.active--; this.cache.delete(t.key); this._pump(); };
      t.img.src = t.url;
    }
  }
  forget(id) {
    for (const k of [...this.cache.keys()]) if (k.startsWith(id + '|')) this.cache.delete(k);
  }
}

const scanInfoCache = new Map();
export async function scanInfo(id) {
  if (!scanInfoCache.has(id)) scanInfoCache.set(id, api('/api/scaninfo?id=' + encodeURIComponent(id)));
  return scanInfoCache.get(id);
}
export function forgetScanInfo(id) { scanInfoCache.delete(id); }

// kreslenie dlaždíc skenu: T(u, v) = obrazovka pre (u, v) v px úrovne
export function drawTiles(ctx, tiles, id, info, level, mat, cw, ch, rot = 1, levW = null) {
  const lv = info.levels;
  level = Math.max(0, Math.min(level, lv.length - 1));
  const base = Math.min(lv.length - 1, Math.max(level, lv.findIndex(([w, h]) => Math.max(w, h) <= 1100)));
  for (const L of (base > level ? [base, level] : [level])) {
    let [lw, lh] = lv[L];
    if (rot === 6 || rot === 8) [lw, lh] = [lh, lw];
    const m = mat(L, lw, lh);           // [a,b,c,d,e,f] pre px úrovne
    const inv = invert(m);
    if (!inv) return;
    const corners = [[0, 0], [cw, 0], [0, ch], [cw, ch]].map(([X, Y]) => apply(inv, X, Y));
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const tx0 = Math.max(0, Math.floor(Math.min(...xs) / TILE)), tx1 = Math.min(Math.ceil(lw / TILE) - 1, Math.floor(Math.max(...xs) / TILE));
    const ty0 = Math.max(0, Math.floor(Math.min(...ys) / TILE)), ty1 = Math.min(Math.ceil(lh / TILE) - 1, Math.floor(Math.max(...ys) / TILE));
    if (tx1 < tx0 || ty1 < ty0 || (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 120) continue;
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const img = tiles.get(id, L, tx, ty, rot);
      if (img) {
        const w = Math.min(TILE, lw - tx * TILE), h = Math.min(TILE, lh - ty * TILE);
        ctx.drawImage(img, 0, 0, w, h, tx * TILE, ty * TILE, w + 0.6, h + 0.6);
      }
    }
    ctx.restore();
  }
}
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-18) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
export function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

// ------------------------------------------------------------------ geometria
export function insidePoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) c = !c;
  }
  return c;
}
export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function area(P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) { const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length]; s += x0 * y1 - x1 * y0; }
  return s / 2;
}
export function rdp(P, tol) {
  if (P.length < 3) return P.slice();
  const [a, b] = [P[0], P[P.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let imax = 0, dmax = -1;
  for (let i = 1; i < P.length - 1; i++) {
    const d = L < 1e-12 ? Math.hypot(P[i][0] - a[0], P[i][1] - a[1]) :
      Math.abs((b[0] - a[0]) * (P[i][1] - a[1]) - (b[1] - a[1]) * (P[i][0] - a[0])) / L;
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax > tol) return rdp(P.slice(0, imax + 1), tol).slice(0, -1).concat(rdp(P.slice(imax), tol));
  return [a, b];
}
export function transformPts(P, dx, dy, rotDeg, cx, cy, sc = 1) {
  const th = rotDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return P.map(([x, y]) => {
    const u = (x - cx) * sc, v = (y - cy) * sc;
    return [c * u - s * v + cx + dx, s * u + c * v + cy + dy];
  });
}

// ------------------------------------------------------------------ MapView
export class MapView {
  constructor(canvas, app) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.G = null;              // údaje hrobu
    this.dr = null;
    this.scan = null;           // json skenu
    this.scanInfo = null;
    this.vmode = 'dr';          // dr / all / none
    this.pmode = 'on';          // on / labels / off
    this.ctxFill = true;
    this.opacity = 1.0;
    this.hlUnsaved = false;
    this.highlight = new Set(); // vektory zo súpisu nálezov
    this.hidden = new Set();    // skryté vrstvy (panel Vrstvy)
    this.activeLayer = null;    // vrstva zvolená na úpravu
    this.view = null;           // {x, y, s} ľavý horný roh (svet) a px/m
    this.iview = null;          // pohľad na negeoreferencovaný sken {ox, oy, s}
    this.mode = 'view';         // view / edit / pick
    this.sel = null;            // {key, ft, rings, undo, dirty}
    this.draw = null;           // kreslenie nového prvku
    this.pick = null;           // {kind:'dr'|'attr', lasso:[]}
    this.moveWhole = false;
    this.noSnap = false;
    this.longer = false;
    this.penOnly = false;
    this.penSeen = false;
    this.hover = null;          // posledná poloha kurzora (obrazovka)
    this.pointers = new Map();
    this.act = null;            // rozpracovaná akcia ukazovateľa
    this.tiles = new Tiles(() => this.request());
    this._pending = false;
    this._lastPick = null;
    this.inkState = null;
    this.visFeats = [];
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  // --- veľkosť / pohľad
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.cw = Math.max(50, r.width);
    this.ch = Math.max(50, r.height);
    this.cv.width = Math.round(this.cw * this.dpr);
    this.cv.height = Math.round(this.ch * this.dpr);
    if (!this.view && this.G) this.fit(false);
    this.request();
  }
  fit(render = true) {
    if (!this.G) return;
    if (this.isRaw()) { this.fitImage(); if (render) this.request(); return; }
    const [x0, y0, x1, y1] = this.isProf() ? this.profBox() : this.G.square;
    this.fitBox(x0, y0, x1, y1);
    if (render) this.request();
  }
  fitBox(x0, y0, x1, y1, k = 0.97) {
    const cw = this.cw || 800, ch = this.ch || 600;
    const r = (this.view && this.view.r) || 0, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    const w = x1 - x0, h = y1 - y0;
    const s = Math.min(cw / (w * c + h * sn), ch / (w * sn + h * c)) * k;
    this.view = { x: 0, y: 0, s, r };
    this.anchor((x0 + x1) / 2, (y0 + y1) / 2, cw / 2, ch / 2);
  }
  // svet (x, y) sa zobrazí na obrazovke v (X, Y) – pri danej mierke a rotácii
  anchor(x, y, X, Y) {
    const v = this.view, c = Math.cos(v.r || 0), sn = Math.sin(v.r || 0);
    const u = (X * c + Y * sn) / v.s, w = (-X * sn + Y * c) / v.s;
    v.x = x - u; v.y = y + w;
  }
  rotateAt(X, Y, da) {
    if (!this.view || this.isRaw()) return;
    const [x, y] = this.c2w(X, Y);
    let r = (this.view.r || 0) + da;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    this.view.r = r;
    this.anchor(x, y, X, Y);
    this.request();
  }
  resetRotation() {
    if (!this.view || !this.view.r) return;
    const X = this.cw / 2, Y = this.ch / 2, [x, y] = this.c2w(X, Y);
    this.view.r = 0; this.anchor(x, y, X, Y); this.request();
  }
  fitImage() {
    if (!this.scanInfo) return;
    const { W, H } = this.scanInfo;
    const s = Math.min(this.cw / W, this.ch / H) * 0.98;
    this.iview = { s, ox: -(this.cw / s - W) / 2, oy: -(this.ch / s - H) / 2 };
  }
  w2c(x, y) {
    const v = this.view, u = (x - v.x) * v.s, w = (v.y - y) * v.s;
    if (!v.r) return [u, w];
    const c = Math.cos(v.r), sn = Math.sin(v.r);
    return [u * c - w * sn, u * sn + w * c];
  }
  c2w(X, Y) {
    const v = this.view;
    if (!v.r) return [v.x + X / v.s, v.y - Y / v.s];
    const c = Math.cos(v.r), sn = Math.sin(v.r);
    return [v.x + (X * c + Y * sn) / v.s, v.y - (-X * sn + Y * c) / v.s];
  }
  // kreslenie dlaždíc: matica pre neotočený pohľad -> s rotáciou
  rotMat(m) {
    const r = this.view.r || 0;
    if (!r) return m;
    const c = Math.cos(r), sn = Math.sin(r), [a, b, cc, d, e, f] = m;
    return [c * a - sn * b, sn * a + c * b, c * cc - sn * d, sn * cc + c * d, c * e - sn * f, sn * e + c * f];
  }
  zoomAt(X, Y, f) {
    if (this.isRaw()) {
      const v = this.iview; if (!v) return;
      const x = v.ox + X / v.s, y = v.oy + Y / v.s, s = Math.min(Math.max(v.s * f, 0.01), 16);
      this.iview = { s, ox: x - X / s, oy: y - Y / s };
    } else {
      if (!this.view) return;
      const [x, y] = this.c2w(X, Y);
      this.view.s = Math.min(Math.max(this.view.s * f, 20), 40000);
      this.anchor(x, y, X, Y);
    }
    this.request();
  }
  panBy(dX, dY) {
    if (this.isRaw()) { const v = this.iview; if (v) { v.ox -= dX / v.s; v.oy -= dY / v.s; } }
    else if (this.view) {
      const v = this.view, c = Math.cos(v.r || 0), sn = Math.sin(v.r || 0);
      v.x -= (dX * c + dY * sn) / v.s; v.y += (-dX * sn + dY * c) / v.s;
    }
    this.request();
  }

  // --- dáta
  setGrave(G, keepView) {
    const changed = !this.G || this.G.g !== G.g;
    this.G = G;
    this.featByKey = new Map(G.feats.map(f => [f.k, f]));
    if (changed || !keepView || !this.view) this.fit(false);
    if (this.sel) {
      const ft = this.featByKey.get(this.sel.key);
      if (!ft || changed) this.sel = null;
      else if (!this.sel.dirty) this.select(ft, true);
      else this.sel.ft = ft;
    }
    if (changed) { this.draw = null; this.pick = null; this._views = {}; this._fitted = new Set(); }
    this.request();
  }
  setScan(scanJson, dr) {
    const prevRaw = this.isRaw();
    const prevId = this.scan && this.scan.id;
    const prevKey = this._pkey || 'plan';
    this.dr = dr;
    this.scan = scanJson || null;
    const key = this.profKey();
    this._pkey = key;
    if (prevKey !== key) {                       // pôdorys a každý rez (aj viac rezov na jednom obrázku) má vlastný pohľad
      this._views = this._views || {};
      this._views[prevKey] = this.view;
      this.view = this._views[key] || null;
      if (!this.view && this.G) this.fit(false);
    }
    this.scanInfo = null;
    if (this.scan) {
      const id = this.scan.id;
      scanInfo((this.scan.typ === 'rez' && this.scan.sz && this.scan.sz.img) || id).then(inf => {
        if (this.scan && this.scan.id === id) {
          this.scanInfo = inf;
          if (this.isRaw() && (!this.iview || prevId !== id)) this.fitImage();
          if (this.isProf()) { const k = this.profKey(); this._views = this._views || {}; if (!this._fitted) this._fitted = new Set(); if (!this._fitted.has(k)) { this._fitted.add(k); this.fit(false); } }
          this.request();
        }
      }).catch(() => {});
    }
    if (prevRaw && !this.isRaw() && !this.view) this.fit(false);
    this.inkState = null;
    this.request();
  }
  isRaw() {
    // Tk: sken bez georeferencie sa ukáže samostatne (bez vektorov)
    const s = this.scan;
    return !!(s && s.status !== 'ok' && s.status !== 'mimo' && !s.wt && !(s.typ === 'rez' && s.sz));
  }
  scanForSnap() { return this.scan && this.scan.wt ? this.scan.id : null; }

  // --- zoznam prvkov ako Data.features
  feats() {
    const G = this.G;
    if (!G) return [];
    const hid = this.hidden || new Set();
    const all = hid.size ? G.feats.filter(f => !hid.has(f.layer)) : G.feats;
    if (this.vmode === 'none') return all.filter(f => f.layer === 'PROFIL_LINE' || f.kind === 'khh');
    const dr = this.dr;
    if (this.vmode === 'all') return all;
    return all.filter(f => {
      if (dr && dr !== '?' && dr !== 'rezy' && dr !== 'nevyuzite' && f.has_dr && f.drs.length && !f.drs.includes(dr)) return false;
      return true;
    });
  }
  canEdit(ft) {
    if (ft.kind !== 'khh' && ft.layer !== 'KHD_OBEJKT_POLYGON') return true;
    const drs = this.G.real_drs;
    if (!drs.length) return true;
    return this.dr === (ft.kind === 'khh' ? drs[0] : this.G.dno_dr);
  }
  ftGeom(ft) {
    if (this.sel && this.sel.key === ft.k && this.mode === 'edit') return [this.selGeom(), 'shape'];
    if (this.mode === 'move' && this.mv && this.mv.keys.has(ft.k)) {
      const e = this.mv, base = e.base[ft.k] || ft.geom;
      return [base.map(poly => poly.map(r => transformPts(r, e.dx, e.dy, e.rot, e.cx, e.cy))), 'edit'];
    }
    if (this.mode === 'prop' && this.prop && this.prop.dr === this.dr) {
      const mm = this.man;
      if (mm && mm.geom.has(ft.k)) return [mm.geom.get(ft.k), 'man'];
      const it = this.prop.items.get(ft.k);
      if (it && (it.accept || it.stav !== 'sedi')) return it.accept ? [it.geom, 'prop'] : [ft.geom, 'propx'];
    }
    return [ft.geom, ft.src];
  }
  selGeom() {
    const out = [];
    for (const r of this.sel.rings) {
      let P = r.pts.slice();
      if (r.closed && P.length && (P[0][0] !== P[P.length - 1][0] || P[0][1] !== P[P.length - 1][1])) P = P.concat([P[0]]);
      if (r.hole && out.length) out[out.length - 1].push(P); else out.push([P]);
    }
    return out;
  }

  // --- kreslenie
  request() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.render(); });
  }
  render() {
    const c = this.ctx, cw = this.cw, ch = this.ch, dpr = this.dpr;
    if (!cw) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#9a9a9a';
    c.fillRect(0, 0, cw, ch);
    if (!this.G) return;
    if (!this.view) this.fit(false);
    const s = this.scan;
    if (this.isRaw()) { this.renderRaw(); return; }
    if (this.isProf()) { this.renderProf(); return; }
    if (s && s.wt && this.scanInfo && this.opacity > 0) this.drawScan();
    if (this.opacity < 1) { c.fillStyle = `rgba(255,255,255,${1 - this.opacity})`; c.fillRect(0, 0, cw, ch); }
    this.drawVectors();
    this.drawSections();
    this.drawPoints();
    this.drawSel();
    this.drawMan();
    this.drawMoveCenter();
    this.drawNew();
    this.drawLasso();
    const sq = this.G.square;
    c.save(); c.setLineDash([3, 3]); c.strokeStyle = '#d00000'; c.lineWidth = 1;
    this.path([[sq[0], sq[1]], [sq[2], sq[1]], [sq[2], sq[3]], [sq[0], sq[3]]], true); c.restore();
    this.drawScalebar();
    this.drawCompass();
    this.drawCoords();
  }
  drawScan(wt) {
    const s = this.scan, info = this.scanInfo, v = this.view;
    const [A, D, B, E, C, F] = wt || s.wt;
    const pix = v.s * Math.hypot(A, D) * this.dpr;      // px obrazovky na 1 px skenu
    let lvl = 0;
    while (lvl + 1 < info.levels.length && pix * 2 ** (lvl + 1) <= 1.0) lvl++;
    const mat = (L, lw, lh) => {
      const fx = info.W / lw, fy = info.H / lh;
      return this.rotMat([v.s * A * fx, -v.s * D * fx, v.s * B * fy, -v.s * E * fy,
        v.s * (C - v.x - 0.5 * A - 0.5 * B), v.s * (v.y - F + 0.5 * D + 0.5 * E)]);
    };
    this.ctx.imageSmoothingEnabled = pix < 3;
    drawTiles(this.ctx, this.tiles, (wt && s.sz && s.sz.img) || s.id, info, lvl, mat, this.cw, this.ch);
    this.ctx.imageSmoothingEnabled = true;
  }
  renderRaw() {
    const c = this.ctx, info = this.scanInfo;
    if (info) {
      if (!this.iview) this.fitImage();
      const v = this.iview;
      let lvl = 0;
      while (lvl + 1 < info.levels.length && v.s * this.dpr * 2 ** (lvl + 1) <= 1.0) lvl++;
      const mat = (L, lw, lh) => {
        const fx = info.W / lw, fy = info.H / lh;
        return [v.s * fx, 0, 0, v.s * fy, -v.ox * v.s, -v.oy * v.s];
      };
      drawTiles(c, this.tiles, this.scan.id, info, lvl, mat, this.cw, this.ch);
      if (this.opacity < 1) { c.fillStyle = `rgba(255,255,255,${1 - this.opacity})`; c.fillRect(0, 0, this.cw, this.ch); }
    }
    this.drawCoords();
  }
  drawVectors() {
    const c = this.ctx, G = this.G;
    if (!G.has_khh) {
      c.save(); c.setLineDash([6, 3]); c.strokeStyle = '#202020'; c.lineWidth = 1;
      for (const ring of G.rings) this.path(ring, false); c.restore();
    }
    const feats = this.feats();
    this.visFeats = feats.filter(f => f.kind !== 'point' && (f.layer !== 'PROFIL_LINE' || (this.mode === 'edit' && f.hrob === G.g)));
    if (this.ctxFill) this.drawCtxFill(feats);
    for (const ft of feats) {
      const noDr = ft.has_dr && !ft.drs.length;
      let col = noDr && this.vmode === 'dr' ? '#c000c0' : ft.color;
      const [geom, src] = this.ftGeom(ft);
      if (src === 'shape') continue;
      if (src === 'vedit' && this.hlUnsaved && ft.kind !== 'fill') col = '#0090ff';
      if (src === 'edit' && ft.kind !== 'fill') col = '#ff00ff';
      if (src === 'man' || src === 'prop' || src === 'propx') {
        c.save();
        if (src !== 'propx') {                        // pôvodná poloha tenko sivo
          c.strokeStyle = '#606060'; c.lineWidth = 1; c.setLineDash([2, 2]);
          for (const poly of ft.geom) if (poly[0].length >= 2) this.path(poly[0], false);
        }
        const manKey = this.man && this.man.key === ft.k;
        c.setLineDash(src === 'propx' || (manKey && src !== 'man') ? [6, 3] : []);
        c.strokeStyle = src === 'man' || manKey ? '#00c8ff' : src === 'prop' ? '#00d060' : '#ff3030';
        c.lineWidth = src === 'man' ? 3 : src === 'prop' ? 2.5 : 1.5;
        for (const poly of geom) if (poly[0].length >= 2) this.path(poly[0], false);
        if (this.prop && this.prop.sel === ft.k) { c.setLineDash([]); c.strokeStyle = 'rgba(255,235,59,.7)'; c.lineWidth = 7;
          for (const poly of geom) if (poly[0].length >= 2) this.path(poly[0], false); }
        c.restore();
        continue;
      }
      if (ft.layer === 'ULOZENINY' && (src === null || src === 'saved' || (src === 'vedit' && !this.hlUnsaved)) &&
        !(noDr && this.vmode === 'dr')) col = rgb(ctxRGB(ft.label, 0.6));
      const parts = geom.map(p => p[0]);
      for (const part of parts) {
        if (ft.kind === 'point') {
          const [X, Y] = this.w2c(part[0][0], part[0][1]);
          c.fillStyle = col; c.beginPath(); c.moveTo(X - 5, Y + 4); c.lineTo(X + 5, Y + 4); c.lineTo(X, Y - 5); c.closePath(); c.fill();
          if (ft.label) this.text(ft.label, X + 7, Y, '#000', 'bold 11px system-ui', 'left', 'middle');
        } else if (ft.kind === 'fill' && part.length >= 3) {
          c.beginPath(); this.trace(part, true);
          c.fillStyle = col; c.globalAlpha = this.opacity > 0 ? 0.55 : 1; c.fill(); c.globalAlpha = 1;
          c.strokeStyle = '#303030'; c.lineWidth = 1; c.stroke();
        } else if (ft.kind === 'profil' && part.length >= 2) {
          c.save(); c.setLineDash([5, 3]); c.strokeStyle = col; c.lineWidth = 1; this.path(part, false); c.restore();
          c.strokeStyle = col; c.lineWidth = 2;
          for (const p of [part[0], part[part.length - 1]]) {
            const [X, Y] = this.w2c(p[0], p[1]);
            c.beginPath(); c.moveTo(X - 7, Y); c.lineTo(X + 7, Y); c.moveTo(X, Y - 7); c.lineTo(X, Y + 7); c.stroke();
          }
        } else if (part.length >= 2) {
          const w = (ft.kind === 'khh' || ft.layer === 'KHD_OBEJKT_POLYGON') ? 3 : (ft.layer === 'ULOZENINY' || ft.layer === 'KHV_LINE') ? 2 : 1;
          c.save();
          c.setLineDash(ft.layer === 'KHV_LINE' ? [9, 5] : noDr ? [4, 3] : []);
          c.strokeStyle = col; c.lineWidth = w; this.path(part, false); c.restore();
        }
      }
      if (ft.layer === 'ULOZENINY' && ft.label && this.ctxFill && parts.length) {
        const m = mean(parts[0]); const [X, Y] = this.w2c(m[0], m[1]);
        this.text(ft.label, X, Y, '#000', 'bold 12px system-ui', 'center', 'middle', true);
      }
      if (ft.kind === 'fill' && ft.label && ft.layer !== 'KOSTL_POLYGON' && ft.layer !== 'KAMEN_NEOPRAC') {
        const m = mean([].concat(...parts)); const [X, Y] = this.w2c(m[0], m[1]);
        this.text(ft.label, X + 6, Y - 6, '#000', '11px system-ui', 'left', 'middle', true);
      }
    }
    if (this.highlight.size) {
      c.strokeStyle = '#ff00b0'; c.lineWidth = 4;
      for (const ft of G.feats) if (this.highlight.has(ft.k)) {
        for (const poly of ft.geom) {
          const P = poly[0];
          if (P.length >= 2) this.path(P, false);
          else if (P.length === 1) { const [X, Y] = this.w2c(P[0][0], P[0][1]); c.beginPath(); c.arc(X, Y, 8, 0, 7); c.stroke(); }
        }
      }
    }
  }
  drawCtxFill(feats) {
    const items = [];
    for (const ft of feats) {
      if (ft.layer !== 'ULOZENINY' || !ft.poly) continue;
      if (ft.has_dr && !ft.drs.length && this.vmode === 'dr') continue;
      const [geom, src] = this.ftGeom(ft);
      if (src === 'shape') continue;
      for (const poly of geom) if (poly[0].length >= 3) items.push([Math.abs(area(poly[0])), poly, ctxRGB(ft.label)]);
    }
    if (!items.length) return;
    items.sort((a, b) => b[0] - a[0]);
    if (!this._off) this._off = document.createElement('canvas');
    const o = this._off;
    o.width = this.cv.width; o.height = this.cv.height;
    const oc = o.getContext('2d');
    oc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [, poly, col] of items) {
      oc.globalCompositeOperation = 'destination-out';
      oc.beginPath(); this.trace(poly[0], true, oc); oc.fillStyle = '#000'; oc.fill();
      oc.globalCompositeOperation = 'source-over';
      oc.beginPath(); this.trace(poly[0], true, oc);
      for (const h of poly.slice(1)) this.trace(h, true, oc);
      oc.fillStyle = rgb(col); oc.fill('evenodd');
    }
    this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.globalAlpha = 0.8;
    this.ctx.drawImage(o, 0, 0); this.ctx.restore();
  }
  drawSections() {
    for (const [name, seg] of Object.entries(this.G.sections || {})) {
      seg.forEach((p, i) => {
        const [X, Y] = this.w2c(p[0], p[1]);
        this.text(name[i], X + 9, Y - 9, '#006000', 'bold 15px system-ui', 'left', 'bottom', true);
      });
    }
  }
  drawPoints() {
    if (this.pmode === 'off' || this.vmode === 'none' || (this.hidden && this.hidden.has('BODY'))) return;
    const c = this.ctx, dr = this.dr;
    for (const p of this.G.points) {
      if (this.vmode === 'dr' && dr && dr !== '?' && dr !== 'rezy' && dr !== 'nevyuzite' && p.drs.length && !p.drs.includes(dr)) continue;
      const other = p.nocode || !p.drs.length;
      const [X, Y] = this.w2c(p.x, p.y);
      if (X < -20 || Y < -20 || X > this.cw + 20 || Y > this.ch + 20) continue;
      let col = p.col, shape = p.shape;
      if (p.kind === 'mereni') { [col, shape] = p.pref === 'MER' ? ['#ff8c00', 'plus'] : ['#909090', 'dot']; }
      if (other && shape === 'dot') col = p.nocode ? '#c000c0' : col;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
      c.beginPath();
      if (shape === 'plus') { c.moveTo(X - 7, Y); c.lineTo(X + 7, Y); c.moveTo(X, Y - 7); c.lineTo(X, Y + 7); c.stroke(); }
      else if (shape === 'cross') { c.moveTo(X - 6, Y - 6); c.lineTo(X + 6, Y + 6); c.moveTo(X - 6, Y + 6); c.lineTo(X + 6, Y - 6); c.stroke(); }
      else if (shape === 'tri') { c.moveTo(X - 5, Y + 4); c.lineTo(X + 5, Y + 4); c.lineTo(X, Y - 5); c.closePath(); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); }
      else if (shape === 'sq') { c.rect(X - 4, Y - 4, 8, 8); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); }
      else { c.arc(X, Y, 3, 0, 7); c.fill(); if (other) { c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); } }
      let lab = '';
      if (this.pmode === 'labels') lab = p.code;
      else if (p.kind === 'mereni') lab = p.pref === 'MER' ? p.label : '';
      else if (p.pref.startsWith('OSA')) lab = p.pref.slice(3);
      else if (p.pref.startsWith('LB')) lab = p.pref;
      else if (p.pref.startsWith('NIV') && p.z) lab = Number(p.z).toFixed(2);
      if (lab) this.text(lab, X + 8, Y - 2, col, 'bold 11px system-ui', 'left', 'middle', true);
    }
  }
  drawSel() {
    if (this.mode !== 'edit' || !this.sel) return;
    const c = this.ctx;
    const touch = this.app.touchUI;
    const hr = touch ? 7 : 5;
    for (const ring of this.sel.rings) {
      const P = ring.pts;
      if (P.length < 2) continue;
      c.strokeStyle = '#00c8ff'; c.lineWidth = 3; c.setLineDash([]);
      this.path(ring.closed ? P.concat([P[0]]) : P, false);
      // stredy hrán = „+“ úchyty na nový vrchol
      const n = ring.closed ? P.length : P.length - 1;
      c.fillStyle = 'rgba(255,255,255,0.75)'; c.strokeStyle = '#0070c0'; c.lineWidth = 1.5;
      for (let i = 0; i < n; i++) {
        const a = this.w2c(...P[i]), b = this.w2c(...P[(i + 1) % P.length]);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 34) continue;
        c.beginPath(); c.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, hr - 2, 0, 7); c.fill(); c.stroke();
      }
      c.lineWidth = 2;
      P.forEach(([x, y], i) => {
        const [X, Y] = this.w2c(x, y);
        c.fillStyle = (this.act && this.act.type === 'vertex' && this.act.vi === i && this.sel.rings[this.act.ri] === ring) ? '#ffeb3b' : '#fff';
        c.fillRect(X - hr, Y - hr, 2 * hr, 2 * hr); c.strokeStyle = '#0070c0'; c.strokeRect(X - hr, Y - hr, 2 * hr, 2 * hr);
      });
      if (!ring.closed && P.length >= 2) {
        const [X, Y] = this.w2c(...P[0]);
        this.text('▶', X - 14, Y - 12, '#0070c0', 'bold 11px system-ui', 'center', 'middle', true);
      }
    }
  }
  drawMan() {
    const mm = this.man;
    if (!mm || this.mode !== 'prop') return;
    const c = this.ctx;
    c.strokeStyle = '#ff2020'; c.lineWidth = 2;
    for (const [a, b] of mm.pairs) {
      const A = this.w2c(...a), B = this.w2c(...b);
      c.beginPath(); c.moveTo(...A); c.lineTo(...B); c.stroke();
      const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
      c.beginPath(); c.moveTo(...B); c.lineTo(B[0] - 9 * Math.cos(ang - 0.4), B[1] - 9 * Math.sin(ang - 0.4));
      c.moveTo(...B); c.lineTo(B[0] - 9 * Math.cos(ang + 0.4), B[1] - 9 * Math.sin(ang + 0.4)); c.stroke();
      c.beginPath(); c.arc(A[0], A[1], 4, 0, 7); c.stroke();
    }
    if (mm.pend) { const [X, Y] = this.w2c(...mm.pend); c.lineWidth = 3; c.beginPath(); c.arc(X, Y, 7, 0, 7); c.stroke(); }
    c.lineWidth = 2;
    for (const [x, y] of mm.pts) { const [X, Y] = this.w2c(x, y); c.fillStyle = '#fff'; c.fillRect(X - 4, Y - 4, 8, 8); c.strokeStyle = '#0070c0'; c.strokeRect(X - 4, Y - 4, 8, 8); }
    if (mm.stroke && mm.stroke.length > 1) { c.strokeStyle = '#0070c0'; this.path(mm.stroke, false); }
  }
  drawMoveCenter() {
    const e = this.mv;
    if (this.mode !== 'move' || !e) return;
    const [X, Y] = this.w2c(e.cx + e.dx, e.cy + e.dy), c = this.ctx;
    c.strokeStyle = '#ff00ff'; c.lineWidth = 2;
    c.beginPath(); c.arc(X, Y, 9, 0, 7); c.moveTo(X - 14, Y); c.lineTo(X + 14, Y); c.moveTo(X, Y - 14); c.lineTo(X, Y + 14); c.stroke();
    if (e.rotMode) { c.setLineDash([4, 4]); c.beginPath(); c.arc(X, Y, 60, 0, 7); c.stroke(); c.setLineDash([]); }
  }
  drawNew() {
    const d = this.draw;
    if (!d) return;
    const c = this.ctx;
    const P = d.pts.slice();
    const pv = [];
    if (this.hover && !d.whole && this.hover.inside) pv.push(this.c2w(this.hover.X, this.hover.Y));
    if (P.length >= 1) {
      const Q = P.concat(pv);
      if (d.typ === 'polygon' && Q.length >= 3) Q.push(Q[0]);
      c.save(); c.strokeStyle = '#ff00ff'; c.lineWidth = 2;
      this.path(P.length >= 2 ? (d.typ === 'polygon' && P.length >= 3 && !pv.length ? P.concat([P[0]]) : P) : P, false);
      if (pv.length) { c.setLineDash([5, 4]); c.globalAlpha = 0.7; this.path(Q.slice(P.length - 1), false); }
      c.restore();
    }
    if (d.stroke && d.stroke.length > 1) { c.strokeStyle = '#ff00ff'; c.lineWidth = 2; this.path(d.stroke, false); }
    c.lineWidth = 2;
    for (const [x, y] of P) {
      const [X, Y] = this.w2c(x, y);
      c.fillStyle = '#fff'; c.fillRect(X - 4, Y - 4, 8, 8); c.strokeStyle = '#ff00ff'; c.strokeRect(X - 4, Y - 4, 8, 8);
    }
  }
  drawLasso() {
    const a = this.act;
    if (!a || a.type !== 'lasso' || a.pts.length < 2) return;
    const c = this.ctx;
    c.save(); c.setLineDash([5, 3]); c.strokeStyle = '#ff00ff'; c.lineWidth = 2;
    c.beginPath(); a.pts.forEach(([X, Y], i) => (i ? c.lineTo(X, Y) : c.moveTo(X, Y))); c.closePath(); c.stroke(); c.restore();
  }
  compassXY() { return [this.cw - 30, 30]; }
  drawCompass() {
    const r = (this.view && this.view.r) || 0;
    if (Math.abs(r) < 1e-6) return;
    const c = this.ctx, [X, Y] = this.compassXY();
    c.save(); c.translate(X, Y); c.rotate(r);
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.strokeStyle = '#555'; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, 20, 0, 7); c.fill(); c.stroke();
    c.fillStyle = '#d00000'; c.beginPath(); c.moveTo(0, -16); c.lineTo(6, 0); c.lineTo(-6, 0); c.closePath(); c.fill();
    c.fillStyle = '#555'; c.beginPath(); c.moveTo(0, 16); c.lineTo(6, 0); c.lineTo(-6, 0); c.closePath(); c.fill();
    c.restore();
  }
  // --- rez v profilovom priestore (x = vzdialenosť od začiatku rezu, y = výška n. m.)
  profKey() { return this.isProf() ? `prof:${this.scan.id}|${this.scan.sz.rez}` : 'plan'; }
  isProf() { const s = this.scan; return !!(s && s.typ === 'rez' && s.sz && s.sz.wt); }
  profData() { const s = this.scan; return (this.G && this.G.profily && s && s.sz && this.G.profily[s.sz.rez]) || null; }
  profBox() {
    const s = this.scan, P = [];
    if (this.scanInfo) {
      const [A, D, B, E, C, F] = s.sz.wt, W = this.scanInfo.W, H = this.scanInfo.H;
      for (const [u, w] of [[0, 0], [W, 0], [0, H], [W, H]]) P.push([A * u + B * w + C, D * u + E * w + F]);
    }
    const pd = this.profData();
    if (pd) for (const ln of pd.lines) P.push(...ln.P);
    if (!P.length) return [-0.2, 173, 3, 176];
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  renderProf() {
    const c = this.ctx, cw = this.cw, ch = this.ch, s = this.scan;
    this.visFeats = [];
    if (this.scanInfo && this.opacity > 0) this.drawScan(s.sz.wt);
    if (this.opacity < 1) { c.fillStyle = `rgba(255,255,255,${1 - this.opacity})`; c.fillRect(0, 0, cw, ch); }
    const [x0, y0] = this.c2w(0, ch), [x1, y1] = this.c2w(cw, 0);
    // výškové čiary každých 10 cm
    const zs = Math.floor(Math.min(y0, y1) * 10) / 10, ze = Math.max(y0, y1);
    const xa = Math.min(x0, x1) - 5, xb = Math.max(x0, x1) + 5;
    c.save(); c.lineWidth = 1;
    for (let z = zs; z <= ze && z - zs < 30; z += 0.1) {
      const major = Math.abs(z * 2 - Math.round(z * 2)) < 1e-6;
      c.strokeStyle = major ? 'rgba(0,90,200,0.45)' : 'rgba(0,90,200,0.18)';
      this.path([[xa, z], [xb, z]]);
      if (major || this.view.s > 300) { const Y = this.w2c(x0, z)[1]; this.text(z.toFixed(2), cw - 6, Y - 7, '#0050b0', '11px system-ui', 'right', 'middle', true); }
    }
    c.restore();
    const pd = this.profData();
    if (pd && this.vmode !== 'none') {
      c.save(); c.lineJoin = 'round';
      for (const ln of pd.lines) {
        const os = ln.typ === 'os';
        if (os && this.hidden && this.hidden.has('PROFIL_LINE')) continue;
        c.setLineDash(os ? [8, 5] : []);
        c.strokeStyle = os ? '#00a000' : ln.poly ? '#c06000' : '#ff00ff';
        c.lineWidth = os ? 2 : 3;
        this.path(ln.P, ln.poly);
      }
      c.setLineDash([]);
      // šnúra / začiatok a koniec rezu
      const rez = s.sz.rez || '';
      for (const r of pd.refs || []) {
        const [X, Y] = this.w2c(r.s, r.z);
        c.strokeStyle = r.col; c.lineWidth = 2; c.beginPath(); c.moveTo(X - 7, Y); c.lineTo(X + 7, Y); c.moveTo(X, Y - 7); c.lineTo(X, Y + 7); c.stroke();
        this.text(r.lab, X + 8, Y - 10, r.col, 'bold 13px system-ui', 'left', 'middle', true);
      }
      if (!pd.refs || !pd.refs.some(r => r.lab === rez[0])) {
        for (const [ch_, sx] of [[rez[0], 0], [rez[1], pd.L]]) {
          if (!ch_) continue;
          const [X] = this.w2c(sx, 0);
          c.strokeStyle = '#00a000'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(X, 0); c.lineTo(X, ch); c.stroke(); c.setLineDash([]);
          this.text(ch_, X + 4, 16, '#00a000', 'bold 14px system-ui', 'left', 'middle', true);
        }
      }
      c.restore();
    }
    this.drawScalebar();
    this.drawCompass();
    if (this.hover && this.hover.inside) {
      const [x, y] = this.c2w(this.hover.X, this.hover.Y);
      this.text(`od ${(s.sz.rez || 'A')[0]} ${x.toFixed(2)} m   výška ${y.toFixed(3)} m`, cw - 8, ch - 8, '#fff', '12px ui-monospace,monospace', 'right', 'bottom', false, '#000');
    }
  }
  drawScalebar() {
    const s = this.view.s;
    let L = 5;
    for (const l of [0.05, 0.1, 0.2, 0.5, 1, 2, 5]) { if (l * s >= 80) { L = l; break; } }
    const X = 14, Y = this.ch - 18, c = this.ctx;
    c.fillStyle = '#000'; c.fillRect(X, Y - 5, L * s, 5);
    this.text((L < 1 ? Math.round(L * 100) + ' cm' : L + ' m'), X + L * s + 6, Y - 3, '#000', '12px system-ui', 'left', 'middle', true);
  }
  drawCoords() {
    if (!this.hover || !this.hover.inside) return;
    let t;
    if (this.isRaw()) { const v = this.iview; if (!v) return; t = `px ${Math.round(v.ox + this.hover.X / v.s)}, ${Math.round(v.oy + this.hover.Y / v.s)}`; }
    else { const [x, y] = this.c2w(this.hover.X, this.hover.Y); t = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}`; }
    this.text(t, this.cw - 8, this.ch - 8, '#fff', '12px ui-monospace,monospace', 'right', 'bottom', false, '#000');
  }
  path(P, closed, c = this.ctx) { c.beginPath(); this.trace(P, closed, c); c.stroke(); }
  trace(P, closed, c = this.ctx) {
    P.forEach((p, i) => { const [X, Y] = this.w2c(p[0], p[1]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    if (closed) c.closePath();
  }
  text(t, X, Y, col, font, align = 'left', base = 'middle', halo = false, haloCol = '#fff') {
    const c = this.ctx;
    c.font = font; c.textAlign = align; c.textBaseline = base;
    if (halo || haloCol !== '#fff') { c.lineWidth = 3; c.strokeStyle = haloCol; c.lineJoin = 'round'; c.strokeText(t, X, Y); }
    c.fillStyle = col; c.fillText(t, X, Y);
  }

  // --- výber prvkov pod kurzorom (ako Katalog._features_at)
  featuresAt(X, Y, opts = {}) {
    const edge = [], inside = [];
    const maxd = opts.maxd || (this.app.touchUI ? 14 : 8);
    const [wx, wy] = this.c2w(X, Y);
    for (const ft of this.visFeats) {
      if (this.mode === 'edit' && !opts.all && !this.canEdit(ft)) continue;
      if (this.mode === 'edit' && !opts.all && !opts.anyLayer && this.activeLayer && ft.layer !== this.activeLayer) continue;
      const [geom] = this.ftGeom(ft);
      let best = null;
      for (const poly of geom) for (const r of poly) {
        for (let i = 0; i < r.length - 1; i++) {
          const a = this.w2c(...r[i]), b = this.w2c(...r[i + 1]);
          const d = segDist(X, Y, a[0], a[1], b[0], b[1]);
          if (d <= maxd && (best === null || d < best)) best = d;
        }
      }
      if (best !== null) { edge.push([best, ft]); continue; }
      if (opts.edgeOnly) continue;
      if (ft.poly) for (const poly of geom) {
        if (insidePoly(wx, wy, poly[0]) && !poly.slice(1).some(h => insidePoly(wx, wy, h))) {
          inside.push([Math.abs(area(poly[0])), ft]); break;
        }
      }
    }
    edge.sort((a, b) => a[0] - b[0]); inside.sort((a, b) => a[0] - b[0]);
    return edge.map(x => x[1]).concat(inside.map(x => x[1]));
  }
  pickCycle(X, Y) {
    const cands = this.featuresAt(X, Y);
    if (!cands.length) return null;
    const keys = cands.map(f => f.k).join(',');
    const last = this._lastPick;
    let i = 0;
    if (last && Math.abs(last.X - X) + Math.abs(last.Y - Y) <= 8 && last.keys === keys) i = (last.i + 1) % cands.length;
    this._lastPick = { X, Y, keys, i };
    if (cands.length > 1) this.app.status(`Pod kurzorom je ${cands.length} prvkov (${i + 1}/${cands.length}) – ďalší ťuk na to isté miesto vyberie ďalší.`);
    return cands[i];
  }

  // --- režimy
  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    if (m !== 'edit') { this.sel = null; this.draw = null; }
    if (m !== 'pick') this.pick = null;
    if (m !== 'move') this.mv = null;
    if (m !== 'prop') { this.prop = null; this.man = null; }
    this.act = null;
    this.app.onMapState();
    this.request();
  }
  select(ft, keepQuiet) {
    if (!ft) { this.sel = null; this.app.onMapState(); this.request(); return; }
    const rings = [];
    for (const poly of ft.geom) poly.forEach((r, i) => {
      let P = r.map(p => [p[0], p[1]]);
      const closed = !!ft.poly;
      if (closed && P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
      rings.push({ pts: P, closed, hole: i > 0 });
    });
    this.sel = { key: ft.k, ft, rings, undo: [], dirty: false };
    if (!keepQuiet) this.app.onMapState();
    this.request();
  }
  cycleSel(d) {
    // [ / ] = predchádzajúci / ďalší prvok zo zobrazených (ako Katalog.shape_cycle)
    const vis = this.visFeats.filter(f => this.canEdit(f));
    if (!vis.length) return;
    const keys = vis.map(f => f.k);
    let i = this.sel && keys.includes(this.sel.key) ? keys.indexOf(this.sel.key) + d : 0;
    i = (i % keys.length + keys.length) % keys.length;
    const go = () => { this.select(vis[i]); this.app.status(`Vybraný prvok ${i + 1}/${keys.length}: ${vis[i].layer} OID ${vis[i].fid}`); };
    if (this.sel && this.sel.dirty && this.sel.key !== keys[i]) this.app.askDiscard().then(ok => ok && go()); else go();
  }
  pushUndo() {
    if (!this.sel) return;
    this.sel.undo.push(this.sel.rings.map(r => ({ ...r, pts: r.pts.map(p => p.slice()) })));
    if (this.sel.undo.length > 60) this.sel.undo.shift();
    this.sel.dirty = true;
    this.app.onMapState();
  }
  undo() {
    if (this.draw) { this.drawUndo(); return; }
    if (!this.sel || !this.sel.undo.length) return;
    this.sel.rings = this.sel.undo.pop();
    this.sel.dirty = this.sel.undo.length > 0;
    this.app.onMapState();
    this.request();
  }
  transformSel(sc = 1, rot = 0, dx = 0, dy = 0) {
    if (!this.sel) return;
    const now = Date.now(), op = sc !== 1 ? 's' : rot ? 'r' : 'm';
    const last = this._trLast || [null, 0];
    if (last[0] !== op || now - last[1] > 1500) {
      this.pushUndo();
      this._trSum = { sc: 1, rot: 0 };
    }
    this._trLast = [op, now];
    this.sel.dirty = true;
    const all = [].concat(...this.sel.rings.map(r => r.pts));
    const m = mean(all);
    for (const r of this.sel.rings) r.pts = transformPts(r.pts, dx, dy, rot, m[0], m[1], sc);
    this._trSum.sc *= sc; this._trSum.rot += rot;
    if (op === 's') this.app.status(`Mierka prvku ×${this._trSum.sc.toFixed(3)} (↶ = späť)`);
    if (op === 'r') this.app.status(`Rotácia prvku ${this._trSum.rot > 0 ? '+' : ''}${this._trSum.rot.toFixed(1)}° (↶ = späť)`);
    this.request();
  }
  reverseSel() {
    if (!this.sel || this.sel.rings.some(r => r.closed)) { this.app.status('Otočiť smer: vyber líniu (napr. rez z PROFIL_LINE).'); return; }
    this.pushUndo();
    for (const r of this.sel.rings) r.pts.reverse();
    this.app.status('Smer línie otočený (začiatok = A/C/E/G). Uložiť = 💾.');
    this.request();
  }
  hitVertex(X, Y, r) {
    if (!this.sel) return null;
    let best = null, bd = r;
    this.sel.rings.forEach((ring, ri) => ring.pts.forEach(([x, y], vi) => {
      const [PX, PY] = this.w2c(x, y);
      const d = Math.hypot(PX - X, PY - Y);
      if (d <= bd) { best = [ri, vi]; bd = d; }
    }));
    return best;
  }
  hitMid(X, Y, r) {
    if (!this.sel) return null;
    let best = null, bd = r;
    this.sel.rings.forEach((ring, ri) => {
      const P = ring.pts, n = ring.closed ? P.length : P.length - 1;
      for (let i = 0; i < n; i++) {
        const a = this.w2c(...P[i]), b = this.w2c(...P[(i + 1) % P.length]);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 34) continue;
        const d = Math.hypot((a[0] + b[0]) / 2 - X, (a[1] + b[1]) / 2 - Y);
        if (d <= bd) { best = [ri, i]; bd = d; }
      }
    });
    return best;
  }
  hitEdge(X, Y, r) {
    if (!this.sel) return null;
    let best = null, bd = r;
    this.sel.rings.forEach((ring, ri) => {
      const P = ring.pts, n = ring.closed ? P.length : P.length - 1;
      for (let i = 0; i < n; i++) {
        const a = this.w2c(...P[i]), b = this.w2c(...P[(i + 1) % P.length]);
        const d = segDist(X, Y, a[0], a[1], b[0], b[1]);
        if (d <= bd) { best = [ri, i, d]; bd = d; }
      }
    });
    return best;
  }
  onSel(X, Y) {
    if (!this.sel) return false;
    const [wx, wy] = this.c2w(X, Y);
    if (this.hitEdge(X, Y, 14)) return true;
    return this.sel.rings.some(r => r.closed && !r.hole && insidePoly(wx, wy, r.pts));
  }
  deleteVertex(ri, vi) {
    const ring = this.sel.rings[ri];
    if (ring.pts.length <= (ring.closed ? 3 : 2)) { this.app.status('Menej vrcholov už prvok mať nemôže.'); return; }
    this.pushUndo();
    ring.pts.splice(vi, 1);
    this.app.status('Vrchol zmazaný (↶ = späť).');
    this.request();
  }
  deleteVertexAtHover() {
    if (!this.sel || !this.hover) return;
    const h = this.hitVertex(this.hover.X, this.hover.Y, 14);
    if (h) this.deleteVertex(...h);
  }

  // --- kreslenie nového prvku
  startDraw(layer, typ, attrs, auto) {
    this.setMode('edit');
    this.sel = null;
    this.draw = { layer, typ, attrs, auto, pts: [], groups: [], last: null, trace: this.app.traceOn !== false, whole: false, stroke: null };
    const sid = this.scanForSnap();
    if (sid) {
      this.inkState = 'run';
      api('/api/ink/prepare', { g: this.G.g, scan: sid }, { quiet: true }).then(r => { this.inkState = r.state; this._pollInk(sid); }).catch(() => {});
    }
    this.app.onMapState();
    this.request();
  }
  _pollInk(sid) {
    if (this.inkState !== 'run') return;
    setTimeout(() => {
      api('/api/ink/prepare', { g: this.G.g, scan: sid }, { quiet: true }).then(r => {
        this.inkState = r.state; this.app.onMapState(); this._pollInk(sid);
      }).catch(() => {});
    }, 1500);
  }
  traceRings() {
    const out = [];
    for (const ft of this.visFeats) {
      const [geom] = this.ftGeom(ft);
      let i = 0;
      for (const poly of geom) for (const r of poly) {
        let P = r.map(p => [p[0], p[1]]);
        if (P.length >= 2) {
          const closed = !!ft.poly && P.length >= 4;
          if (closed && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
          out.push([ft.k, i, P, closed]);
        }
        i++;
      }
    }
    return out;
  }
  traceHit(X, Y, rpx, prefer) {
    const w = this.c2w(X, Y), lim = rpx / this.view.s;
    let best = null;
    for (const [key, i, P, closed] of this.traceRings()) {
      const Q = closed ? P.concat([P[0]]) : P;
      let k = -1, dk = Infinity, tk = 0;
      const seg = [];
      for (let j = 0; j < Q.length - 1; j++) {
        const A = Q[j], B = Q[j + 1], ABx = B[0] - A[0], ABy = B[1] - A[1], L2 = ABx * ABx + ABy * ABy;
        const t = Math.max(0, Math.min(1, L2 === 0 ? 0 : ((w[0] - A[0]) * ABx + (w[1] - A[1]) * ABy) / L2));
        const Cx = A[0] + t * ABx, Cy = A[1] + t * ABy, d = Math.hypot(Cx - w[0], Cy - w[1]);
        seg.push(Math.sqrt(L2));
        if (d < dk) { dk = d; k = j; tk = t; }
      }
      if (k < 0 || dk > lim) continue;
      const pref = prefer && prefer[0] === key && prefer[1] === i;
      if (best && !pref && (best.pref || dk >= best.d)) continue;
      const A = Q[k], B = Q[k + 1];
      let pt = [A[0] + tk * (B[0] - A[0]), A[1] + tk * (B[1] - A[1])];
      let jv = -1, dv = Infinity;
      P.forEach((p, j) => { const d = Math.hypot(p[0] - w[0], p[1] - w[1]); if (d < dv) { dv = d; jv = j; } });
      if (dv * this.view.s <= 6) {
        pt = P[jv].slice();
        if (jv < Q.length - 1) { k = jv; tk = 0; } else { k = Q.length - 2; tk = 1; }
      }
      const cum = [0]; for (const s of seg) cum.push(cum[cum.length - 1] + s);
      best = { pref, pt, ring: [key, i], P, closed, pos: cum[k] + tk * seg[k], cum, d: dk, whole: cum[cum.length - 1] };
    }
    return best;
  }
  tracePath(h1, h2, longer) {
    const P = h1.P, cum = h1.cum, closed = h1.closed, L = h1.whole, s1 = h1.pos, s2 = h2.pos;
    const vpos = cum.slice(0, P.length);
    if (!closed) {
      if (s1 <= s2) return P.filter((p, i) => s1 < vpos[i] && vpos[i] < s2).map(p => p.slice());
      const out = [];
      for (let i = P.length - 1; i >= 0; i--) if (s2 < vpos[i] && vpos[i] < s1) out.push(P[i].slice());
      return out;
    }
    const mod = (a, b) => ((a % b) + b) % b;
    const fwdLen = mod(s2 - s1, L);
    let fwd = fwdLen <= L - fwdLen;
    if (longer) fwd = !fwd;
    const idx = P.map((p, i) => i);
    if (fwd) {
      const rel = vpos.map(v => mod(v - s1, L));
      return idx.filter(i => rel[i] > 0 && rel[i] < fwdLen).sort((a, b) => rel[a] - rel[b]).map(i => P[i].slice());
    }
    const rel = vpos.map(v => mod(s1 - v, L));
    return idx.filter(i => rel[i] > 0 && rel[i] < L - fwdLen).sort((a, b) => rel[a] - rel[b]).map(i => P[i].slice());
  }
  async drawClick(X, Y, opts = {}) {
    const d = this.draw;
    if (!d) return;
    const noSnap = this.noSnap || opts.alt;
    const longer = this.longer || opts.ctrl;
    if (d.whole) {
      d.whole = false;
      const c = this.featuresAt(X, Y);
      if (c.length) {
        let P = c[0].geom[0][0].map(p => p.slice());
        if (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
        d.pts = P; d.groups = [P.length]; d.last = null;
        this.app.status(`Prevzatý obrys ${c[0].layer} ${c[0].fid} (${P.length} vrch.) – uprav/pokračuj, ✔ = dokončiť.`);
      }
      this.app.onMapState(); this.request(); return;
    }
    const hit = (d.trace && !noSnap) ? this.traceHit(X, Y, this.app.touchUI ? 14 : 10, d.last && d.last.ring) : null;
    let pts;
    if (hit) {
      pts = [];
      if (d.last && d.last.ring[0] === hit.ring[0] && d.last.ring[1] === hit.ring[1] && d.pts.length) pts = this.tracePath(d.last, hit, longer);
      pts.push(hit.pt);
      d.last = hit;
      d.pts.push(...pts); d.groups.push(pts.length);
    } else {
      const w = this.c2w(X, Y);
      d.last = null;
      d.pts.push(w); d.groups.push(1);
      const idx = d.pts.length - 1;
      const sid = this.scanForSnap();
      if (!noSnap && sid && this.inkState === 'ok') {
        try {
          const r = await api('/api/ink/snap', { g: this.G.g, scan: sid, pts: [w], maxd: 10 / this.view.s }, { quiet: true });
          if (r.pts && r.pts[0] && this.draw === d && d.pts[idx] === w) d.pts[idx] = r.pts[0];
        } catch (e) { /* */ }
      }
    }
    this.app.onMapState();
    this.request();
  }
  addStroke(P) {
    const d = this.draw;
    if (!d || P.length < 2) return;
    const tol = Math.max(0.002, 1.5 / this.view.s);
    const Q = rdp(P, tol);
    d.pts.push(...Q); d.groups.push(Q.length); d.last = null;
    this.app.onMapState();
  }
  drawUndo() {
    const d = this.draw;
    if (d && d.pts.length) {
      const n = d.groups.length ? d.groups.pop() : 1;
      d.pts.splice(d.pts.length - n, n);
      d.last = null;
      this.app.onMapState(); this.request();
    }
  }

  // --- ukazovateľ (myš / prst / pero)
  _bind() {
    const cv = this.cv;
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e));
    cv.addEventListener('pointercancel', e => this.cancelPtr(e));
    cv.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') { this.hover = null; this.request(); } });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => this.wheel(e), { passive: false });
    cv.addEventListener('dblclick', e => { if (this.mode !== 'edit' && !this.pick) this.zoomAt(...this.xy(e), 1.6); });
  }
  xy(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  hitR(e) { return e.pointerType === 'touch' ? 20 : e.pointerType === 'pen' ? 13 : 9; }

  down(e) {
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    const [X, Y] = this.xy(e);
    if (e.pointerType === 'pen' && !this.penSeen) { this.penSeen = true; this.penOnly = true; this.app.onPenDetected(); }
    this.app.touchUI = e.pointerType !== 'mouse';
    this.pointers.set(e.pointerId, { X, Y, type: e.pointerType });
    if (e.pointerType === 'touch' && this.pointers.size >= 2) { this.startPinch(); return; }
    if (this.pointers.size > 1 && this.act && this.act.type !== 'pinch') return;
    const touchPan = e.pointerType === 'touch' && this.penOnly;
    const alt = (e.pointerType === 'pen' && (e.buttons & 2)) || e.button === 2;
    if (e.button === 1 || (e.pointerType === 'mouse' && e.button === 2 && !(this.mode === 'edit' && this.sel && this.hitVertex(X, Y, 10)))) {
      this.act = { type: 'pan', X, Y, sX: X, sY: Y, right: e.button === 2 }; return;
    }
    if (touchPan || !this.G || this.isProf() || this.isRaw() && !this.app.rawClick) {
      this.act = { type: 'tap', X, Y, sX: X, sY: Y, ptr: e.pointerType, touchPan, t: Date.now() }; return;
    }
    // laso (L / I)
    if (this.mode === 'pick') { this.act = { type: 'lasso', pts: [[X, Y]], sX: X, sY: Y }; return; }
    if (this.mode === 'move' && this.mv) {
      const e0 = this.mv;
      this.act = { type: 'movedr', X, Y, sX: X, sY: Y, rot: e0.rotMode || e.shiftKey, d0: { dx: e0.dx, dy: e0.dy, rot: e0.rot } };
      return;
    }
    if (this.mode === 'prop' && this.man && (this.man.mode === 'kresba') && (this.man.key)) {
      this.act = { type: 'mantap', X, Y, sX: X, sY: Y, ptr: e.pointerType, alt, stroke: null };
      return;
    }
    if (this.mode === 'edit' && this.draw) {
      this.act = { type: 'drawtap', X, Y, sX: X, sY: Y, ptr: e.pointerType, alt, ctrl: e.ctrlKey, stroke: null };
      return;
    }
    if (this.mode === 'edit' && this.sel) {
      const R = this.hitR(e);
      if (alt) { const h = this.hitVertex(X, Y, R); if (h) { this.deleteVertex(...h); this.act = { type: 'none' }; return; } }
      if ((this.moveWhole || e.shiftKey) && this.onSel(X, Y)) {
        this.pushUndo(); this.act = { type: 'move', X, Y }; return;
      }
      const hv = this.hitVertex(X, Y, R);
      if (hv && !e.ctrlKey) {
        this.act = { type: 'vertex', ri: hv[0], vi: hv[1], moved: false, sX: X, sY: Y };
        this.act.lp = setTimeout(() => {
          if (this.act && this.act.type === 'vertex' && !this.act.moved) {
            this.deleteVertex(this.act.ri, this.act.vi); this.act = { type: 'none' };
            if (navigator.vibrate) navigator.vibrate(30);
          }
        }, 650);
        this.request(); return;
      }
      const hm = this.hitMid(X, Y, R);
      const he = e.ctrlKey ? this.hitEdge(X, Y, R) : null;
      if (hm || he) {
        const [ri, i] = hm || he;
        this.pushUndo();
        this.sel.rings[ri].pts.splice(i + 1, 0, this.c2w(X, Y));
        this.act = { type: 'vertex', ri, vi: i + 1, moved: true, sX: X, sY: Y };
        this.request(); return;
      }
    }
    this.act = { type: 'tap', X, Y, sX: X, sY: Y, ptr: e.pointerType, t: Date.now() };
  }
  move(e) {
    const [X, Y] = this.xy(e);
    this.hover = { X, Y, inside: true };
    const p = this.pointers.get(e.pointerId);
    if (p) { p.X = X; p.Y = Y; }
    const a = this.act;
    if (!a) { if (this.draw || e.pointerType !== 'touch') this.request(); return; }
    if (a.type === 'pinch') { this.pinchMove(); return; }
    if (a.type === 'pan') { this.panBy(X - a.X, Y - a.Y); a.X = X; a.Y = Y; return; }
    if (a.type === 'tap') {
      if (Math.abs(X - a.sX) + Math.abs(Y - a.sY) > 7) { a.type = 'pan'; a.X = a.sX; a.Y = a.sY; this.move(e); }
      return;
    }
    if (a.type === 'lasso') {
      const L = a.pts[a.pts.length - 1];
      if (Math.abs(L[0] - X) + Math.abs(L[1] - Y) >= 3) { a.pts.push([X, Y]); this.request(); }
      return;
    }
    if (a.type === 'drawtap') {
      if (!a.stroke && Math.abs(X - a.sX) + Math.abs(Y - a.sY) > 8) {
        if (a.ptr === 'mouse' || this.app.drawByTap) { a.type = 'pan'; a.X = a.sX; a.Y = a.sY; this.move(e); return; }
        a.stroke = [this.c2w(a.sX, a.sY)];
      }
      if (a.stroke) {
        const w = this.c2w(X, Y), L = a.stroke[a.stroke.length - 1];
        if (Math.hypot(w[0] - L[0], w[1] - L[1]) * this.view.s >= 2) a.stroke.push(w);
        this.draw.stroke = a.stroke;
        this.request();
      }
      return;
    }
    if (a.type === 'vertex') {
      if (!a.moved) {
        if (Math.abs(X - a.sX) + Math.abs(Y - a.sY) < 3) return;
        this.pushUndo(); a.moved = true;
      }
      clearTimeout(a.lp);
      this.sel.rings[a.ri].pts[a.vi] = this.c2w(X, Y);
      this.request(); return;
    }
    if (a.type === 'movedr') {
      const ed = this.mv, s = this.view.s;
      if (a.rot) {
        const [cX, cY] = this.w2c(ed.cx + a.d0.dx, ed.cy + a.d0.dy);
        const a0 = Math.atan2(-(a.sY - cY), a.sX - cX), a1 = Math.atan2(-(Y - cY), X - cX);
        ed.rot = a.d0.rot + (a1 - a0) * 180 / Math.PI;
      } else { ed.dx = a.d0.dx + (X - a.sX) / s; ed.dy = a.d0.dy - (Y - a.sY) / s; }
      this.app.onMapState(); this.request(); return;
    }
    if (a.type === 'mantap') {
      if (!a.stroke && Math.abs(X - a.sX) + Math.abs(Y - a.sY) > 8) {
        if (a.ptr === 'mouse') { a.type = 'pan'; a.X = a.sX; a.Y = a.sY; this.move(e); return; }
        a.stroke = [this.c2w(a.sX, a.sY)];
      }
      if (a.stroke) {
        const w = this.c2w(X, Y), L = a.stroke[a.stroke.length - 1];
        if (Math.hypot(w[0] - L[0], w[1] - L[1]) * this.view.s >= 2) a.stroke.push(w);
        this.man.stroke = a.stroke; this.request();
      }
      return;
    }
    if (a.type === 'move') {
      const s = this.view.s, dx = (X - a.X) / s, dy = -(Y - a.Y) / s;
      for (const r of this.sel.rings) r.pts = r.pts.map(([x, y]) => [x + dx, y + dy]);
      a.X = X; a.Y = Y; this.sel.dirty = true; this.request();
    }
  }
  up(e) {
    const [X, Y] = this.xy(e);
    this.pointers.delete(e.pointerId);
    const a = this.act;
    if (a && a.type === 'pinch') { if (this.pointers.size < 2) this.act = this.pointers.size ? { type: 'none' } : null; return; }
    if (this.pointers.size) return;
    this.act = null;
    if (e.pointerType === 'touch') this.hover = null;
    if (!a) return;
    if (a.lp) clearTimeout(a.lp);
    if (a.type === 'pan' && a.right && Math.abs(X - a.sX) + Math.abs(Y - a.sY) < 4) {
      if (this.mode === 'edit' && this.sel) { const h = this.hitVertex(X, Y, 10); if (h) this.deleteVertex(...h); }
      return;
    }
    if (a.type === 'tap' && this.view && this.view.r) {
      const [cX, cY] = this.compassXY();
      if (Math.hypot(X - cX, Y - cY) < 24) { this.resetRotation(); this.app.onRotate && this.app.onRotate(); return; }
    }
    if (a.type === 'tap' && this.isProf()) { return; }
    if (a.type === 'tap' && a.touchPan && this.mode === 'edit' && this.draw) {     // len pero kreslí – prstom dvojťuk = dokončiť
      const now = Date.now(), lt = this._lastFingerTap;
      this._lastFingerTap = { t: now, X, Y };
      if (lt && now - lt.t < 400 && Math.hypot(X - lt.X, Y - lt.Y) < 30 && this.draw.pts.length >= (this.draw.typ === 'polygon' ? 3 : 2)) { this._lastFingerTap = null; this.app.drawFinish(); }
      return;
    }
    if (a.type === 'tap') {
      if (a.touchPan && this.mode === 'view' || this.isRaw()) { if (!this.isRaw()) this.tapView(X, Y); return; }
      if (a.touchPan) return;
      if (this.mode === 'edit') this.tapEdit(X, Y);
      else if (this.mode === 'view') this.tapView(X, Y);
      else if (this.mode === 'prop') this.app.propTap(X, Y, { alt: e.shiftKey || (e.pointerType === 'pen' && (e.buttons & 2)) });
      return;
    }
    if (a.type === 'drawtap') {
      if (a.stroke && a.stroke.length > 1) { this.addStroke(a.stroke); this.draw && (this.draw.stroke = null); this.request(); this._lastDrawTap = null; }
      else {
        const now = Date.now(), lt = this._lastDrawTap;
        const dbl = lt && now - lt.t < 400 && Math.hypot(X - lt.X, Y - lt.Y) < (a.ptr === 'mouse' ? 8 : 24);
        this._lastDrawTap = dbl ? null : { t: now, X, Y };
        if (dbl && this.draw && this.draw.pts.length >= (this.draw.typ === 'polygon' ? 3 : 2)) { this.app.drawFinish(); return; }   // dvojťuk = dokončiť
        this.drawClick(X, Y, { alt: a.alt, ctrl: a.ctrl });
      }
      return;
    }
    if (a.type === 'lasso') { this.finishLasso(a.pts, X, Y); return; }
    if (a.type === 'movedr') { this.app.onMapState(); return; }
    if (a.type === 'mantap') {
      if (a.stroke && a.stroke.length > 1) { const Q = rdp(a.stroke, Math.max(0.002, 1.5 / this.view.s)); this.man.stroke = null; this.app.manStroke(Q); }
      else this.app.manClick(X, Y, { alt: a.alt });
      return;
    }
    if (a.type === 'vertex' || a.type === 'move') { this.app.onMapState(); this.request(); }
  }
  cancelPtr(e) {
    this.pointers.delete(e.pointerId);
    if (this.act && this.act.lp) clearTimeout(this.act.lp);
    if (this.act && this.act.type !== 'pinch') this.act = null;
    if (!this.pointers.size) this.act = null;
  }
  startPinch() {
    const a = this.act;
    if (a && a.type === 'vertex' && a.moved) { this.undo(); }
    if (a && a.type === 'move') { this.undo(); }
    if (a && a.lp) clearTimeout(a.lp);
    if (this.draw) this.draw.stroke = null;
    const P = [...this.pointers.values()].slice(0, 2);
    this.act = { type: 'pinch', d0: Math.hypot(P[0].X - P[1].X, P[0].Y - P[1].Y), m0: [(P[0].X + P[1].X) / 2, (P[0].Y + P[1].Y) / 2],
      a0: Math.atan2(P[1].Y - P[0].Y, P[1].X - P[0].X), rotOn: false, rotAcc: 0 };
    this.request();
  }
  pinchMove() {
    const a = this.act, P = [...this.pointers.values()].slice(0, 2);
    if (P.length < 2) return;
    const d = Math.hypot(P[0].X - P[1].X, P[0].Y - P[1].Y), m = [(P[0].X + P[1].X) / 2, (P[0].Y + P[1].Y) / 2];
    this.panBy(m[0] - a.m0[0], m[1] - a.m0[1]);
    if (a.d0 > 10) this.zoomAt(m[0], m[1], d / a.d0);
    const ang = Math.atan2(P[1].Y - P[0].Y, P[1].X - P[0].X);
    let da = ang - a.a0; da = Math.atan2(Math.sin(da), Math.cos(da));
    a.a0 = ang;
    if (this.app.rotLock) { a.d0 = d; a.m0 = m; return; }
    if (!a.rotOn) { a.rotAcc += da; if (Math.abs(a.rotAcc) > 0.12) { a.rotOn = true; da = a.rotAcc; } else da = 0; }   // ~7° kým sa rotácia zapne
    if (da) {
      this.rotateAt(m[0], m[1], da);
      const r = this.view.r;
      if (Math.abs(r) < 0.035 && Math.abs(r - da) >= 0.035) this.rotateAt(m[0], m[1], -r);      // prichytenie na sever
      this.app.onRotate && this.app.onRotate();
    }
    a.d0 = d; a.m0 = m;
  }
  wheel(e) {
    e.preventDefault();
    const [X, Y] = this.xy(e);
    const up = e.deltaY < 0;
    if (this.mode === 'edit' && this.sel && e.shiftKey && !e.ctrlKey) { this.transformSel(up ? 1.02 : 1 / 1.02); return; }
    if (this.mode === 'edit' && this.sel && e.altKey) { this.transformSel(1, up ? 1 : -1); return; }
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
    this.zoomAt(X, Y, Math.max(0.5, Math.min(2, f)));
  }
  tapEdit(X, Y) {
    const ft = this.pickCycle(X, Y);
    if (!ft) {
      if (this.activeLayer) {
        const oth = this.featuresAt(X, Y, { anyLayer: true });
        if (oth.length) { this.app.status(`Upravuje sa len vrstva ${this.activeLayer} – prvok ${oth[0].layer} je mimo nej (zmeň vrstvu v paneli Vrstvy).`); return; }
      }
      const hid = this.featuresAt(X, Y, { edgeOnly: true, all: true }).filter(f => !this.canEdit(f));
      if (hid.length) this.app.status(`Hornú hranu (KHH) možno upravovať len v DR ${this.G.real_drs[0]}, dno (KHD) len v DR dna ${this.G.dno_dr} (tlačidlo „▼ dno sem“).`);
      return;
    }
    if (this.sel && this.sel.dirty && this.sel.key !== ft.k) {
      this.app.askDiscard().then(ok => { if (ok) this.select(ft); });
      return;
    }
    this.select(ft);
  }
  tapView(X, Y) {
    const ft = this.pickCycle(X, Y);
    this.app.showFeatureCard(ft, X, Y);
  }
  finishLasso(P, X, Y) {
    const kind = this.pick && this.pick.kind;
    const okFt = kind === 'dr' ? (f => f.has_dr) : (() => true);
    let sel;
    if (P.length < 3 || Math.max(...P.map(([x, y]) => Math.abs(x - P[0][0]) + Math.abs(y - P[0][1]))) < 10) {
      sel = this.featuresAt(X, Y).filter(okFt).slice(0, 1);
      if (!sel.length) { this.app.status('Pod kurzorom nie je prvok' + (kind === 'dr' ? ' s poľom DR.' : '.')); this.request(); return; }
    } else {
      const W = P.map(([x, y]) => this.c2w(x, y));
      sel = this.visFeats.filter(ft => {
        if (!okFt(ft)) return false;
        const V = [].concat(...this.ftGeom(ft)[0].map(p => p[0]));
        const inside = V.filter(([x, y]) => insidePoly(x, y, W)).length;
        return inside >= Math.max(1, 0.6 * V.length);
      });
      if (!sel.length) { this.app.status('V lase nie je žiadny prvok (aspoň 60 % prvku musí byť vnútri).'); this.request(); return; }
    }
    this.request();
    this.app.onPicked(kind, sel);
  }
}

function mean(P) {
  let x = 0, y = 0;
  for (const p of P) { x += p[0]; y += p[1]; }
  return [x / P.length, y / P.length];
}
