// v3d.js – 3D okno hrobu (scéna z hrob_3d.Model na serveri, kreslenie maliarovým algoritmom ako v Tk okne)
import { el, api, toast } from './ui.js';

export async function open3d(app) {
  const root = el('div', { class: 'screen' });
  const top = el('div', { class: 'screen-top' });
  const body = el('div', { class: 'screen-body' });
  root.append(top, body);
  document.body.append(root);
  const pane = el('div', { class: 'pane' });
  const cv = el('canvas');
  pane.append(cv);
  const side = el('div', { class: 'side' });
  body.append(pane, side);
  const st = { az: -35, el: 30, zoom: 1, pan: [0, 0], zex: 1, alpha: 1, vis: {}, hidden: new Set(), sel: null, M: null, follow: true, fast: false };
  const ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, P = null, drawn = [];
  const title = el('span', { class: 't' }, '3D hrobu');
  const B = (t, fn, ti) => el('button', { class: 'tool', title: ti || '', onclick: fn }, t);
  const fl = el('input', { type: 'checkbox' }); fl.checked = true; fl.onchange = () => (st.follow = fl.checked);
  top.append(title, el('label', { class: 'tool' }, fl, 'sledovať hrob'), B('↻ Obnoviť', () => load(), 'F5'),
    B('1 zhora', () => view(0, 90)), B('2 z juhu', () => view(0, 5)), B('3 zo západu', () => view(-90, 5)), B('4 izometria', () => view(-35, 30)),
    B('⬇ PNG', () => savePng()), el('span', { class: 'spacer' }), B('✕ Zavrieť', () => close(), 'Esc'));
  const info = el('div', { class: 'pre small', style: { background: '#f2f2ee', borderRadius: '8px', padding: '8px', marginTop: '8px' } });
  const groupsBox = el('div');
  const ctxBox = el('div', { class: 'ctxlist' });
  const zex = el('input', { type: 'range', min: 1, max: 5, step: 0.1, value: 1 });
  zex.oninput = () => { st.zex = +zex.value; redraw(); };
  const alpha = el('input', { type: 'range', min: 0.15, max: 1.6, step: 0.05, value: 1 });
  alpha.oninput = () => { st.alpha = +alpha.value; redraw(); };
  side.append(el('h4', {}, 'Zobraziť'), groupsBox, el('h4', {}, 'Prevýšenie Z'), zex, el('h4', {}, 'Krytie kontextov'), alpha,
    el('h4', {}, 'Kontexty (ťuk = skryť, dvojťuk = len tento)'), ctxBox, info);
  const onKey = e => {
    if (document.querySelector('.modal-back')) return;
    const k = e.key;
    if (k === 'Escape') close();
    else if (k === '1') view(0, 90); else if (k === '2') view(0, 5); else if (k === '3') view(-90, 5); else if (k === '4') view(-35, 30);
    else if (k === 'r' || k === 'R') reset();
    else if (k === 'F5') { e.preventDefault(); load(); }
    else if (k === 'ArrowLeft') rot(-10, 0); else if (k === 'ArrowRight') rot(10, 0);
    else if (k === 'ArrowUp') rot(0, 8); else if (k === 'ArrowDown') rot(0, -8);
    else if (k === '+') { st.zex = Math.min(5, st.zex + 0.5); zex.value = st.zex; redraw(); }
    else if (k === '-') { st.zex = Math.max(1, st.zex - 0.5); zex.value = st.zex; redraw(); }
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  const prevHook = app.onGraveChanged;
  app.onGraveChanged = g => { if (prevHook) prevHook(g); if (st.follow && st.M && st.M.g !== g) load(); };
  function close() { root.remove(); document.removeEventListener('keydown', onKey, true); app.onGraveChanged = prevHook; }
  function reset() { st.az = -35; st.el = 30; st.zoom = 1; st.pan = [0, 0]; redraw(); }
  function view(a, e) { st.az = a; st.el = e; redraw(); }
  function rot(da, de) { st.az = (st.az + da) % 360; st.el = Math.max(-89, Math.min(90, st.el + de)); redraw(); }

  async function load() {
    info.textContent = 'Načítavam scénu…';
    let M;
    try { M = await api('/api/scene3d?g=' + encodeURIComponent(app.G.g)); } catch (e) { info.textContent = e.message; return; }
    st.M = M;
    title.textContent = '3D – hrob ' + M.g;
    // stredy prvkov (na triedenie podľa hĺbky)
    M.C = M.items.map(it => { let x = 0, y = 0, z = 0; for (const i of it.i) { x += M.V[i][0]; y += M.V[i][1]; z += M.V[i][2]; } const n = it.i.length || 1; return [x / n, y / n, z / n]; });
    if (!Object.keys(st.vis).length) for (const [k, , v] of M.groups) st.vis[k] = v;
    groupsBox.innerHTML = '';
    for (const [k, t] of M.groups) {
      const c = el('input', { type: 'checkbox' }); c.checked = st.vis[k];
      c.onchange = () => { st.vis[k] = c.checked; redraw(); };
      groupsBox.append(el('label', {}, c, t));
    }
    st.hidden = new Set(); st.sel = null;
    renderCtx();
    info.textContent = M.info;
    redraw();
  }
  function renderCtx() {
    ctxBox.innerHTML = '';
    const all = st.M.ctx.map(c => c.id);
    let lastTap = 0;
    for (const c of st.M.ctx) {
      const it = el('div', { class: 'it' + (st.hidden.has(c.id) ? ' off' : '') },
        el('span', { class: 'sw', style: { background: `rgb(${c.rgb.join(',')})` } }), el('b', {}, c.name), el('span', { class: 'small' }, ' ' + c.dr));
      it.onclick = () => {
        const now = Date.now();
        if (now - lastTap < 350 && it._last) {
          const others = all.filter(x => x !== c.id);
          const only = st.hidden.size === others.length && others.every(x => st.hidden.has(x));
          st.hidden = only ? new Set() : new Set(others);
        } else { st.hidden.has(c.id) ? st.hidden.delete(c.id) : st.hidden.add(c.id); }
        it._last = true; lastTap = now;
        renderCtx(); redraw();
      };
      ctxBox.append(it);
    }
  }
  function basis() {
    const a = st.az * Math.PI / 180, e = st.el * Math.PI / 180;
    const f = [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)];
    const r = [Math.cos(a), Math.sin(a), 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    return [r, u, f];
  }
  function scale() {
    const M = st.M;
    const ext = Math.max(M.hi[0] - M.lo[0], M.hi[1] - M.lo[1], (M.hi[2] - M.lo[2]) * st.zex, 0.5);
    return 0.8 * Math.min(W, H) / ext * st.zoom;
  }
  function visible(it) {
    const g = it.g;
    if (['ctx', 'rakva', 'loft', 'popisy'].includes(g) && st.hidden.has(it.o)) return false;
    if (g === 'popisy' || g === 'loft') {
      const og = it.o !== undefined ? st.M.objs[it.o].grp : null;
      return st.vis[g] && (!(og in st.vis) || st.vis[og]);
    }
    if (g === 'profily_gdb' && !st.vis.profily) return false;
    return g in st.vis ? st.vis[g] : true;
  }
  let job = null;
  function redraw() { if (job) return; job = requestAnimationFrame(() => { job = null; render(); }); }
  function render() {
    const r = pane.getBoundingClientRect();
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fafaf7'; ctx.fillRect(0, 0, W, H);
    const M = st.M;
    if (!M || !M.V.length) { ctx.fillStyle = '#555'; ctx.font = '14px system-ui'; ctx.fillText(M ? 'Žiadne vektory na zobrazenie.' : '', 20, 30); return; }
    const [rr, u, f] = basis();
    const c = [(M.lo[0] + M.hi[0]) / 2, (M.lo[1] + M.hi[1]) / 2, (M.lo[2] + M.hi[2]) / 2];
    const s = scale(), ze = st.zex;
    P = M.V.map(v => {
      const x = v[0] - c[0], y = v[1] - c[1], z = (v[2] - c[2]) * ze;
      return [W / 2 + s * (x * rr[0] + y * rr[1] + z * rr[2]) + st.pan[0], H / 2 - s * (x * u[0] + y * u[1] + z * u[2]) + st.pan[1]];
    });
    const depth = M.C.map(v => (v[0] - c[0]) * f[0] + (v[1] - c[1]) * f[1] + (v[2] - c[2]) * ze * f[2]);
    const order = depth.map((d, i) => i).sort((a, b) => depth[a] - depth[b]);
    const texts = [];
    drawn = [];
    for (const i of order) {
      const it = M.items[i];
      if (!visible(it)) continue;
      const sel = st.sel !== null && it.o === st.sel;
      const Q = it.i.map(k => P[k]);
      if (it.t === 'f') {
        let a = it.a;
        if (['ctx', 'rakva', 'loft'].includes(it.g)) a = Math.max(10, Math.min(255, a * st.alpha));
        ctx.beginPath(); Q.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        ctx.fillStyle = `rgba(${it.c[0]},${it.c[1]},${it.c[2]},${a / 255})`; ctx.fill();
        if (sel) { ctx.strokeStyle = '#ff00a0'; ctx.lineWidth = 1; ctx.stroke(); }
        else if (it.out && !st.fast) { ctx.strokeStyle = `rgba(${it.out[0]},${it.out[1]},${it.out[2]},0.86)`; ctx.lineWidth = 1; ctx.stroke(); }
        drawn.push(i);
      } else if (it.t === 'l') {
        ctx.strokeStyle = sel ? '#ff00a0' : `rgb(${it.c.join(',')})`; ctx.lineWidth = it.w || 1;
        ctx.setLineDash(it.dash && !st.fast ? [8, 5] : []);
        ctx.beginPath(); Q.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
        drawn.push(i);
      } else if (it.t === 'p') {
        const rad = (it.r || 3) + (sel ? 2 : 0);
        ctx.fillStyle = `rgb(${it.c.join(',')})`; ctx.beginPath(); ctx.arc(Q[0][0], Q[0][1], rad, 0, 7); ctx.fill();
        drawn.push(i);
      } else if (it.t === 'x' && !st.fast) texts.push([Q[0], it]);
    }
    for (const [[x, y], it] of texts) {
      ctx.font = it.bold ? 'bold 13px system-ui' : '11px system-ui';
      ctx.textAlign = it.bold ? 'center' : 'left'; ctx.textBaseline = 'middle';
      if (it.bold) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(it.text, x, y); }
      ctx.fillStyle = `rgb(${(it.c || [0, 0, 0]).join(',')})`; ctx.fillText(it.text, x, y);
    }
    // kompas a mierka
    const cx = 50, cy = H - 50;
    for (const [vec, lab, col] of [[[0, 1, 0], 'S', '#c80000'], [[1, 0, 0], 'V', '#3c3c3c'], [[0, 0, 1], 'Z↑', '#005ac8']]) {
      const x = cx + 30 * (vec[0] * rr[0] + vec[1] * rr[1] + vec[2] * rr[2]), y = cy - 30 * (vec[0] * u[0] + vec[1] * u[1] + vec[2] * u[2]);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = col; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(lab, x, y);
    }
    const L = 0.5 * s;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(W - 30 - L, H - 30); ctx.lineTo(W - 30, H - 30); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('50 cm', W - 30 - L / 2, H - 42);
    if (ze > 1) { ctx.fillStyle = '#5a5a5a'; ctx.fillText(`prevýšenie Z ×${ze.toFixed(1)}`, W - 30 - L / 2, H - 16); }
  }
  function inside(x, y, Q) {
    let c = false;
    for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) {
      if ((Q[i][1] > y) !== (Q[j][1] > y) && x < (Q[j][0] - Q[i][0]) * (y - Q[i][1]) / ((Q[j][1] - Q[i][1]) || 1e-12) + Q[i][0]) c = !c;
    }
    return c;
  }
  function nearLine(x, y, Q, tol) {
    for (let i = 0; i < Q.length - 1; i++) {
      const [ax, ay] = Q[i], [bx, by] = Q[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= tol) return true;
    }
    return false;
  }
  function pick(x, y) {
    const M = st.M;
    if (!M || !P) return;
    let hit = null, fb = null;
    for (let k = drawn.length - 1; k >= 0; k--) {
      const it = M.items[drawn[k]];
      const Q = it.i.map(i => P[i]);
      const ok = (it.t === 'f' && inside(x, y, Q)) || (it.t === 'p' && Math.hypot(Q[0][0] - x, Q[0][1] - y) <= 8) || (it.t === 'l' && nearLine(x, y, Q, 5));
      if (!ok) continue;
      if (it.g === 'urovne' || it.g === 'jama') { fb = fb || it; continue; }
      hit = it; break;
    }
    hit = hit || fb;
    if (!hit || hit.o === undefined) { st.sel = null; info.textContent = M.info; redraw(); return; }
    const o = M.objs[hit.o];
    st.sel = o.id;
    let t = `${o.name}\n${o.info || ''}`;
    if (o.attrs) t += '\n' + Object.entries(o.attrs).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
    info.textContent = t;
    redraw();
  }
  // ovládanie: 1 prst / ľavé = otáčanie, 2 prsty = posun + zoom, pravé / stredné = posun, koliesko = zoom
  const ptr = new Map();
  let act = null;
  cv.style.touchAction = 'none';
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
    ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptr.size === 2) { const Q = [...ptr.values()]; act = { t: 'pinch', d: Math.hypot(Q[0][0] - Q[1][0], Q[0][1] - Q[1][1]), m: [(Q[0][0] + Q[1][0]) / 2, (Q[0][1] + Q[1][1]) / 2] }; return; }
    act = { t: e.button === 0 ? 'rot' : 'pan', x: e.offsetX, y: e.offsetY, sx: e.offsetX, sy: e.offsetY };
  });
  cv.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId) || !act) return;
    ptr.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (act.t === 'pinch') {
      const Q = [...ptr.values()]; if (Q.length < 2) return;
      const d = Math.hypot(Q[0][0] - Q[1][0], Q[0][1] - Q[1][1]), m = [(Q[0][0] + Q[1][0]) / 2, (Q[0][1] + Q[1][1]) / 2];
      st.pan = [st.pan[0] + m[0] - act.m[0], st.pan[1] + m[1] - act.m[1]];
      if (act.d > 10) st.zoom = Math.max(0.1, Math.min(40, st.zoom * d / act.d));
      act.d = d; act.m = m; st.fast = true; redraw(); return;
    }
    const dx = e.offsetX - act.x, dy = e.offsetY - act.y;
    if (act.t === 'rot') { st.az = (st.az - dx * 0.5) % 360; st.el = Math.max(-89, Math.min(90, st.el + dy * 0.4)); }
    else st.pan = [st.pan[0] + dx, st.pan[1] + dy];
    act.x = e.offsetX; act.y = e.offsetY; st.fast = true; redraw();
  });
  cv.addEventListener('pointerup', e => {
    ptr.delete(e.pointerId);
    if (ptr.size) return;
    if (act && act.t === 'rot' && Math.abs(e.offsetX - act.sx) + Math.abs(e.offsetY - act.sy) < 5) pick(e.offsetX, e.offsetY);
    act = null; st.fast = false; redraw();
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); st.zoom = Math.max(0.1, Math.min(40, st.zoom * Math.exp(-e.deltaY * 0.0015))); redraw(); }, { passive: false });
  new ResizeObserver(() => redraw()).observe(pane);
  function savePng() {
    cv.toBlob(b => {
      const a = el('a', { href: URL.createObjectURL(b), download: `hrob_${st.M ? st.M.g : ''}_3d.png` });
      document.body.append(a); a.click(); a.remove();
      toast('Obrázok uložený do Stiahnutých súborov.', 'ok');
    });
  }
  load();
}
