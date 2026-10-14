// app.js – katalóg hrobov vo webovom prehliadači (PC aj tablet s perom)
import { connect, logout } from './auth.js';
import { el, api, CONN, toast, modal, confirmBox, promptBox, runJob, followJob, infoBox, drKey, drsOf } from './ui.js';
import { MapView, transformPts, insidePoly } from './map.js';

const $ = id => document.getElementById(id);
const NEZ = '?', REZY = 'rezy', NEVYUZ = 'nevyuzite';
const DRLAB = { '?': 'bez DR', rezy: 'rezy', nevyuzite: 'nevyužité' };
const isSpecDr = dr => !dr || dr === NEZ || dr === REZY || dr === NEVYUZ;

class App {
  constructor() {
    this.graves = [];
    this.G = null;
    this.dr = null;
    this.si = 0;
    this.version = 0;
    this.noteT = Date.now() / 1000 - 5;
    this.touchUI = matchMedia('(pointer: coarse)').matches;
    this.traceOn = true;
    this.lsGet = k => { try { return JSON.parse(localStorage.getItem('kw_' + k)); } catch (e) { return null; } };
    this.lsSet = (k, v) => { try { localStorage.setItem('kw_' + k, JSON.stringify(v)); } catch (e) { /* */ } };
    this.map = new MapView($('map'), this);
    const pv = this.lsGet('view') || {};
    { const dt = this.lsGet('drawByTap'); this.drawByTap = dt === null || dt === undefined ? true : !!dt; }
    Object.assign(this.map, { vmode: pv.vmode || 'dr', pmode: pv.pmode || 'on', ctxFill: pv.ctxFill !== false });
    if (pv.penOnly) { this.map.penOnly = true; this.map.penSeen = true; }
    this.wide = () => window.innerWidth > 1180;
    if (!this.wide()) $('left').classList.add('closed');
    if (window.innerWidth < 900) $('right').classList.add('closed');
    this.map.hidden = new Set(this.lsGet('hiddenLayers') || []);
    this.map.activeLayer = this.lsGet('activeLayer') || null;
    if (this.lsGet('leftClosed') && this.wide()) $('left').classList.add('closed');
    if (this.lsGet('rightClosed') && window.innerWidth >= 900) $('right').classList.add('closed');
    this.bindTop();
    this.renderViewTools();
    this.bindKeys();
    this.poll();
  }

  // ------------------------------------------------------------------ stav servera
  async poll() {
    let first = true;
    for (;;) {
      try {
        const st = await api('/api/state?since=' + this.noteT + (first || !this.graves.length ? '&list=1' : ''), undefined, { quiet: true });
        this.serverStatus = st.status;
        if (!this.statusLock) $('status').textContent = st.status;
        for (const n of st.notes || []) {
          this.noteT = Math.max(this.noteT, n.t);
          if (n.kind === 'info' && n.text.length > 160) infoBox(n.title || 'Katalóg', n.text);
          else toast((n.title ? n.title + ': ' : '') + n.text, n.kind === 'error' ? 'error' : n.kind === 'warn' ? 'warn' : 'info', 7000);
        }
        if (st.error) { $('loadtxt').textContent = 'Chyba pri načítaní: ' + st.error.split('\n')[0]; $('loading').classList.remove('hidden'); }
        else if (st.loading || !st.graves && !this.graves.length) { $('loadtxt').textContent = st.status; $('loading').classList.remove('hidden'); }
        else $('loading').classList.add('hidden');
        if (st.graves) {
          this.graves = st.graves;
          this.cfg = st.cfg;
          this.layers = st.layers;
          this.map.hlUnsaved = !!st.cfg.zvyraznit_neulozene;
          this.renderList();
          if (!this.G) this.showGrave(this.lsGet('grave') || st.cfg.hrob || (st.graves[0] && st.graves[0].g));
          first = false;
        }
        if (st.version !== this.version && this.G && !st.loading) {
          const busy = (this.map.sel && this.map.sel.dirty) || this.map.draw;
          if (!busy) { this.version = st.version; this.refreshGrave(true); this.refreshList(); }
        }
      } catch (e) {
        $('status').textContent = e.message;
      }
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  status(t) {
    $('status').textContent = t;
    this.statusLock = true;
    clearTimeout(this._stT);
    this._stT = setTimeout(() => (this.statusLock = false), 6000);
  }
  async refreshList() {
    const st = await api('/api/state?list=1&since=' + this.noteT, undefined, { quiet: true });
    if (st.graves) { this.graves = st.graves; this.renderList(); }
  }

  // ------------------------------------------------------------------ zoznam hrobov
  visibleGraves() {
    const f = $('filter').value, q = $('search').value.trim().toLowerCase();
    return this.graves.filter(r => {
      if (q && !r.g.toLowerCase().includes(q) && !r.g.toLowerCase().replace(/^[a-z]+/, '').startsWith(q)) return false;
      if (f === 'chýba georeferencia' && !(r.bez || r.mimo)) return false;
      if (f === 'bez skenov' && r.plans) return false;
      if (f === 'skeny mimo hrobu' && !r.mimo) return false;
      if (f === 's bodmi z merania' && !r.pts) return false;
      if (f === 'nezhody (návrhy W)' && !r.nezhody) return false;
      if (f === 'hotové' && !r.done) return false;
      if (f === 'nehotové' && r.done) return false;
      return true;
    });
  }
  renderList() {
    const box = $('glist');
    box.innerHTML = '';
    box.append(el('div', { class: 'grow ghead' }, el('span', { style: { textAlign: 'left' } }, 'Hrob'), el('span', {}, 'DR'), el('span', {}, 'skeny ✓/pl.')));
    for (const r of this.visibleGraves()) {
      const row = el('div', { class: `grow ${r.tag}${this.G && r.g === this.G.g ? ' cur' : ''}`, 'data-g': r.g, onclick: () => {
        this.showGrave(r.g); if (!this.wide()) $('left').classList.add('closed');
      } }, el('b', {}, (r.done ? '✔ ' : '') + r.g), el('span', {}, r.ndone && !r.done ? `${r.ndone}/${r.ndr}` : r.ndr),
      el('span', {}, `${r.ok}/${r.plans}`));
      box.append(row);
    }
    const cur = box.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  stepGrave(d) {
    const ids = this.visibleGraves().map(r => r.g);
    const L = ids.length ? ids : this.graves.map(r => r.g);
    if (!L.length) return;
    const i = this.G && L.includes(this.G.g) ? L.indexOf(this.G.g) + d : 0;
    this.showGrave(L[(i + L.length) % L.length]);
  }

  // ------------------------------------------------------------------ hrob / DR / sken
  async showGrave(g, dr = null, keep = false) {
    if (!g) return;
    if (!keep && this.map.sel && this.map.sel.dirty && !(await this.askDiscard())) return;
    let G;
    try { G = await api('/api/grave?g=' + encodeURIComponent(g)); } catch (e) { return; }
    const changed = !this.G || this.G.g !== G.g;
    this.G = G;
    this.version = Math.max(this.version, G.version);
    this.lsSet('grave', g);
    const drs = G.drs.map(d => d.dr);
    if (dr && drs.includes(dr)) this.dr = dr;
    else if (!keep || !drs.includes(this.dr)) {
      const withScan = G.drs.find(d => d.scans.length);
      this.dr = withScan ? withScan.dr : (drs[0] || null);
      this.si = 0;
    }
    if (changed) { this.si = 0; this.map.setMode(['pick', 'move', 'prop'].includes(this.map.mode) ? 'view' : this.map.mode); this.hideCard(); }
    this.map.setGrave(G, keep && !changed);
    this.updateScan();
    this.renderInfo();
    this.renderList();
    $('b-grave').textContent = G.g + (G.done ? ' ✔' : '');
    if (this.onGraveChanged) this.onGraveChanged(G.g);
  }
  refreshGrave(keep = true) { if (this.G) return this.showGrave(this.G.g, this.dr, keep); }
  drInfo() { return this.G ? this.G.drs.find(d => d.dr === this.dr) : null; }
  curScans() { const d = this.drInfo(); return d ? d.scans.map(id => this.G.scans[id]).filter(Boolean) : []; }
  curScan() { const L = this.curScans(); return L.length ? L[((this.si % L.length) + L.length) % L.length] : null; }
  setDr(dr) {
    if (dr !== this.dr && (this.map.mode === 'move' || (this.map.mode === 'prop' && this.map.prop && this.map.prop.dr !== dr))) this.map.setMode('view');
    this.dr = dr; this.si = 0;
    if (this.map.draw) this.onMapState();
    this.updateScan();
  }
  stepDr(d) {
    if (!this.G || !this.G.drs.length) return;
    const drs = this.G.drs.map(x => x.dr);
    const i = drs.includes(this.dr) ? drs.indexOf(this.dr) + d : 0;
    this.setDr(drs[(i + drs.length) % drs.length]);
  }
  stepScan(d) { const L = this.curScans(); if (L.length) { this.si = (this.si + d + L.length) % L.length; this.updateScan(); } }
  updateScan() {
    const s = this.curScan();
    if (s && s.typ === 'rez') {                  // viac rezov na jednom obrázku: zvolený rez
      this.rezSel = this.rezSel || {};
      const L = s.szs || [];
      s.sz = L.find(p => p.rez === this.rezSel[s.id]) || L[0] || null;
    }
    this.map.setScan(s, this.dr);
    this.renderBars();
    this.renderLayers();
    this.renderTitle();
    this.renderRaw();
    this.onMapState();
  }
  renderTitle() {
    const G = this.G, s = this.curScan();
    if (!G) return;
    let t = DRLAB[this.dr] ? DRLAB[this.dr] : `DR ${this.dr || '–'}`;
    if (s && s.typ === 'rez') t = `Rez ${(s.sz && s.sz.rez) || s.rez || '?'}` + ((s.szs || []).length > 1 ? ` (${s.szs.length} rezy na obrázku)` : '') + (s.sz ? ` – umiestnený (${s.sz.zdroj}${s.sz.rmse_cm != null ? ', RMSE ' + s.sz.rmse_cm + ' cm' : ''})` : ' – bez umiestnenia');
    if (s) t += `  ·  ${s.name} – ${s.status_text} (DR: ${s.dr_src || '—'})`;
    if (s && s.deform !== null) t += `  ·  pokrčenie ${s.deform.toFixed(2)} mm${s.deform >= 0.3 && !s.narovnany ? ' ⚠ N = narovnať' : ''}`;
    $('title').textContent = t;
  }
  renderBars() {
    const G = this.G, bar = $('drbar');
    bar.innerHTML = '';
    if (!G) return;
    const narrow = window.innerWidth < 1300;
    bar.append(el('span', { class: 'lbl' }, 'DR'));
    for (const d of G.drs) {
      let txt = d.label + (d.n ? ` (${d.n})` : '');
      if (d.done) txt = '✔ ' + txt;
      if (d.prazdna) txt = '∅ ' + txt;
      if (d.dr === G.dno_dr && !isSpecDr(d.dr)) txt += ' ▼';
      bar.append(el('button', { class: `chip ${d.prazdna ? 'prazdna' : d.done ? 'done' : d.cls}${d.dr === NEVYUZ ? ' nevyuz' : ''}${d.dr === this.dr ? ' cur' : ''}`,
        title: (d.z ? `nivelácia ${d.z.toFixed(2)} m` : '') + (d.dr === G.dno_dr ? '  ▼ = DR dna' : ''),
        onclick: () => this.setDr(d.dr) }, txt));
    }
    // sken: výber z ponuky + šípky
    const L = this.curScans(), s = this.curScan();
    bar.append(el('span', { class: 'vsep' }));
    if (!L.length) bar.append(el('span', { class: 'lbl' }, 'K tejto DR nie je sken.'));
    else {
      if (L.length > 1) bar.append(el('button', { class: 'chip mini', title: 'Predchádzajúci sken (Shift+Tab)', onclick: () => this.stepScan(-1) }, '◂'));
      bar.append(el('button', { class: `chip scan st-${s.status === 'ok?' ? 'ok' : s.status}`, title: `${s.season}/${s.rel}\n${s.status_text}`,
        onclick: e => this.scanMenu(e.currentTarget) }, `${s.icon} ${s.name}`, L.length > 1 ? el('small', {}, ` ${this.si % L.length + 1}/${L.length} ▾`) : null));
      if (L.length > 1) bar.append(el('button', { class: 'chip mini', title: 'Ďalší sken (Tab)', onclick: () => this.stepScan(1) }, '▸'));
    }
    if (s && s.navrh && (s.navrh.navrh || s.navrh.popis)) {
      const diff = s.navrh.navrh && s.navrh.navrh !== (s.dr || '');
      bar.append(el('span', { class: 'navrh ' + (diff ? 'diff' : 'same'), title: s.navrh.popis || '' }, `návrh DR ${s.navrh.navrh || '–'}`));
      if (diff) bar.append(el('button', { class: 'chip act', onclick: () => this.scanNavrh(), title: 'Ctrl+D' }, '✓ prijať'));
    }
    bar.append(el('span', { class: 'spacer' }));
    const real = !isSpecDr(this.dr);
    if (real) {
      const cd = G.drs.find(x => x.dr === this.dr);
      const dd = cd.done;
      bar.append(el('button', { class: 'chip act' + (cd.prazdna ? ' prazdna' : ''), onclick: () => this.prazdna(),
        title: 'Označiť DR ako prázdnu (bez prvkov) – dostane inú farbu' }, cd.prazdna ? `∅ DR ${this.dr} prázdna` : '∅ prázdna?'));
      bar.append(el('button', { class: 'chip act' + (dd ? ' on' : ''), onclick: () => this.hotovo('dr'), title: 'DR hotová (H)' },
        dd ? `✔ DR ${this.dr}` : (narrow ? 'DR hotová?' : 'DR hotová? (H)')));
      const isDno = this.dr === G.dno_dr;
      bar.append(el('button', { class: 'chip act' + (isDno ? ' on' : ''), onclick: () => this.dno(),
        title: isDno ? `dno (KHD) je v DR ${G.dno_dr}${G.dno_rucne ? ' (ručne)' : ' (auto)'} – ťuk = späť na automatickú` : `dno (KHD) upravovať v DR ${this.dr}` },
        isDno ? `▼ dno${G.dno_rucne ? ' (ručne)' : ''}` : '▼ dno sem'));
    }
    bar.append(el('button', { class: 'chip act' + (G.done ? ' on' : ''), onclick: () => this.hotovo('grave'), title: 'Hrob hotový (Shift+H)' },
      G.done ? '✔ hrob' : (narrow ? 'hrob hotový?' : 'hrob hotový? (Shift+H)')));
  }
  scanMenu(anchor) {
    const L = this.curScans();
    const back = el('div', { class: 'menu-back', onpointerdown: () => close() });
    const r = anchor.getBoundingClientRect();
    const menu = el('div', { class: 'menu', style: { left: Math.min(r.left, window.innerWidth - 420) + 'px', right: 'auto', top: (r.bottom + 4) + 'px', width: '410px' } });
    const close = () => { back.remove(); menu.remove(); };
    L.forEach((s, i) => menu.append(el('button', { onclick: () => { close(); this.si = i; this.updateScan(); },
      style: { color: { ok: '#0b6b0b', 'ok?': '#0b6b0b', bez: '#9a5a00', mimo: '#b00000' }[s.status] || '#555', fontWeight: i === this.si ? 700 : 400 } },
      `${s.icon} ${s.name}`, el('kbd', {}, s.status_text + (s.deform !== null ? ` · ${s.deform.toFixed(2)} mm` : '')))));
    document.body.append(back, menu);
  }
  // pravý panel: vrstvy (polygóny, línie, body) s legendou, viditeľnosťou a aktívnou vrstvou na úpravy
  renderInfo() { this.renderLayers(); }
  layerDefs() {
    const L = (this.layers || []).slice();
    L.push({ name: 'BODY', title: 'Body z merania', kind: 'body', cat: 'point', drawable: false, color: '#e00000' });
    return L;
  }
  renderLayers() {
    const box = $('info'), m = this.map;
    box.className = 'layers-panel';
    box.innerHTML = '';
    if (!this.G) return;
    const vis = m.feats();
    const cnt = name => name === 'BODY' ? [this.G.points.length, this.G.points.length] :
      [vis.filter(f => f.layer === name).length, this.G.feats.filter(f => f.layer === name).length];
    const act = m.activeLayer;
    box.append(el('div', { class: 'lp-head' },
      el('div', { class: 'lp-title' }, 'Vrstvy'),
      el('div', { class: 'lp-sub' }, `${this.G.g} · ${DRLAB[this.dr] || 'DR ' + (this.dr || '–')} · ${{ dr: 'len táto DR', all: 'všetky DR', none: 'vektory skryté' }[m.vmode]}`)));
    box.append(el('div', { class: 'lp-active' + (act ? ' on' : '') }, act ?
      [el('span', {}, '✏ Aktívna vrstva: ', el('b', {}, act)), el('button', { class: 'lp-x', title: 'Zrušiť – upravovať všetky vrstvy', onclick: () => this.setActiveLayer(null) }, '✕')] :
      el('span', {}, 'Ťukni na vrstvu = aktívna vrstva. ✏ Upraviť potom vyberá a kreslí len v nej.')));
    for (const [cat, title] of [['polygon', 'Polygóny'], ['line', 'Línie'], ['point', 'Body']]) {
      const defs = this.layerDefs().filter(d => d.cat === cat);
      if (!defs.length) continue;
      const grp = el('div', { class: 'lp-grp' });
      const allHidden = defs.every(d => m.hidden.has(d.name));
      grp.append(el('div', { class: 'lp-gh' }, el('span', {}, title),
        el('button', { class: 'lp-gt', onclick: () => { for (const d of defs) allHidden ? m.hidden.delete(d.name) : m.hidden.add(d.name); this.layersChanged(); } }, allHidden ? 'zobraziť' : 'skryť')));
      for (const d of defs) {
        const [n, tot] = cnt(d.name);
        const hidden = m.hidden.has(d.name);
        const row = el('div', { class: 'lp-row' + (hidden ? ' off' : '') + (act === d.name ? ' act' : '') + (tot ? '' : ' empty'),
          title: d.drawable ? 'Ťuk = aktívna vrstva na úpravy' : '' },
          el('button', { class: 'lp-eye', title: hidden ? 'Zobraziť' : 'Skryť', onclick: e => { e.stopPropagation(); hidden ? m.hidden.delete(d.name) : m.hidden.add(d.name); this.layersChanged(); } }, hidden ? '○' : '●'),
          el('span', { class: 'lp-sw', html: legendSvg(d) }),
          el('span', { class: 'lp-name' }, d.title || prettyLayer(d.name)),
          el('span', { class: 'lp-n' }, d.name === 'BODY' ? String(n) : (n === tot ? String(n) : `${n}/${tot}`)),
          act === d.name ? el('span', { class: 'lp-badge' }, '✏') : null);
        row.addEventListener('click', () => { if (d.name !== 'BODY') this.setActiveLayer(act === d.name ? null : d.name); });
        grp.append(row);
      }
      box.append(grp);
    }
  }
  layersChanged() {
    this.lsSet('hiddenLayers', [...this.map.hidden]);
    if (this.map.sel && this.map.hidden.has(this.map.sel.ft.layer) && !this.map.sel.dirty) this.map.select(null);
    this.renderLayers(); this.map.request();
  }
  setActiveLayer(name) {
    const m = this.map;
    m.activeLayer = name;
    this.lsSet('activeLayer', name);
    if (name) m.hidden.delete(name);
    if (m.sel && name && m.sel.ft.layer !== name && !m.sel.dirty) m.select(null);
    this.renderLayers(); this.onMapState(); m.request();
    this.status(name ? `Aktívna vrstva ${name} – ✏ Upraviť vyberá a kreslí len v nej.` : 'Upravovať sa dajú všetky vrstvy.');
  }
  renderRaw() {
    const b = $('rawbanner'), s = this.curScan();
    b.classList.remove('slim');
    if (s && s.typ === 'rez' && this.map.isProf()) {
      const pd = this.G.profily && this.G.profily[s.sz.rez];
      b.classList.remove('hidden'); b.classList.add('slim'); b.innerHTML = '';
      const chips = el('div', { class: 'row' });
      for (const p of s.szs || []) chips.append(el('button', { class: 'chip mini' + (p.rez === s.sz.rez ? ' on' : ''), title: p.zdroj,
        onclick: () => { this.rezSel = { ...(this.rezSel || {}), [s.id]: p.rez }; this.updateScan(); } }, p.rez));
      chips.append(el('button', { class: 'tool', title: 'Na tom istom obrázku je ďalší rez – umiestni ho na body', onclick: () => this.gcp(this.nextRez(s)) }, '＋ rez'));
      b.append(el('b', {}, `Rez ${s.sz.rez || ''}`), el('span', { class: 'sub' }, `  ${s.sz.auto ? 'z QField' : 'na body'} · ${pd ? pd.zdroje.join(', ') : 'bez vektorov profilu'}`),
        chips, el('div', { class: 'row' }, el('button', { class: 'tool', onclick: () => this.gcp(s.sz.rez) }, s.sz.auto ? '⌖ Doladiť na body' : '⌖ Upraviť umiestnenie')));
      return;
    }
    if (!this.map.isRaw()) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    b.innerHTML = '';
    if (s.typ === 'rez') {
      const has = this.G.profily && s.rez && this.G.profily[s.rez];
      b.append(el('b', {}, `Rez ${s.rez || '(neznámy)'} – bez umiestnenia`), el('span', { class: 'sub' }, `  ${s.season}/${s.rel}`),
        el('div', { class: 'hint' }, has ? 'K tomuto rezu je vektorizovaný profil – umiestni sken na body (začiatok/koniec šnúry, body profilu) a profil sa naň vloží.'
          : 'K rezu nie je vektorizovaný profil – dá sa umiestniť na body šnúry, ak sú zamerané.'),
        el('div', { class: 'row' },
          el('button', { class: 'tool primary', onclick: () => this.gcp() }, '⌖ Georeferencovať rez na body (K)'),
          el('button', { class: 'tool', onclick: () => this.scanRez() }, '▭ R je to plán')));
      return;
    }
    b.append(el('b', {}, 'Bez georeferencie'), el('span', { class: 'sub' }, `  ${s.season}/${s.rel}`),
      el('div', { class: 'row' },
        el('button', { class: 'tool primary', onclick: () => this.gcp() }, '⌖ Georeferencovať na body z merania (K)'),
        el('button', { class: 'tool', onclick: () => this.scanRez() }, '▭ R je to rez'),
        el('button', { class: 'tool', onclick: () => this.scanDr() }, 'D nastaviť DR')));
  }
  onRotate() { this.renderViewTools(); }

  // ------------------------------------------------------------------ lišta úprav (E)
  onMapState() {
    const m = this.map, bar = $('editbar'), msgEl = $('editmsg');
    $('modeseg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === (m.mode === 'pick' ? 'view' : m.mode)));
    if (!this.G || (m.mode === 'view' && !m.pick)) { bar.classList.add('hidden'); msgEl.classList.add('hidden'); this.renderViewTools(); return; }
    bar.classList.remove('hidden', 'draw', 'pick'); msgEl.classList.remove('hidden', 'draw', 'pick');
    bar.innerHTML = '';
    // tlačidlo: ikona + krátky popis pod ňou
    let tmode = 'edit';
    const T = (ico, lab, fn, o = {}) => {
      const tier = o.tier || tierOf(tmode, lab);
      const b = el('button', { class: `etool t${tier}` + (o.on ? ' on' : '') + (o.cls ? ' ' + o.cls : ''), title: o.title || lab,
        disabled: o.dis, onclick: e => { e.stopPropagation(); fn(); } }, el('span', { class: 'i' }, ico), el('span', { class: 'l' }, lab));
      b._tier = tier;
      return b;
    };
    let msg = '', sub = '';
    const tools = [];
    if (m.mode === 'move' && m.mv) {
      tmode = 'move';
      const e = m.mv;
      bar.classList.add('pick'); msgEl.classList.add('pick');
      msg = `Posun vektorov ${e.g} DR ${e.dr} (${e.keys.size} prvkov): dx ${(e.dx * 100).toFixed(1)} cm · dy ${(e.dy * 100).toFixed(1)} cm · rot ${e.rot.toFixed(2)}°`;
      if (e.fit) msg += `  ·  auto fit: zhoda ${(e.fit.pred[1] * 100).toFixed(0)} → ${(e.fit.po[1] * 100).toFixed(0)} % (náhodne ${(e.fit.nahoda * 100).toFixed(0)} %)`;
      sub = e.rotMode ? 'ťahaj = ROTÁCIA okolo stredu (krížik)' : 'ťahaj = posun všetkých vektorov DR (Shift+ťahanie = rotácia) · tlačidlá = jemné doladenie';
      const nud = (dx, dy, r) => { e.dx += dx; e.dy += dy; e.rot += r; this.onMapState(); m.request(); };
      tools.push(T('💾', 'Uložiť', () => this.moveSave(), { cls: 'primary', title: 'Uložiť korekciu DR (Enter)' }),
        T('✕', 'Zrušiť', () => { m.setMode('view'); }, { title: 'Esc' }),
        T('⟳', 'Rotácia', () => { e.rotMode = !e.rotMode; this.onMapState(); m.request(); }, { on: e.rotMode }),
        T('◀', '1 cm', () => nud(-0.01, 0, 0)), T('▶', '1 cm', () => nud(0.01, 0, 0)),
        T('▲', '1 cm', () => nud(0, 0.01, 0)), T('▼', '1 cm', () => nud(0, -0.01, 0)),
        T('↺', '0,1°', () => nud(0, 0, 0.1)), T('↻', '0,1°', () => nud(0, 0, -0.1)),
        T('0', 'Vynulovať', () => { e.dx = 0; e.dy = 0; e.rot = 0; e.fit = null; this.onMapState(); m.request(); }),
        T('J', 'Auto fit', () => this.autoFit(), { title: 'Prisadnúť vektory na kresbu (J)' }),
        T('U', 'Zistiť DR', () => this.detectDr(), { title: 'Ku ktorej DR patrí plán (U)' }),
        T('🗺', 'Posunúť sken', () => this.moveScan(), { title: 'Namiesto vektorov prepísať georeferenciu skenu' }));
    } else if (m.mode === 'prop' && m.prop) {
      const p = m.prop, gl = p.glob || {}, mm = m.man;
      const cnt = {}; let acc = 0;
      for (const it of p.items.values()) { cnt[it.stav] = (cnt[it.stav] || 0) + 1; if (it.accept) acc++; }
      msg = `Návrh ${p.hrob} DR ${p.dr} (${String(p.sken).split(/[\\/]/).pop()}): DR celkom ${gl.pouzite ? 'POUŽITÝ' : 'nepoužitý'} posun ${((gl.dx || 0) * 100).toFixed(1)}/${((gl.dy || 0) * 100).toFixed(1)} cm, rot ${(gl.rot || 0).toFixed(2)}°, mierka ${(gl.sc || 1).toFixed(3)} · zhoda ${(p.pred[1] * 100).toFixed(0)} → ${(p.po[1] * 100).toFixed(0)} % · prijaté ${acc}`;
      sub = `${cnt.rucne || 0} ručne · ${cnt.upravene || 0} upravené · ${cnt.globalne || 0} len s DR · ${cnt.sedi || 0} sedia · ${cnt.nenajdene || 0} nenájdené · ${cnt.ponechane || 0} nejasné — zelená = prijať, červená = ponechať, ťuk = prepnúť`;
      if (p.po[1] < 0.40) sub += '\n⚠ Nízka zhoda aj po zladení – plán možno patrí inej DR (U) alebo vektory neboli kreslené z neho.';
      if (Math.abs((gl.sc || 1) - 1) >= 0.03 && gl.pouzite) sub += `\n⚠ Mierka sa líši o ${(Math.abs(gl.sc - 1) * 100).toFixed(0)} % – skontroluj georeferenciu plánu (K).`;
      if (mm) {
        tmode = 'man';
        bar.classList.add('draw'); msgEl.classList.add('draw');
        const ink = m.inkState === 'ok' ? '' : ' (čiary kresby sa pripravujú – zatiaľ bez prichytávania)';
        if (!mm.key && !(mm.mode === 'body' && mm.whole)) sub = 'RUČNÁ OPRAVA: ťukni na prvok, ktorý chceš opraviť.' + ink;
        else if (mm.mode === 'body') sub = `LÍCOVACIE BODY: ťuk na miesto na VEKTORE → ťuk na to isté miesto na KRESBE (prichytí sa). 1 pár = posun, 2+ = aj rotácia a mierka. Párov: ${mm.pairs.length}${mm.info ? ' · ' + mm.info : ''}` + ink;
        else sub = `PREKRESLENIE: ťukaj vrcholy po čiare kresby alebo ťahaj perom. Vrcholov: ${mm.pts.length}` + ink;
        tools.push(T('✔', 'Hotovo', () => this.manDone(), { cls: 'primary', title: 'Prevziať do návrhu (Enter)' }),
          T('↶', 'Späť', () => this.manUndo(), { title: 'Backspace' }),
          T('✕', 'Zrušiť', () => { m.man = null; this.onMapState(); m.request(); }, { title: 'Esc' }),
          T('🧲', 'Prichytiť', () => this.manSnap(), { dis: !mm.geom.size }),
          mm.mode === 'body' ? T('▦', 'Celá DR', () => { mm.whole = !mm.whole; this.manApply(); this.onMapState(); }, { on: mm.whole, title: 'transformácia pre všetky prvky DR' }) : null,
          T('⊘', 'Bez prich.', () => { m.noSnap = !m.noSnap; this.onMapState(); }, { on: m.noSnap }));
      } else {
        tmode = 'prop';
        bar.classList.add('pick'); msgEl.classList.add('pick');
        tools.push(T('💾', 'Uložiť prijaté', () => this.propSave(), { cls: 'primary', title: 'Enter' }),
          T('✕', 'Zrušiť', () => m.setMode('view'), { title: 'Esc' }),
          T('✔', 'Prijať', () => this.propAll(true), { title: 'Prijať všetky' }), T('✗', 'Ponechať', () => this.propAll(false), { title: 'Ponechať všetky' }),
          T('⟲', 'Prepočítať', () => this.zladit(true)),
          T('T', 'Body', () => this.manStart('body'), { title: 'Ručne: lícovacie body vektor → kresba (T)' }),
          T('Y', 'Prekresliť', () => this.manStart('kresba'), { title: 'Ručne: prekresliť po kresbe (Y)' }),
          T('E', 'Vrcholy', () => this.propVertices(), { dis: !p.sel, title: 'Otvoriť vybraný prvok v úprave vrcholov' }),
          T('L', 'DR', () => { if (p.sel) this.drDialog([p.sel]); }, { dis: !p.sel }));
      }
    } else if (m.mode === 'pick') {
      tmode = 'pick';
      bar.classList.add('pick'); msgEl.classList.add('pick');
      msg = (m.pick.kind === 'dr' ? 'Zmena DR' : 'Atribúty') + ': ťukni na prvok alebo ťahaj LASO okolo viacerých';
      sub = 'prvky iných DR ukáže „V všetky“';
      tools.push(T('✕', 'Zrušiť', () => { m.setMode('view'); this.onMapState(); }, { title: 'Esc' }));
    } else if (m.draw) {
      tmode = 'draw';
      bar.classList.add('draw'); msgEl.classList.add('draw');
      const d = m.draw;
      const ink = m.scanForSnap() ? ({ ok: 'prichytáva sa na kresbu', run: 'pripravujem kresbu skenu…' }[m.inkState] || 'kresba nie je k dispozícii') : 'bez georef. skenu – bez prichytenia';
      const drOk = !isSpecDr(this.dr);
      msg = `NOVÝ ${d.typ === 'polygon' ? 'POLYGÓN' : 'LÍNIA'} · ${d.layer} → ${this.G.g}, DR ${drOk ? this.dr : '⚠ žiadna (vyber DR)'} · ${d.pts.length} vrch.`;
      sub = d.whole ? '▶ ŤUKNI NA PRVOK – prevezme sa celý obrys' :
        `${this.drawByTap ? 'ťukaj vrcholy (ťah = posun, 2 prsty = zoom a otáčanie)' : 'ťukaj vrcholy alebo kresli perom ťahom'} · dvojťuk = dokončiť · ${ink} · na obryse sa prichytí, 2 ťuky na ten istý obrys ho obkreslia`;
      tools.push(T('✔', 'Dokončiť', () => this.drawFinish(), { cls: 'primary', title: 'Enter' }),
        T('↶', 'Späť', () => m.drawUndo(), { title: 'Backspace', dis: !d.pts.length }),
        T('✕', 'Zrušiť', () => { m.draw = null; this.onMapState(); m.request(); }, { title: 'Esc' }),
        T(this.drawByTap ? '•' : '✍', this.drawByTap ? 'Ťukanie' : 'Ťahom', () => { this.drawByTap = !this.drawByTap; this.lsSet('drawByTap', this.drawByTap); this.onMapState(); },
          { tier: 1, on: !this.drawByTap, title: 'Prepnúť: vrcholy ťukaním (ťah posúva mapu) / voľné kreslenie ťahom perom' }),
        T('⌇', 'Trasovať', () => { d.trace = !d.trace; this.traceOn = d.trace; d.last = null; this.onMapState(); }, { on: d.trace, title: 'Trasovanie po obrysoch prvkov (T)' }),
        T('⊘', 'Bez prich.', () => { m.noSnap = !m.noSnap; this.onMapState(); }, { on: m.noSnap, title: 'Bez prichytenia (ako Shift)' }),
        T('⟲', 'Dlhšou', () => { m.longer = !m.longer; this.onMapState(); }, { on: m.longer, title: 'Obkresliť obrys dlhšou cestou (ako Ctrl)' }),
        T('◯', 'Celý obrys', () => { d.whole = true; this.onMapState(); }, { on: d.whole, title: 'Ďalší ťuk na prvok prevezme jeho celý obrys' }));
    } else {
      const s = m.sel;
      if (!s) { msg = m.activeLayer ? `Úprava vrstvy ${m.activeLayer}: ťukni na jej prvok` : 'Úprava tvaru: ťukni na obrys alebo dovnútra polygónu'; sub = 'aktuálnej DR („V všetky“ = všetky DR) · opakovaný ťuk = ďalší prvok pod kurzorom · ＋ = nový prvok'; }
      else {
        const n = s.rings.reduce((a, r) => a + r.pts.length, 0), ft = s.ft;
        msg = `${ft.layer} ${ft.new ? 'nový prvok' : 'OID ' + ft.fid}${ft.label ? ' (' + ft.label + ')' : ''} · ${n} vrch.${s.dirty ? ' · NEULOŽENÉ' : ''}${ft.src === 'vedit' ? ' · upravený (ešte nie v GDB)' : ''}`;
        sub = 'ťahaj vrchol · ťahaj krúžok v strede hrany = nový vrchol · podrž vrchol / tlačidlo pera / pravý klik = zmazať vrchol';
      }
      tools.push(T('💾', 'Uložiť', () => this.saveShape(), { cls: s && s.dirty ? 'primary' : '', dis: !s, title: 'Uložiť tvar (Enter)' }),
        T('↶', 'Späť', () => m.undo(), { dis: !s || !s.undo.length, title: 'Ctrl+Z' }),
        T('✕', s ? 'Zrušiť výber' : 'Koniec', () => this.escape(), { title: 'Esc' }),
        T('＋', 'Nový', () => this.newFeature(), { title: 'Nový prvok (Insert)' }),
        T('✥', 'Posun', () => { m.moveWhole = !m.moveWhole; this.onMapState(); }, { on: m.moveWhole, dis: !s, title: 'Posun celého prvku (Shift+ťahanie)' }),
        T('↺', '+1°', () => m.transformSel(1, 1), { dis: !s, title: 'Rotácia +1°' }),
        T('↻', '−1°', () => m.transformSel(1, -1), { dis: !s, title: 'Rotácia −1°' }),
        T('⤡', '+2 %', () => m.transformSel(1.02), { dis: !s, title: 'Zväčšiť o 2 %' }),
        T('⤢', '−2 %', () => m.transformSel(1 / 1.02), { dis: !s, title: 'Zmenšiť o 2 %' }),
        T('🧲', 'Prichytiť', () => this.snapShape(), { dis: !s, title: 'Prichytiť obrys na kresbu plánu (do 2 cm)' }),
        T('L', 'DR', () => this.changeDr(), { dis: !s, title: 'DR prvku (L)' }),
        T('I', 'Atribúty', () => this.editAttrs(), { dis: !s, title: 'Atribúty (I)' }),
        T('⇄', 'Smer', () => m.reverseSel(), { dis: !s, title: 'Otočiť smer línie (rezy A↔B)' }),
        T('⎌', 'Pôvodný', () => this.discardShape(), { dis: !s, title: 'Zahodiť uložený tvar – vrátiť pôvodný z GDB' }),
        T('🗑', 'Zmazať', () => this.deleteFeature(), { dis: !s, cls: 'danger', title: 'Zmazať prvok (Delete)' }),
        T('♻', 'Obnoviť', () => this.undelete(), { title: 'Obnoviť posledný zmazaný (Ctrl+Shift+Z)' }));
    }
    // 1 = hlavné (veľké, navrchu), 2 = bežné, 3 = zriedkavé (skryté pod „Viac“)
    const all = tools.filter(Boolean);
    const rare = all.filter(b => b._tier === 3);
    const more = !!(this.moreOpen || {})[tmode];
    const col = (items, t) => items.length ? el('div', { class: 'ecol c' + t }, ...items) : null;
    const moreBtn = rare.length ? el('button', { class: 'etool t3 more' + (more ? ' on' : ''), title: more ? 'Skryť zriedkavé nástroje' : 'Zriedkavé nástroje',
      onclick: e => { e.stopPropagation(); this.moreOpen = { ...(this.moreOpen || {}), [tmode]: !more }; this.onMapState(); } },
    el('span', { class: 'i' }, more ? '▸' : '⋯'), el('span', { class: 'l' }, more ? 'Menej' : `Viac (${rare.length})`)) : null;
    // stĺpce sprava: 1 hlavné, 2 bežné (+ „Viac“), 3 zriedkavé (len po rozbalení)
    bar.append(...[col(all.filter(b => b._tier === 1), 1), col(all.filter(b => b._tier === 2).concat(moreBtn ? [moreBtn] : []), 2),
      more ? col(rare, 3) : null].filter(Boolean));
    msgEl.innerHTML = '';
    msgEl.append(el('div', { class: 'm' }, msg), sub ? el('div', { class: 's' }, sub) : null);
    requestAnimationFrame(() => { msgEl.style.right = (bar.offsetWidth + 18) + 'px'; });
    this.renderViewTools();
  }
  // hlavné nástroje (kategória 1) – rýchla lišta nad mapou v prehliadaní
  renderQuickbar() {
    const box = $('quickbar'), m = this.map;
    box.innerHTML = '';
    const show = this.G && m.mode === 'view' && !m.pick && !m.isRaw() && !m.isProf();
    box.classList.toggle('hidden', !show);
    if (!show) return;
    for (const t of this.tools().filter(t => t.tier === 1)) {
      box.append(el('button', { class: 'qtool', title: t.title + (t.key ? ` (${t.key})` : ''), onclick: e => { e.stopPropagation(); t.fn(); } },
        el('span', { class: 'i' }, t.ico), el('span', { class: 'l' }, t.short)));
    }
  }
  renderViewTools() {
    this.renderQuickbar();
    if (this.G && this._lvm !== this.map.vmode) { this._lvm = this.map.vmode; this.renderLayers(); }
    const m = this.map, box = $('viewtools');
    box.innerHTML = '';
    const T = (txt, fn, on, title, tier = 2) => el('button', { class: `tool vt${tier}` + (on ? ' on' : ''), title: title || '', onclick: e => { e.stopPropagation(); fn(); } }, ...txt);
    const save = () => this.lsSet('view', { vmode: m.vmode, pmode: m.pmode, ctxFill: m.ctxFill, penOnly: m.penOnly });
    if (m.view && m.view.r) box.append(T(['🧭 ', el('small', {}, `${Math.round(-m.view.r * 180 / Math.PI)}°`)], () => { m.resetRotation(); this.renderViewTools(); }, true, 'Otočené prstami – ťuk = sever hore', 1));
    box.append(T(['⤢'], () => m.fit(), false, 'Celý hrob (F)', 1),
      T(['V ', el('small', {}, { dr: 'DR', all: 'všetky', none: 'skryté' }[m.vmode])], () => { m.vmode = { dr: 'all', all: 'none', none: 'dr' }[m.vmode]; save(); this.renderViewTools(); m.request(); }, m.vmode !== 'dr', 'Vektory: aktuálna DR / všetky DR / skryté (V)', 1),
      T(['B ', el('small', {}, { on: 'body', labels: 'kódy', off: 'vyp' }[m.pmode])], () => { m.pmode = { on: 'labels', labels: 'off', off: 'on' }[m.pmode]; save(); this.renderViewTools(); m.request(); }, m.pmode !== 'on', 'Body z merania (B)'),
      T(['C ', el('small', {}, 'výplň')], () => { m.ctxFill = !m.ctxFill; save(); this.renderViewTools(); m.request(); }, m.ctxFill, 'Výplň kontextov (C)'));
    const rng = el('input', { type: 'range', min: 0, max: 100, value: Math.round(m.opacity * 100) });
    rng.addEventListener('input', () => { m.opacity = rng.value / 100; m.request(); });
    rng.addEventListener('pointerdown', e => e.stopPropagation());
    box.append(el('div', { class: 'tool', title: 'Priehľadnosť skenu (O)' }, el('small', {}, 'sken'), rng));
    if (m.penSeen) box.append(T(['✍ ', el('small', {}, m.penOnly ? 'len pero' : 'pero aj prst')], () => { m.penOnly = !m.penOnly; save(); this.renderViewTools(); }, m.penOnly, 'Kreslí len pero, prst posúva a zväčšuje mapu', 3));
  }
  onPenDetected() { toast('Pero rozpoznané – kreslí a upravuje len pero, prstami posúvaš, zväčšuješ a otáčaš mapu (prepínač ✍ vľavo dole).', 'ok', 6000); this.renderViewTools(); }
  askDiscard() { return confirmBox('Predchádzajúci prvok má neuložené zmeny tvaru. Zahodiť ich?', 'Zahodiť', 'Ponechať', true); }

  // ------------------------------------------------------------------ karta prvku (prehliadanie)
  hideCard() { $('card').classList.add('hidden'); this.map.highlight.delete('_card'); }
  showFeatureCard(ft, X, Y) {
    const c = $('card');
    if (!ft) { this.hideCard(); return; }
    c.innerHTML = '';
    const lines = [`DR ${ft.dr_raw || (ft.has_dr ? '–' : 'pole DR nemá')}${ft.hrob ? ' · hrob ' + ft.hrob : ''}`];
    if (ft.src === 'vedit') lines.push('upravený tvar (ešte nie v GDB)');
    if (ft.new) lines.push('nový prvok (ešte nie v GDB)');
    c.append(el('div', { class: 't' }, `${ft.layer} ${ft.new ? '' : 'OID ' + ft.fid}${ft.label ? ' · ' + ft.label : ''}`),
      el('div', { class: 's' }, lines.join('\n')),
      el('div', { class: 'row' },
        el('button', { class: 'tool', onclick: () => { this.hideCard(); this.map.setMode('edit'); if (this.map.canEdit(ft)) this.map.select(ft); else this.status('Tento prvok sa v tejto DR nedá upravovať (KHH len v prvej DR, KHD v DR dna).'); } }, '✏ Upraviť'),
        el('button', { class: 'tool', onclick: () => { this.hideCard(); this.attrDialog([ft.k]); } }, 'I Atribúty'),
        ft.has_dr ? el('button', { class: 'tool', onclick: () => { this.hideCard(); this.drDialog([ft.k]); } }, 'L DR') : null,
        el('button', { class: 'tool', onclick: () => this.hideCard() }, '✕')));
    c.classList.remove('hidden');
    const W = $('mapwrap').clientWidth, H = $('mapwrap').clientHeight;
    const cw = c.offsetWidth, ch = c.offsetHeight;
    c.style.left = Math.max(8, Math.min(W - cw - 8, X + 14)) + 'px';
    c.style.top = Math.max(8, Math.min(H - ch - 8, Y + 14)) + 'px';
  }

  // ------------------------------------------------------------------ hlavička, menu, klávesy
  bindTop() {
    $('b-prev').onclick = () => this.stepGrave(-1);
    $('b-next').onclick = () => this.stepGrave(1);
    $('b-grave').onclick = () => this.togglePanel('left', true);
    $('b-left').onclick = () => this.togglePanel('left');
    $('b-right').onclick = () => this.togglePanel('right');
    $('b-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
    $('b-tools').onclick = () => this.toolsMenu();
    $('editmsg').onclick = () => $('editmsg').classList.toggle('min');
    $('filter').onchange = () => this.renderList();
    $('search').oninput = () => this.renderList();
    $('search').onkeydown = e => { if (e.key === 'Enter') { const v = this.visibleGraves(); if (v.length) this.showGrave(v[0].g); e.target.blur(); } };
    $('modeseg').querySelectorAll('button').forEach(b => (b.onclick = () => this.setMode(b.dataset.mode)));
    window.addEventListener('resize', () => this.map.resize());
  }
  togglePanel(id, open) {
    const p = $(id);
    const closed = open === true ? false : !p.classList.contains('closed');
    p.classList.toggle('closed', closed);
    if (!this.wide() && id === 'right' && window.innerWidth < 900) $('left').classList.add('closed');
    if (!this.wide() && id === 'left' && window.innerWidth < 900) $('right').classList.add('closed');
    if (window.innerWidth >= 900) this.lsSet(id + 'Closed', closed);
    if (id === 'left' && !closed) setTimeout(() => this.renderList(), 0);
    setTimeout(() => this.map.resize(), 30);
  }
  async setMode(mode) {
    const m = this.map;
    if (mode === 'edit' && CONN.rola === 'prehliadanie') { toast(`Účet ${CONN.user} môže len prehliadať.`, 'warn'); this.onMapState(); return; }
    if (mode === 'edit' && m.isProf()) { this.status('Rez sa zobrazuje v profile – úpravy vektorov sú v pôdoryse (vyber DR).'); this.onMapState(); return; }
    if (mode === 'view' && m.sel && m.sel.dirty && !(await this.askDiscard())) return;
    this.hideCard();
    m.setMode(mode);
  }
  // všetky nástroje aplikácie roztriedené podľa dôležitosti:
  // 1 = hlavné (denná práca: rýchla lišta + veľké dlaždice), 2 = bežné (zoznam v menu), 3 = zriedkavé (zbalené „Ďalšie“)
  tools() {
    return [
      { tier: 1, ico: '＋', short: 'Nový prvok', title: 'Nový prvok – kresliť', key: 'Ins', grp: 'Prvky', fn: () => this.newFeature() },
      { tier: 1, ico: '⌖', short: 'Georef body', title: 'Georeferencovať sken na body z merania', key: 'K', grp: 'Sken', fn: () => this.gcp() },
      { tier: 1, ico: '〰', short: 'Zladiť', title: 'Zladiť DR s kresbou (návrh)', key: 'W', grp: 'Zladenie', fn: () => this.zladit(false) },
      { tier: 1, ico: '⇄', short: 'Posun DR', title: 'Posúvať vektory DR (korekcia)', key: 'M', grp: 'Zladenie', fn: () => this.moveStart() },
      { tier: 1, ico: 'L', short: 'DR prvkov', title: 'Zmeniť DR prvkov (ťuk / laso)', key: 'L', grp: 'Prvky', fn: () => this.changeDr() },
      { tier: 2, ico: 'I', short: 'Atribúty', title: 'Atribúty prvkov (ťuk / laso)', key: 'I', grp: 'Prvky', fn: () => this.editAttrs() },
      { tier: 2, ico: 'D', short: 'DR skenu', title: 'Nastaviť DR skenu', key: 'D', grp: 'Sken', fn: () => this.scanDr() },
      { tier: 2, ico: '▭', short: 'Plán/rez', title: 'Plán ↔ rez', key: 'R', grp: 'Sken', fn: () => this.scanRez() },
      { tier: 2, ico: '🎯', short: 'Auto fit', title: 'Auto fit vektorov DR na kresbu', key: 'J', grp: 'Zladenie', fn: () => this.autoFit() },
      { tier: 2, ico: '❓', short: 'Zistiť DR', title: 'Ku ktorej DR patrí plán', key: 'U', grp: 'Zladenie', fn: () => this.detectDr() },
      { tier: 1, ico: '🧊', short: '3D', title: '3D hrobu – kontexty a nálezy', key: 'F3', grp: 'Hrob a výstupy', fn: () => this.open3d() },
      { tier: 2, ico: '🗺', short: 'Layout', title: 'Náhľad layoutu ako v ArcGIS Pro', key: 'F4', grp: 'Hrob a výstupy', fn: () => this.openLayout() },
      { tier: 2, ico: '🏺', short: 'Súpis', title: 'Súpis nálezov ↔ vektory', key: 'F6', grp: 'Hrob a výstupy', fn: () => this.openNalezy() },
      { tier: 2, ico: '↶', short: 'Obnoviť', title: 'Obnoviť posledný zmazaný prvok', key: 'Ctrl+Shift+Z', grp: 'Prvky', fn: () => this.undelete() },
      { tier: 3, ico: '📏', short: 'Pokrčenie', title: 'Zmerať pokrčenie plánov hrobu', key: 'P', grp: 'Sken', fn: () => this.measure() },
      { tier: 3, ico: '🧻', short: 'Narovnať', title: 'Narovnať papier aktuálneho skenu', key: 'N', grp: 'Sken', fn: () => this.rectify() },
      { tier: 3, ico: '〰', short: 'Hromadne', title: 'Zladiť všetky hroby (hromadne)', key: 'Shift+W', grp: 'Zladenie', fn: () => this.zladitVsetky() },
      { tier: 3, ico: '⇲', short: 'Profily 3D', title: 'Profily rezov → 3D', key: '', grp: 'Hrob a výstupy', fn: () => this.profily() },
      { tier: 3, ico: '⇪', short: 'Export', title: 'Export hotových hrobov → QGIS + ArcGIS', key: '', grp: 'Hrob a výstupy', fn: () => this.exportQgis() },
      { tier: 3, ico: '⟳', short: 'Načítať', title: 'Načítať dáta znova (GDB, skeny)', key: 'F5', grp: 'Aplikácia', fn: () => this.reload() },
      { tier: 3, ico: '⚙', short: 'Nastavenia', title: 'Nastavenia (GDB, sezóny)', key: '', grp: 'Aplikácia', fn: () => this.settings() },
      { tier: 2, ico: '📱', short: 'Tablet (QR)', title: 'Pripojiť tablet – QR kód', key: '', grp: 'Aplikácia', fn: () => this.tablet() },
      CONN.ucty && CONN.user && !CONN.local ? { tier: 2, ico: '👤', short: 'Odhlásiť', title: `Odhlásiť (${CONN.user}, ${CONN.rola})`, key: '', grp: 'Aplikácia', fn: () => logout() } : null,
      { tier: 3, ico: '⌨', short: 'Klávesy', title: 'Klávesové skratky', key: '?', grp: 'Aplikácia', fn: () => this.help() },
    ].filter(Boolean);
  }
  toolsMenu() {
    const back = el('div', { class: 'menu-back', onpointerdown: () => close() });
    const menu = el('div', { class: 'menu' });
    const close = () => { back.remove(); menu.remove(); };
    const all = this.tools();
    const run = t => () => { close(); t.fn(); };
    // 1: veľké dlaždice
    menu.append(el('h4', {}, '★ Hlavné'),
      el('div', { class: 'tiles' }, ...all.filter(t => t.tier === 1).map(t => el('button', { class: 'tile', onclick: run(t), title: t.title },
        el('span', { class: 'i' }, t.ico), el('span', { class: 'l' }, t.short), t.key ? el('kbd', {}, t.key) : null))));
    // 2: zoznam podľa skupín
    const I = t => el('button', { onclick: run(t) }, el('span', { class: 'mi' }, t.ico), t.title, t.key ? el('kbd', {}, t.key) : null);
    menu.append(el('h4', {}, 'Bežné'));
    for (const g of ['Prvky', 'Sken', 'Zladenie', 'Hrob a výstupy', 'Aplikácia']) {
      const L = all.filter(t => t.tier === 2 && t.grp === g);
      if (L.length) menu.append(el('div', { class: 'mgrp' }, g), ...L.map(I));
    }
    // 3: zriedkavé – zbalené
    const open = !!this.lsGet('menuRare');
    const det = el('details', { class: 'rare' }, el('summary', {}, `Ďalšie – zriedkavé (${all.filter(t => t.tier === 3).length})`),
      ...all.filter(t => t.tier === 3).map(I));
    det.open = open;
    det.addEventListener('toggle', () => this.lsSet('menuRare', det.open));
    menu.append(det);
    document.body.append(back, menu);
  }
  bindKeys() {
    document.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (document.querySelector('.screen')) return;
      const m = this.map, k = e.key, K = k.length === 1 ? k.toLowerCase() : k;
      let done = true;
      if (k === 'ArrowLeft' || k === 'PageUp') this.stepGrave(-1);
      else if (k === 'ArrowRight' || k === 'PageDown') this.stepGrave(1);
      else if (k === 'ArrowUp') this.stepDr(-1);
      else if (k === 'ArrowDown') this.stepDr(1);
      else if (k === 'Tab') this.stepScan(e.shiftKey ? -1 : 1);
      else if (k === 'F5') this.reload();
      else if (k === 'Enter') { if (m.draw) this.drawFinish(); else if (m.mode === 'move') this.moveSave(); else if (m.mode === 'prop') { if (m.man) this.manDone(); else this.propSave(); } else if (m.mode === 'edit') this.saveShape(); }
      else if (k === 'Escape') this.escape();
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && K === 'z') this.undelete();
      else if ((e.ctrlKey || e.metaKey) && K === 'z') m.undo();
      else if ((e.ctrlKey || e.metaKey) && K === 'd') this.scanNavrh();
      else if (k === 'Delete') { if (m.mode === 'edit' && m.sel) this.deleteFeature(); }
      else if (k === 'Backspace') { if (m.draw) m.drawUndo(); else if (m.man) this.manUndo(); else m.deleteVertexAtHover(); }
      else if (k === 'Insert') this.newFeature();
      else if (k === 'F3') this.open3d();
      else if (k === 'F4') this.openLayout();
      else if (k === 'F6') this.openNalezy();
      else if (e.ctrlKey || e.metaKey || e.altKey) done = false;
      else if (K === 'e') { if (m.mode === 'prop') this.propVertices(); else this.setMode(m.mode === 'edit' ? 'view' : 'edit'); }
      else if (K === 'm') this.moveStart();
      else if (K === 'j') this.autoFit();
      else if (K === 'u') this.detectDr();
      else if (k === 'W') this.zladitVsetky();
      else if (K === 'w') this.zladit(false);
      else if (K === 'y' && m.mode === 'prop') this.manStart('kresba');
      else if (K === 't' && m.mode === 'prop') this.manStart('body');
      else if (k === ']' && m.mode === 'edit') m.cycleSel(1);
      else if (k === '[' && m.mode === 'edit') m.cycleSel(-1);
      else if (K === 'f') m.fit();
      else if (K === 'v') { m.vmode = { dr: 'all', all: 'none', none: 'dr' }[m.vmode]; this.renderViewTools(); m.request(); }
      else if (K === 'b') { m.pmode = { on: 'labels', labels: 'off', off: 'on' }[m.pmode]; this.renderViewTools(); m.request(); }
      else if (K === 'c') { m.ctxFill = !m.ctxFill; this.renderViewTools(); m.request(); }
      else if (K === 'o') { m.opacity = { 1: 0.6, 0.6: 0.3, 0.3: 0, 0: 1 }[m.opacity] ?? 1; this.renderViewTools(); m.request(); }
      else if (k === 'H') this.hotovo('grave');
      else if (K === 'h') this.hotovo('dr');
      else if (K === 'l') this.changeDr();
      else if (K === 'i') this.editAttrs();
      else if (K === 'k') this.gcp();
      else if (K === 'p') this.measure();
      else if (K === 'n') this.rectify();
      else if (K === 'r') this.scanRez();
      else if (K === 'd') this.scanDr();
      else if (K === 't' && m.draw) { m.draw.trace = !m.draw.trace; this.traceOn = m.draw.trace; m.draw.last = null; this.onMapState(); }
      else if (k === '+' || k === '=') { if (m.sel && m.mode === 'edit') m.transformSel(1.02); else m.zoomAt(m.cw / 2, m.ch / 2, 1.4); }
      else if (k === '-') { if (m.sel && m.mode === 'edit') m.transformSel(1 / 1.02); else m.zoomAt(m.cw / 2, m.ch / 2, 0.7); }
      else if (k === '?') this.help();
      else done = false;
      if (done) e.preventDefault();
    });
  }
  async escape() {
    const m = this.map;
    this.hideCard();
    if (m.draw) { m.draw = null; this.onMapState(); m.request(); return; }
    if (m.mode === 'pick') { m.setMode('view'); this.status('Výber zrušený.'); return; }
    if (m.mode === 'prop' && m.man) { m.man = null; this.onMapState(); m.request(); this.status('Ručná oprava zrušená.'); return; }
    if (m.mode === 'move' || m.mode === 'prop') { m.setMode('view'); return; }
    if (m.mode === 'edit' && m.sel) {
      if (m.sel.dirty && !(await this.askDiscard())) return;
      m.select(null); return;
    }
    if (m.mode === 'edit') m.setMode('view');
  }
  help() {
    infoBox('Ovládanie', [
      'MYŠ: koliesko = zoom · ťahanie = posun · pravé/stredné ťahanie = posun · dvojklik = priblížiť',
      'DOTYK: 1 prst = posun (v režime „len pero“), 2 prsty = posun + zoom',
      'PERO: ťuk = výber / vrchol · ťah pri kreslení = voľná čiara · tlačidlo pera na vrchole = zmazať vrchol',
      '',
      '←/→ (PgUp/PgDn) hrob · ↑/↓ DR · Tab / Shift+Tab sken · F celý hrob · F5 načítať znova',
      'E úprava tvaru · Insert nový prvok · Enter uložiť / dokončiť · Esc zrušiť · Ctrl+Z späť · Delete zmazať prvok',
      'Backspace = zmazať vrchol pod kurzorom (pri kreslení = späť) · Shift+ťahanie = posun prvku · Shift+koliesko = mierka · Alt+koliesko = rotácia',
      'T trasovanie pri kreslení · L DR prvku · I atribúty · H DR hotová · Shift+H hrob hotový · Ctrl+D prijať návrh DR',
      'V vektory · B body · C výplň kontextov · O priehľadnosť skenu',
      'K georeferencovať sken na body z merania · P pokrčenie · N narovnať · R plán/rez · D DR skenu',
      'M posun vektorov DR (Shift+ťahanie = rotácia) · J auto fit · U ku ktorej DR patrí plán · W návrh zladenia s kresbou (T body, Y prekresliť, E vrcholy) · Shift+W hromadne',
      '[ / ] predchádzajúci / ďalší prvok v úprave',
      'F3 3D · F4 layout · F6 súpis nálezov'].join('\n'));
  }

  // ------------------------------------------------------------------ úpravy tvaru
  async saveShape() {
    const m = this.map;
    if (!m.sel) return;
    try {
      const r = await api('/api/shape/save', { g: this.G.g, dr: this.dr, key: m.sel.key, rings: m.sel.rings });
      m.sel.dirty = false; m.sel.undo = [];
      toast(r.msg, 'ok'); this.status(r.msg);
      await this.refreshGrave(true);
      const ft = m.featByKey.get(m.sel && m.sel.key);
      if (ft) m.select(ft);
      this.refreshList();
    } catch (e) { /* toast */ }
  }
  async discardShape() {
    const m = this.map;
    if (!m.sel) return;
    const ft = m.sel.ft;
    if (ft.new && !(await confirmBox(`Zmazať nový prvok ${ft.layer} (ešte nie je v GDB)?`, 'Zmazať', 'Nie', true))) return;
    if (!ft.new && ft.src !== 'vedit' && !m.sel.dirty) { this.status('Prvok nemá uložený upravený tvar.'); return; }
    if (!ft.new && ft.src !== 'vedit') { m.select(ft); return; }
    const r = await api('/api/shape/discard', { g: this.G.g, dr: this.dr, key: ft.k });
    toast(r.msg, 'ok');
    const key = ft.k;
    m.sel = null;
    await this.refreshGrave(true);
    const nf = m.featByKey.get(key);
    if (nf) m.select(nf);
    this.onMapState();
  }
  async snapShape() {
    const m = this.map;
    if (!m.sel) return;
    const sid = m.scanForSnap();
    if (!sid) { this.status('Prichytenie potrebuje georeferencovaný sken.'); return; }
    this.status('Odstraňujem sieť a hľadám čiary kresby… (prvýkrát niekoľko sekúnd)');
    try {
      const r = await api('/api/shape/snap', { g: this.G.g, scan: sid, rings: m.sel.rings });
      m.pushUndo();
      m.sel.rings = r.rings.map(x => ({ ...x }));
      m.request();
      this.status('Obrys prichytený na kresbu (do 2 cm). Skontroluj, uprav vrcholy, 💾 = uložiť, ↶ = späť.');
      this.onMapState();
    } catch (e) { /* */ }
  }
  async deleteFeature() {
    const m = this.map;
    if (!m.sel) { this.status('Zmazanie: v úprave vyber prvok, potom 🗑.'); return; }
    const ft = m.sel.ft;
    const txt = `${ft.layer} ${ft.new ? 'nový prvok' : 'OID ' + ft.fid}${ft.label ? ' (' + ft.label + ')' : ''}`;
    if (!(await confirmBox(`Zmazať ${txt}?\n\n${ft.new ? 'Nový prvok sa len zahodí.' : 'Z GDB ho odstráni nástroj 6 (so zálohou); dovtedy sa dá obnoviť (Obnoviť zmazaný / Ctrl+Shift+Z).'}`, 'Zmazať', 'Zrušiť', true))) return;
    const r = await api('/api/feature/delete', { g: this.G.g, dr: this.dr, key: ft.k });
    m.sel = null;
    toast(r.msg, 'ok');
    await this.refreshGrave(true);
    this.onMapState();
  }
  async undelete() {
    if (!this.G) return;
    const r = await api('/api/feature/undelete', { g: this.G.g });
    toast(r.msg, 'ok');
    if (!r.reload) await this.refreshGrave(true);
  }

  // ------------------------------------------------------------------ nový prvok
  async newFeature() {
    if (!this.G) return;
    const m = this.map;
    if (m.sel && m.sel.dirty && !(await this.askDiscard())) return;
    const layers = this.layers || [];
    const actDef = (this.layers || []).find(l => l.name === this.map.activeLayer && l.drawable);
    let cur = actDef ? actDef.name : (this.lsGet('lastLayer') || 'ULOZENINY');
    let info = null;
    const lay = el('div', { class: 'layers' }), form = el('div', { class: 'form' });
    const md = modal(`Nový prvok – hrob ${this.G.g}`, { cls: 'wide', onEnter: () => ok() });
    md.body.append(el('div', { class: 'lbl' }, 'Do ktorej vrstvy?'), lay, form,
      el('div', { class: 'hint' }, '⟲ auto = doplní sa podľa hrobu a DR, v ktorej prvok dokončíš (ak pole nezmeníš).'));
    const show = async () => {
      lay.innerHTML = '';
      for (const l of layers.filter(x => x.drawable !== false)) lay.append(el('button', { class: 'chip' + (l.name === cur ? ' cur' : ''), onclick: () => { cur = l.name; show(); } },
        el('span', { style: { width: '12px', height: '12px', borderRadius: '3px', background: l.color, display: 'inline-block', border: '1px solid #888' } }), l.name));
      form.innerHTML = '';
      try { info = await api('/api/layer', { g: this.G.g, dr: this.dr, layer: cur }); } catch (e) { info = null; return; }
      form.append(el('b', { style: { gridColumn: '1 / -1' } }, `${info.layer} – ${{ polygon: 'polygón', linia: 'línia' }[info.typ] || info.gtype}${info.z3d ? ', s výškou Z' : ''}`));
      if (!info.typ) { form.append(el('div', { style: { gridColumn: '1 / -1' } }, 'Tento typ geometrie sa nedá kresliť.')); return; }
      for (const f of info.fields) {
        f.inp = el('input', { class: 'inp', value: f.value, inputmode: f.num ? 'decimal' : 'text' });
        form.append(el('label', {}, f.name + (f.num ? ' (číslo)' : '')), f.inp, el('span', { class: 'auto' }, f.auto ? '⟲ auto' : ''));
      }
    };
    const ok = () => {
      if (!info || !info.typ) return;
      const attrs = {}, auto = [];
      for (const f of info.fields) {
        const v = f.inp.value.trim();
        if (v !== '') attrs[f.name] = v;
        if (f.num && v && isNaN(parseFloat(v.replace(',', '.')))) { toast(`Pole ${f.name} musí byť číslo.`, 'error'); return; }
        if (f.auto && v === (f.value || '').trim()) auto.push(f.name);
      }
      this.lsSet('lastLayer', cur);
      md.close(true);
      this.hideCard();
      this.map.startDraw(cur, info.typ, attrs, auto);
      this.status(this.drawByTap ? 'Kresli: ťukaj vrcholy, dvojťuk alebo ✔ = dokončiť (prepínač • Ťukanie / ✍ Ťahom).' : 'Kresli: ťukaj vrcholy alebo ťahaj perom, dvojťuk alebo ✔ = dokončiť.');
    };
    md.foot.append(el('button', { class: 'btn', onclick: () => md.close(null) }, 'Zrušiť'),
      el('button', { class: 'btn primary', onclick: ok }, '✏ Kresliť (Enter)'));
    show();
  }
  async drawFinish() {
    const m = this.map, d = m.draw;
    if (!d) return;
    const need = d.typ === 'polygon' ? 3 : 2;
    if (d.pts.length < need) { this.status(`Na ${need === 3 ? 'polygón' : 'líniu'} treba aspoň ${need} vrcholy.`); return; }
    try {
      const r = await api('/api/feature/new', { g: this.G.g, dr: this.dr, layer: d.layer, typ: d.typ, attrs: d.attrs, auto: d.auto, pts: d.pts });
      m.draw = null;
      toast(r.msg, 'ok');
      await this.refreshGrave(true);
      const ft = m.featByKey.get(r.key);
      if (ft) m.select(ft);
      this.onMapState();
    } catch (e) { /* */ }
  }

  // ------------------------------------------------------------------ DR prvku (L) a atribúty (I)
  selKeys() { return this.map.sel ? [this.map.sel.key] : null; }
  changeDr() {
    const k = this.selKeys();
    if (k) return this.drDialog(k);
    this.hideCard();
    this.map.setMode('pick');
    this.map.pick = { kind: 'dr' };
    this.onMapState();
  }
  editAttrs() {
    const k = this.selKeys();
    if (k) return this.attrDialog(k);
    this.hideCard();
    this.map.setMode('pick');
    this.map.pick = { kind: 'attr' };
    this.onMapState();
  }
  onPicked(kind, fts) {
    this.map.setMode('view');
    const keys = fts.map(f => f.k);
    if (kind === 'dr') this.drDialog(keys); else this.attrDialog(keys);
  }
  async drDialog(keys) {
    let info;
    try { info = await api('/api/dr/get', { g: this.G.g, dr: this.dr, keys }); } catch (e) { return; }
    const md = modal(keys.length === 1 ? `DR prvku ${keys[0].replace('|', ' OID ')}` : `DR ${info.keys.length} prvkov`, { onEnter: () => save(false) });
    const boxes = {};
    const checks = el('div', { class: 'checks' });
    for (const dr of info.drs) {
      boxes[dr] = el('input', { type: 'checkbox' });
      boxes[dr].checked = info.common.includes(dr);
      checks.append(el('label', {}, boxes[dr], dr));
    }
    const ine = el('input', { class: 'inp', value: info.ine, placeholder: 'napr. 5/6', style: { width: '140px' } });
    md.body.append(el('div', { class: 'pre' }, info.info), el('div', { class: 'lbl' }, 'DR hrobu'), checks,
      el('div', { class: 'lbl' }, 'iná DR'), ine, el('div', { class: 'hint' }, 'Viac DR naraz = prvok patrí do viacerých úrovní (zapíše sa „2/3, 3/4“).'));
    const save = async revert => {
      const drs = Object.keys(boxes).filter(d => boxes[d].checked);
      try {
        const r = await api('/api/dr/save', { g: this.G.g, dr: this.dr, keys: info.keys, drs, ine: ine.value, revert });
        md.close(true); toast(r.msg, 'ok');
        await this.refreshGrave(true); this.onMapState();
      } catch (e) { /* */ }
    };
    if (info.revert) md.foot.append(el('button', { class: 'btn left', onclick: () => save(true) }, 'Vrátiť pôvodné'));
    md.foot.append(el('button', { class: 'btn', onclick: () => md.close(null) }, 'Zrušiť'),
      el('button', { class: 'btn primary', onclick: () => save(false) }, 'Uložiť (Enter)'));
  }
  async attrDialog(keys) {
    let info;
    try { info = await api('/api/attrs/get', { g: this.G.g, dr: this.dr, keys }); } catch (e) { return; }
    if (!info.fields.length) { toast('Vybrané prvky nemajú spoločné atribúty.', 'warn'); return; }
    const md = modal('Atribúty – ' + info.head.split(':')[0], { cls: 'wide', onEnter: () => save() });
    md.body.append(el('div', { class: 'pre' }, info.head + (keys.length > 1 ? '\nZobrazené sú spoločné polia; „(rôzne)“ = hodnoty sa líšia – zmení sa len pole, ktoré prepíšeš.' : '')));
    if (info.supis) md.body.append(el('div', { class: 'pre small', style: { background: '#f5f0ff', padding: '8px', borderRadius: '8px', margin: '8px 0' } }, info.supis));
    const form = el('div', { class: 'form' });
    for (const f of info.fields) {
      f.inp = el('input', { class: 'inp', value: f.value, inputmode: f.num ? 'decimal' : 'text', placeholder: f.mixed ? '(rôzne)' : '' });
      form.append(el('label', {}, f.name + (f.num ? ' (číslo)' : '')), f.inp,
        el('span', { class: 'note' }, f.mixed ? '(rôzne)' : f.pending ? '* neuložené do GDB' : ''));
    }
    md.body.append(form);
    const save = async () => {
      const ch = {};
      for (const f of info.fields) if (f.inp.value.trim() !== f.value.trim()) ch[f.name] = f.inp.value.trim();
      if (!Object.keys(ch).length) { md.close(null); this.status('Atribúty bez zmeny.'); return; }
      try {
        const r = await api('/api/attrs/save', { g: this.G.g, dr: this.dr, keys, changes: ch });
        md.close(true); toast(r.msg, 'ok');
        await this.refreshGrave(true); this.onMapState();
      } catch (e) { /* */ }
    };
    md.foot.append(el('button', { class: 'btn', onclick: () => md.close(null) }, 'Zrušiť'),
      el('button', { class: 'btn primary', onclick: save }, 'Uložiť (Enter)'));
  }

  // ------------------------------------------------------------------ M posun DR, J auto fit, U zistiť DR
  moveBody() {
    const e = this.map.mv;
    return { g: e.g, dr: e.dr, dx: e.dx, dy: e.dy, rot: e.rot, cx: e.cx, cy: e.cy, keys: [...e.keys], fit: e.fit,
      scan: this.curScan() ? this.curScan().id : null };
  }
  async moveStart() {
    if (!this.G) return;
    const m = this.map;
    if (m.mode === 'move') { m.setMode('view'); return; }
    if (m.sel && m.sel.dirty && !(await this.askDiscard())) return;
    let ed;
    try { ed = await api('/api/move/open', { g: this.G.g, dr: this.dr }); } catch (e) { return; }
    this.hideCard();
    m.setMode('move');
    m.mv = { ...ed, keys: new Set(ed.keys), rotMode: false };
    this.onMapState(); m.request();
    this.status(ed.ulozena ? 'Načítaná uložená (ešte neaplikovaná) korekcia DR.' : 'Ťahaj vektory DR na kresbu, alebo J = auto fit.');
  }
  async moveSave() {
    const m = this.map;
    if (m.mode !== 'move' || !m.mv) return;
    try {
      const r = await api('/api/move/save', this.moveBody());
      toast(r.msg, 'ok'); m.setMode('view');
      await this.refreshGrave(true);
    } catch (e) { /* */ }
  }
  async moveScan() {
    const m = this.map, e = m.mv, s = this.curScan();
    if (!e || !s || !s.wt) { this.status('Aktuálny sken nemá world file – nemám čo posunúť.'); return; }
    if (!(await confirmBox(`Prepísať georeferenciu skenu ${s.name} tak, aby kresba sedela na vektoroch (dx ${(e.dx * 100).toFixed(1)} cm, dy ${(e.dy * 100).toFixed(1)} cm, rot ${e.rot.toFixed(2)}° – opačne)?`, 'Prepísať georeferenciu'))) return;
    try {
      const r = await api('/api/move/scan', this.moveBody());
      toast(r.msg, 'ok'); m.setMode('view');
      await this.afterGeoref();
    } catch (err) { /* */ }
  }
  async autoFit() {
    const s = this.curScan();
    if (!s || !s.wt) { this.status('Auto fit potrebuje georeferencovaný sken (najprv A / G / K).'); return; }
    if (this.map.mode !== 'move') await this.moveStart();
    const m = this.map;
    if (m.mode !== 'move' || !m.mv) return;
    let r;
    try { r = await runJob(`Auto fit – ${this.G.g} DR ${this.dr}`, { kind: 'autofit', ...this.moveBody() }, { autoClose: true }); } catch (e) { return; }
    if (m.mv) { Object.assign(m.mv, { dx: r.dx, dy: r.dy, rot: r.rot, fit: r.fit }); this.onMapState(); m.request(); }
    this.status(r.msg);
  }
  async detectDr() {
    const s = this.curScan();
    if (!s || !s.wt) { this.status('Zistenie DR potrebuje georeferencovaný sken.'); return; }
    let r;
    try { r = await runJob(`Ku ktorej DR patrí plán ${s.name}`, { kind: 'detect_dr', g: this.G.g, scan: s.id }, { autoClose: true }); } catch (e) { return; }
    if (await confirmBox(`Plán ${r.name} – zhoda kresby s vektormi jednotlivých DR:\n\n${r.lines.join('\n')}\n\n${r.msg}\n\nNastaviť plánu DR ${r.best}?`, `Nastaviť DR ${r.best}`)) {
      if (this.map.mode === 'move') this.map.setMode('view');
      const x = await api('/api/scan/dr', { g: this.G.g, scan: s.id, value: r.best });
      toast(x.msg, 'ok');
      await this.showGrave(this.G.g, x.dr, true);
      this.selectScanId(s.id);
    }
  }

  // ------------------------------------------------------------------ W návrh zladenia s kresbou
  async zladit(force) {
    if (!this.G) return;
    const m = this.map;
    if (m.mode === 'prop' && !force) { m.setMode('view'); return; }
    if (m.sel && m.sel.dirty && !(await this.askDiscard())) return;
    let r;
    try { r = await api('/api/navrh/get', { g: this.G.g, dr: this.dr, scan: this.curScan() ? this.curScan().id : null, force }); } catch (e) { return; }
    if (r.need) {
      try { r = await runJob(`Zladenie ${this.G.g} DR ${this.dr} s kresbou`, { kind: 'zladit', g: this.G.g, dr: this.dr, scan: r.scan }, { autoClose: true }); } catch (e) { return; }
    }
    this.propOpen(r.navrh);
  }
  propOpen(n) {
    const m = this.map;
    this.hideCard();
    if (n.dr !== this.dr) { this.dr = n.dr; this.si = 0; this.updateScan(); }
    m.setMode('prop');
    m.prop = { ...n, items: new Map(n.items.map(it => [it.key, it])), sel: null };
    m.man = null;
    const sc = n.items.length ? null : 'V návrhu nie sú prvky.';
    this.status(sc || `Návrh zladenia (${n.datum}): zelené = nový tvar (sivá bodkovaná = pôvodný), červené = ponechá sa. Ťuk na prvok = prijať/ponechať · 💾 = uložiť prijaté.`);
    this.onMapState(); m.request();
    this.refreshList();
  }
  propItemAt(X, Y) {
    const m = this.map;
    return m.featuresAt(X, Y).filter(f => m.prop.items.has(f.k))[0] || null;
  }
  propTap(X, Y, o) {
    const m = this.map, p = m.prop;
    if (!p) return;
    if (m.man) { this.manClick(X, Y, o); return; }
    const ft = this.propItemAt(X, Y);
    if (!ft) return;
    const it = p.items.get(ft.k);
    it.accept = !it.accept;
    p.sel = ft.k;
    this.status(`${it.vrstva} OID ${it.fid}: ${it.accept ? 'PRIJATÉ' : 'ponechané pôvodné'} (${it.stav}, zhoda ${(it.pred[1] * 100).toFixed(0)} % → ${(it.po[1] * 100).toFixed(0)} %; ${(it.kroky || []).join('; ') || '—'})`);
    this.onMapState(); m.request();
  }
  propAll(val) {
    const p = this.map.prop;
    if (!p) return;
    for (const it of p.items.values()) it.accept = !!val && it.stav !== 'sedi';
    this.onMapState(); this.map.request();
  }
  async propSave() {
    const p = this.map.prop;
    if (!p) return;
    const accept = {};
    for (const [k, it] of p.items) accept[k] = it.accept;
    try {
      const r = await api('/api/navrh/save', { g: p.hrob, dr: p.dr, accept });
      toast(r.msg, 'ok');
      this.map.setMode('view');
      await this.refreshGrave(true); this.refreshList();
    } catch (e) { /* */ }
  }
  // ---- ručná oprava (T lícovacie body / Y prekresliť)
  async manStart(mode) {
    const m = this.map, p = m.prop;
    if (!p) { this.status('Ručná oprava funguje v návrhu zladenia (najprv W).'); return; }
    if (m.man && m.man.mode === mode) { m.man = null; this.onMapState(); m.request(); return; }
    m.man = { mode, key: mode === 'kresba' || !p.sel ? (mode === 'kresba' ? p.sel : p.sel) : p.sel, pairs: [], pend: null, pts: [], geom: new Map(), snap: false, whole: false, info: '' };
    if (mode === 'kresba') m.man.key = p.sel || null;
    try {
      const r = await api('/api/navrh/scan', { g: p.hrob, dr: p.dr });
      m.man.scan = r.scan;
      if (r.scan) {
        const st = await api('/api/ink/prepare', { g: p.hrob, scan: r.scan }, { quiet: true });
        m.inkState = st.state;
        const poll = async () => {
          if (!m.man || m.inkState === 'ok' || String(m.inkState).startsWith('chyba')) return;
          const x = await api('/api/ink/prepare', { g: p.hrob, scan: r.scan }, { quiet: true });
          m.inkState = x.state; this.onMapState(); setTimeout(poll, 1500);
        };
        setTimeout(poll, 1200);
      }
    } catch (e) { /* */ }
    this.onMapState(); m.request();
  }
  manKeys() {
    const m = this.map, mm = m.man;
    if (mm.mode === 'body' && mm.whole) return [...m.prop.items.keys()];
    return mm.key ? [mm.key] : [];
  }
  async snapInk(w, alt) {
    const m = this.map, mm = m.man;
    if (alt || m.noSnap || !mm || !mm.scan || m.inkState !== 'ok') return w;
    try {
      const r = await api('/api/ink/snap', { g: this.G.g, scan: mm.scan, pts: [w], maxd: 10 / m.view.s }, { quiet: true });
      return (r.pts && r.pts[0]) || w;
    } catch (e) { return w; }
  }
  nearestOn(keys, w) {
    const m = this.map;
    let best = w, bd = Infinity;
    for (const k of keys) {
      const ft = m.featByKey.get(k);
      if (!ft) continue;
      for (const poly of ft.geom) for (const r of poly) for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i], [bx, by] = r[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((w[0] - ax) * dx + (w[1] - ay) * dy) / L2)) : 0;
        const q = [ax + t * dx, ay + t * dy], d = (q[0] - w[0]) ** 2 + (q[1] - w[1]) ** 2;
        if (d < bd) { bd = d; best = q; }
      }
    }
    return Math.sqrt(bd) * m.view.s <= 15 ? best : w;
  }
  async manClick(X, Y, o = {}) {
    const m = this.map, mm = m.man;
    if (!mm) return;
    const w = m.c2w(X, Y);
    if (!mm.key && !(mm.mode === 'body' && mm.whole)) {
      const ft = this.propItemAt(X, Y);
      if (ft) { mm.key = ft.k; m.prop.sel = ft.k; }
      this.onMapState(); m.request(); return;
    }
    if (mm.mode === 'body') {
      if (!mm.pend) mm.pend = this.nearestOn(this.manKeys(), w);
      else { const pend = mm.pend; mm.pend = null; mm.pairs.push([pend, await this.snapInk(w, o.alt)]); this.manApply(); }
    } else { mm.pts.push(await this.snapInk(w, o.alt)); this.manApply(); }
    this.onMapState(); m.request();
  }
  manStroke(Q) {
    const mm = this.map.man;
    if (!mm || mm.mode !== 'kresba' || !mm.key) return;
    mm.pts.push(...Q); this.manApply(); this.onMapState(); this.map.request();
  }
  manApply() {
    const m = this.map, mm = m.man;
    mm.geom = new Map(); mm.snap = false;
    if (mm.mode === 'body') {
      mm.info = '';
      if (!mm.pairs.length) return;
      const S = mm.pairs.map(p => p[0]), D = mm.pairs.map(p => p[1]);
      const T = similarity(S, D);
      mm.info = `rot ${T.rot >= 0 ? '+' : ''}${T.rot.toFixed(2)}°, mierka ${T.sc.toFixed(3)}${S.length > 2 ? `, odchýlka párov ${(T.rms * 100).toFixed(1)} cm` : ''}`;
      for (const k of this.manKeys()) {
        const ft = m.featByKey.get(k);
        if (ft) mm.geom.set(k, ft.geom.map(poly => poly.map(r => r.map(([x, y]) => [T.a * x - T.b * y + T.tx, T.b * x + T.a * y + T.ty]))));
      }
    } else if (mm.pts.length >= 2) {
      let P = mm.pts.map(p => p.slice());
      const it = m.prop.items.get(mm.key);
      if (it.closed && P.length >= 3) P = P.concat([P[0]]);
      mm.geom.set(mm.key, [[P]]);
    }
  }
  manUndo() {
    const mm = this.map.man;
    if (!mm) return;
    if (mm.mode === 'body') { if (mm.pend) mm.pend = null; else mm.pairs.pop(); }
    else mm.pts.pop();
    this.manApply(); this.onMapState(); this.map.request();
  }
  async manSnap() {
    const m = this.map, mm = m.man;
    if (!mm || !mm.geom.size) { this.status('Najprv ručne posuň / nakresli prvok.'); return; }
    if (m.inkState !== 'ok') { this.status('Čiary kresby sa ešte pripravujú, skús o chvíľu.'); return; }
    for (const [k, geom] of mm.geom) {
      const closed = m.prop.items.get(k).closed;
      const rings = [];
      geom.forEach(poly => poly.forEach((r, i) => {
        let R = r;
        if (closed && R.length > 1 && R[0][0] === R[R.length - 1][0] && R[0][1] === R[R.length - 1][1]) R = R.slice(0, -1);
        rings.push({ pts: R, closed, hole: i > 0 });
      }));
      try {
        const res = await api('/api/shape/snap', { g: this.G.g, scan: mm.scan, rings });
        const out = [];
        for (const r of res.rings) { const P = closed ? r.pts.concat([r.pts[0]]) : r.pts; if (r.hole && out.length) out[out.length - 1].push(P); else out.push([P]); }
        mm.geom.set(k, out);
      } catch (e) { return; }
    }
    mm.snap = true;
    this.status('Prichytené na kresbu – skontroluj; ✔ Hotovo, ↶ Späť k ručnému.');
    this.onMapState(); m.request();
  }
  async manDone() {
    const m = this.map, mm = m.man;
    if (!mm) return;
    if (!mm.geom.size) { m.man = null; this.onMapState(); m.request(); return; }
    const n = mm.mode === 'body' ? mm.pairs.length : mm.pts.length;
    const krok = `ručne ${n} ${mm.mode === 'body' ? 'párov bodov' : 'vrcholov'}${mm.snap ? '; prichytené' : ''}`;
    const geoms = {};
    for (const [k, g] of mm.geom) geoms[k] = g;
    try {
      const r = await api('/api/navrh/item', { g: m.prop.hrob, dr: m.prop.dr, geoms, krok });
      for (const it of r.items) m.prop.items.set(it.key, it);
      m.man = null;
      this.status(`Ručná oprava prevzatá do návrhu (${krok}). 💾 = uložiť prijaté do úprav.`);
      this.onMapState(); m.request();
    } catch (e) { /* */ }
  }
  async propVertices() {
    const m = this.map, p = m.prop;
    if (!p) return;
    const key = (m.man && m.man.key) || p.sel;
    const it = key && p.items.get(key);
    if (!it) { this.status('Najprv ťukni na prvok návrhu, potom „Vrcholy“.'); return; }
    const ft = m.featByKey.get(key);
    await api('/api/navrh/drop', { g: p.hrob, dr: p.dr, key });
    m.setMode('edit');
    if (!ft) return;
    m.select(ft);
    if (it.accept) {
      const rings = [];
      it.geom.forEach(poly => poly.forEach((r, i) => {
        let P = r.map(q => q.slice());
        if (it.closed && P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P = P.slice(0, -1);
        rings.push({ pts: P, closed: !!it.closed, hole: i > 0 });
      }));
      m.sel.rings = rings; m.sel.dirty = true;
    }
    this.onMapState(); m.request();
    this.status('Vrcholy prvku z návrhu – uprav, 💾 = uložiť tvar. Ostatné prvky DR: W otvorí návrh znova.');
  }
  async zladitVsetky() {
    let info;
    try { info = await api('/api/navrh/batch', { g: this.G ? this.G.g : null }); } catch (e) { return; }
    const run = (await api('/api/state', undefined, { quiet: true })).jobs.find(j => j.title.startsWith('Hromadné zladenie') && j.state === 'run');
    if (run) {
      if (await confirmBox('Hromadné zladenie beží. Zastaviť ho po aktuálnej DR?', 'Zastaviť')) {
        await api('/api/job/start', { kind: 'zladit_vsetky' }); toast('Zastavujem po aktuálnej DR…');
      } else followJob('Hromadné zladenie vektorov s plánmi', run.id).catch(() => {});
      return;
    }
    if (!info.n) { infoBox('Hromadné zladenie', 'Žiadna DR s vektormi a georeferencovaným plánom.'); return; }
    if (!(await confirmBox(`Porovnať vektory s kresbou pre ${info.n} DR (hroby s georeferencovaným plánom)?\nHotové z minula: ${info.hotove} (preskočia sa).\nOdhad: ~10–30 s na DR, beží na pozadí; zastaví sa opätovným spustením (Shift+W).\n\nVýsledok: filter „nezhody (návrhy W)“ a nezhody_report.csv.`, 'Spustiť'))) return;
    runJob('Hromadné zladenie vektorov s plánmi', { kind: 'zladit_vsetky' }).then(() => this.refreshList()).catch(() => {});
  }

  // ------------------------------------------------------------------ hotovo, dno, sken
  async hotovo(what) {
    if (!this.G) return;
    try {
      const r = await api('/api/hotovo', { g: this.G.g, dr: this.dr, what });
      toast(r.msg, 'ok');
      await this.refreshGrave(true); this.refreshList();
    } catch (e) { /* */ }
  }
  async prazdna() {
    if (!this.G) return;
    try {
      const r = await api('/api/prazdna', { g: this.G.g, dr: this.dr });
      toast(r.msg, 'ok');
      await this.refreshGrave(true);
    } catch (e) { /* */ }
  }
  async dno() {
    const r = await api('/api/dno', { g: this.G.g, dr: this.dr });
    toast(r.msg, 'ok');
    await this.refreshGrave(true);
  }
  async scanDr() {
    const s = this.curScan();
    if (!s) return;
    const drs = this.G.drs.map(d => d.dr).filter(d => !isSpecDr(d));
    const v = await promptBox('DR skenu', `DR pre ${s.name} (napr. 1/2; prázdne = podľa nivelácie)`, s.dr || '', 'DR hrobu: ' + (drs.join(', ') || '—'));
    if (v === null) return;
    try {
      const r = await api('/api/scan/dr', { g: this.G.g, scan: s.id, value: v });
      toast(r.msg, 'ok');
      await this.showGrave(this.G.g, r.dr, true);
      this.selectScanId(s.id);
    } catch (e) { /* */ }
  }
  async scanRez() {
    const s = this.curScan();
    if (!s) return;
    const r = await api('/api/scan/rez', { g: this.G.g, scan: s.id });
    toast(r.msg, 'ok');
    await this.showGrave(this.G.g, r.dr, true);
    this.selectScanId(s.id);
  }
  async scanNavrh() {
    const s = this.curScan();
    if (!s) return;
    try {
      const r = await api('/api/scan/navrh', { g: this.G.g, scan: s.id });
      toast(r.msg, 'ok');
      await this.showGrave(this.G.g, r.dr, true);
      this.selectScanId(s.id);
    } catch (e) { /* */ }
  }
  selectScanId(id) {
    for (const d of this.G.drs) {
      const i = d.scans.indexOf(id);
      if (i >= 0) { this.dr = d.dr; this.si = i; this.updateScan(); return; }
    }
  }

  // ------------------------------------------------------------------ georeferencovanie a úlohy
  nextRez(s) {
    const done = new Set((s.szs || []).map(p => p.rez));
    const prof = Object.keys((this.G && this.G.profily) || {});
    return (s.rezy || []).concat(prof, ['AB', 'CD', 'EF', 'GH']).find(r => !done.has(r)) || 'AB';
  }
  async gcp(rez) {
    const s = this.curScan();
    if (!s) { this.status('Vyber sken, ktorý chceš georeferencovať na body.'); return; }
    const mod = await import('./gcp.js');
    if (s.typ === 'rez') mod.openRezGeo(this, s, typeof rez === 'string' ? rez : (s.sz && this.map.isProf() ? s.sz.rez : null)); else mod.openGcp(this, s);
  }
  async afterGeoref(rez) {
    const s = this.curScan();
    if (s && rez) this.rezSel = { ...(this.rezSel || {}), [s.id]: rez };
    if (s) { this.map.tiles.forget(s.id); }
    await this.refreshGrave(true);
    if (s) this.selectScanId(s.id);
    this.refreshList();
  }
  async measure() {
    if (!this.G) return;
    let r;
    try { r = await runJob(`Pokrčenie plánov – ${this.G.g}`, { kind: 'measure', g: this.G.g }, { autoClose: true }); } catch (e) { return; }
    await this.refreshGrave(true);
    if (r.bad && r.bad.length) {
      if (await confirmBox(`Pokrčené nad 0,3 mm:\n${r.bad.map(b => `${b.name}  ${b.deform.toFixed(2)} mm`).join('\n')}\n\nNarovnať ich všetky teraz?`, 'Narovnať')) {
        this.rectifyList(r.bad.map(b => b.id));
      }
    } else toast(r.msg, 'ok');
  }
  async rectify() {
    const s = this.curScan();
    if (!s) return;
    if (s.narovnany) { this.status(`${s.name} je už narovnaný.`); return; }
    const d = s.deform !== null ? ` (pokrčenie ${s.deform.toFixed(2)} mm)` : '';
    if (!(await confirmBox(`Narovnať ${s.name}${d}?\n\nVedľa originálu vznikne <sken>_narovnane, originál dostane typ „nahradene“ a ďalej sa pracuje s narovnaným. Narovnaný sa skúsi automaticky georeferencovať.`, 'Narovnať'))) return;
    this.rectifyList([s.id]);
  }
  async rectifyList(ids) {
    let r;
    try { r = await runJob(`Narovnanie – ${this.G.g}`, { kind: 'rectify', g: this.G.g, scans: ids }); } catch (e) { return; }
    await this.refreshGrave(true);
    if (r.last) this.selectScanId(r.last);
    this.refreshList();
  }
  async exportQgis() {
    const hot = this.graves.filter(r => r.done).map(r => r.g);
    if (!hot.length) { infoBox('Export', 'Žiadny hrob nie je označený ako hotový (H / Shift+H).'); return; }
    if (!(await confirmBox(`Exportovať ${hot.length} hotových hrobov (${hot.slice(0, 12).join(', ')}${hot.length > 12 ? ' …' : ''})?\n\n• QGIS projekt Longobardi\\QGIS_projekt\\Longobardi_hotove_hroby.qgz (na PC sa po dokončení otvorí, ak export spustíš na PC)\n• polygóny pre ArcGIS Pro: QGIS_projekt\\polygony arcgis pro (File GDB + Hotove_hroby.lyrx)\n\nZahrnú sa aj zmeny z katalógu, ktoré ešte nie sú v GDB.`, 'Exportovať'))) return;
    runJob('Export hotových hrobov → QGIS + ArcGIS', { kind: 'export' }).catch(() => {});
  }
  async profily() {
    if (!(await confirmBox('Previesť nakreslené profily rezov do 3D?\n\n• DIGITALIZACE 2024 (MUSOV_2024_DIGITALIZACE.gdb / Profil) – majú prednosť\n• QField 2010 a 2011\n• hroby 2009: staré profily z GDB\n\nVýstup: Longobardi\\profily_3d\\profily_3d.gpkg (+ .gdb) a report.', 'Previesť'))) return;
    runJob('Profily rezov → 3D', { kind: 'profily' }).catch(() => {});
  }
  async reload() {
    if (this.map.sel && this.map.sel.dirty && !(await this.askDiscard())) return;
    await api('/api/reload', {});
    this.map.sel = null; this.map.draw = null;
    this.toast = toast('Načítavam dáta znova…');
    $('loading').classList.remove('hidden');
  }
  async settings() {
    const st = await api('/api/state?list=1&since=' + this.noteT);
    const gdb = el('input', { class: 'inp', value: st.cfg.gdb });
    const sez = el('textarea', { class: 'inp', rows: 7 }, st.cfg.sezony.join('\n'));
    const hl = el('input', { type: 'checkbox' }); hl.checked = !!st.cfg.zvyraznit_neulozene;
    const md = modal('Nastavenia katalógu', { cls: 'wide' });
    md.body.append(el('label', { class: 'lbl' }, 'Geodatabáza'), gdb, el('label', { class: 'lbl' }, 'Priečinky so skenmi (sezóny), jeden na riadok'), sez,
      el('label', { class: 'checks', style: { marginTop: '10px' } }, el('label', {}, hl, 'zvýrazniť upravené tvary (ešte nie v GDB) modrou')),
      st.warn && st.warn.length ? el('div', { class: 'hint pre' }, 'Upozornenia pri načítaní:\n' + st.warn.join('\n')) : null);
    md.foot.append(el('button', { class: 'btn', onclick: () => md.close(null) }, 'Zrušiť'),
      el('button', { class: 'btn', onclick: async () => {
        await api('/api/settings', { zvyraznit_neulozene: hl.checked }); this.map.hlUnsaved = hl.checked; this.map.request(); md.close(true);
      } }, 'Uložiť bez načítania'),
      el('button', { class: 'btn primary', onclick: async () => {
        await api('/api/settings', { gdb: gdb.value, sezony: sez.value.split('\n'), zvyraznit_neulozene: hl.checked, reload: true });
        this.map.hlUnsaved = hl.checked; md.close(true); $('loading').classList.remove('hidden');
      } }, 'Uložiť a načítať znova'));
  }
  async tablet() {
    const st = await api('/api/state?list=1&since=' + this.noteT);
    const lan = (st.lan || []).map(u => ({ u, k: 'wifi', lab: 'Wi-Fi ' + u.split('/')[2].split(':')[0] }));
    const ts = (st.ts || []).map((u, i) => ({ u, k: 'ts', lab: 'Tailscale ' + (i === 0 && st.ts.length > 1 ? u.split('/')[2].split(':')[0].split('.')[0] : u.split('/')[2].split(':')[0]) }));
    const sec = [];
    if (st.ts_https && st.github) sec.push({ u: st.github + '?server=' + encodeURIComponent(st.ts_https), k: 'gh', lab: 'GitHub stránka' });
    if (st.ts_https) sec.push({ u: st.ts_https + '/', k: 'tshttps', lab: 'Tailscale HTTPS' });
    const all = sec.concat(lan, ts);
    if (!all.length) {
      infoBox('Pripojiť tablet', 'QR kód a adresu pre tablet ukáže toto okno len na PC, kde beží server (alebo adresu nájdeš v okne servera).');
      return;
    }
    const { qrSvg } = await import('./qr.js');
    const md = modal('📱 Pripojiť tablet', { cls: 'qrmodal', onEnter: () => md.close(true) });
    const box = el('div', { class: 'qrbox' }), url = el('div', { class: 'qrurl' }), tabs = el('div', { class: 'qrtabs' }), hint = el('div', { class: 'hint' });
    const LOGIN = st.ucty ? ' Prihlásiš sa menom a heslom.' : ' Prihlásenie zatiaľ nie je zapnuté – na PC spusti ucty.bat a vytvor účet.';
    const HINT = {
      gh: 'Stránka z GitHub Pages, dáta idú priamo z tohto PC cez Tailscale (HTTPS). Na tablete musí byť zapnutý Tailscale.' + LOGIN,
      tshttps: 'Stránka priamo z tohto PC cez Tailscale s HTTPS (funguje odkiaľkoľvek, dá sa pridať na plochu ako aplikácia).' + LOGIN,
      wifi: 'Tablet musí byť v tej istej Wi-Fi ako toto PC. Na tablete otvor Fotoaparát alebo Google Lens a namier na kód – otvorí sa katalóg v Chrome, kľúč je v kóde.',
      ts: 'Tailscale – funguje odkiaľkoľvek (aj v teréne cez mobilné dáta). Na tablete nainštaluj aplikáciu Tailscale z Google Play, prihlás sa tým istým účtom ako na PC a zapni ju; potom naskenuj kód. ' +
        'Ak sa stránka nenačíta, spusti raz na PC „povolit_tailscale_firewall.bat“ (povolí port 8765 pre Tailscale vo Windows firewalle).'
    };
    const show = i => {
      const it = all[i];
      box.innerHTML = qrSvg(it.u, Math.max(180, Math.min(300, innerWidth - 80, innerHeight - 360)));
      url.textContent = it.u;
      hint.textContent = HINT[it.k];
      [...tabs.children].forEach((b, j) => b.classList.toggle('on', i === j));
    };
    if (all.length > 1) all.forEach((it, i) => tabs.append(el('button', { class: 'chip mini', onclick: () => show(i), title: it.u }, ({ ts: '🔒 ', tshttps: '🔒 ', gh: '🌐 ' }[it.k] || '📶 ') + it.lab)));
    if (st.ts_dns && !st.ts_https) tabs.append(el('span', { class: 'hint' }, 'HTTPS cez Tailscale (pre GitHub stránku) zapneš na PC: tailscale_https.bat'));
    if (!ts.length) tabs.append(el('span', { class: 'hint' }, st.ts_state ? `Tailscale: ${st.ts_state} – zapni ho na PC.` : 'Tailscale na tomto PC nebeží (nie je nainštalovaný alebo prihlásený).'));
    md.body.append(tabs, box, url, hint,
      el('div', { class: 'hint' }, 'Tip: Chrome ⋮ → „Pridať na plochu“, v aplikácii ⛶ = celá obrazovka.'));
    md.foot.append(
      el('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url.textContent); toast('Adresa skopírovaná'); } }, 'Kopírovať adresu'),
      el('button', { class: 'btn primary', onclick: () => md.close(true) }, 'OK'));
    show(0);
  }
  async open3d() { if (this.G) (await import('./v3d.js')).open3d(this); }
  async openLayout() { if (this.G) (await import('./layout.js')).openLayout(this); }
  async openNalezy() { if (this.G) (await import('./nalezy.js')).openNalezy(this); }
}

// podobnostná transformácia z párov bodov (MNŠ; 1 pár = posun) – ako vektory_fit.similarity_pairs
function similarity(S, D) {
  if (S.length === 1) return { a: 1, b: 0, tx: D[0][0] - S[0][0], ty: D[0][1] - S[0][1], rot: 0, sc: 1, rms: 0 };
  const n = S.length;
  const ms = [0, 1].map(i => S.reduce((a, p) => a + p[i], 0) / n), md = [0, 1].map(i => D.reduce((a, p) => a + p[i], 0) / n);
  let sxx = 0, num_a = 0, num_b = 0;
  for (let i = 0; i < n; i++) {
    const x = S[i][0] - ms[0], y = S[i][1] - ms[1], u = D[i][0] - md[0], v = D[i][1] - md[1];
    sxx += x * x + y * y; num_a += x * u + y * v; num_b += x * v - y * u;
  }
  const a = num_a / (sxx || 1e-12), b = num_b / (sxx || 1e-12);
  const tx = md[0] - (a * ms[0] - b * ms[1]), ty = md[1] - (b * ms[0] + a * ms[1]);
  let r2 = 0;
  for (let i = 0; i < n; i++) { const X = a * S[i][0] - b * S[i][1] + tx - D[i][0], Y = b * S[i][0] + a * S[i][1] + ty - D[i][1]; r2 += X * X + Y * Y; }
  return { a, b, tx, ty, rot: Math.atan2(b, a) * 180 / Math.PI, sc: Math.hypot(a, b), rms: Math.sqrt(r2 / n) };
}

// legenda vrstvy (SVG 34×20) podľa štýlu kreslenia v mape
function legendSvg(d) {
  const c = d.color || '#888';
  const W = 34, H = 20;
  let g;
  if (d.name === 'BODY') g = '<path d="M4 4l8 8M12 4l-8 8" stroke="#e00000" stroke-width="2"/><path d="M15 8h8M19 4v8" stroke="#ff8c00" stroke-width="2"/><path d="M25 4l6 6M31 4l-6 6" stroke="#00a000" stroke-width="2"/>';
  else if (d.name === 'NIVEL_DR') g = '<path d="M11 15h12l-6-11z" fill="#000"/>';
  else if (d.name === 'ULOZENINY') g = '<rect x="3" y="3" width="9" height="14" fill="#3cb44b" fill-opacity=".8"/><rect x="12" y="3" width="10" height="14" fill="#4363d8" fill-opacity=".8"/><rect x="22" y="3" width="9" height="14" fill="#f58231" fill-opacity=".8"/><rect x="3" y="3" width="28" height="14" fill="none" stroke="#7a4a00" stroke-width="2"/>';
  else if (d.kind === 'khh') g = '<rect x="4" y="4" width="26" height="12" rx="3" fill="none" stroke="#000" stroke-width="3"/>';
  else if (d.name === 'KHD_OBEJKT_POLYGON') g = '<rect x="4" y="4" width="26" height="12" rx="3" fill="none" stroke="#505050" stroke-width="3"/>';
  else if (d.kind === 'fill') g = `<rect x="4" y="4" width="26" height="12" fill="${c}" fill-opacity=".6" stroke="#303030"/>`;
  else if (d.kind === 'profil') g = `<path d="M5 10h24" stroke="${c}" stroke-dasharray="4 3"/><path d="M2 10h6M5 7v6M26 10h6M29 7v6" stroke="${c}" stroke-width="2"/>`;
  else if (d.cat === 'polygon') g = `<rect x="4" y="4" width="26" height="12" fill="none" stroke="${c}" stroke-width="2"/>`;
  else g = `<path d="M3 13 Q12 3 18 10 T31 7" fill="none" stroke="${c}" stroke-width="${d.name === 'KHV_LINE' ? 2 : 2}"${d.name === 'KHV_LINE' ? ' stroke-dasharray="6 3"' : ''}/>`;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}
const LAYER_NAMES = { KHH_OBJEKT_POLYGON: 'Horná hrana (KHH)', KHD_OBEJKT_POLYGON: 'Dno (KHD)', KHV_LINE: 'Hrana výkopu (KHV)',
  'RAKEV_ČERNA_ZEM': 'Rakva', ULOZENINY: 'Uloženiny (kontexty)', DR_PR: 'Hranica DR (DR_PR)', KAMEN_NEOPRAC: 'Kamene',
  KOSTL_POLYGON: 'Kosti', KOSTL_LINE: 'Kosti – línie', KERAMIKA: 'Keramika', ZELEZO: 'Železo', BRONZ: 'Bronz', SKLO: 'Sklo',
  DRAHE_KOVY: 'Drahé kovy', NIVEL_DR: 'Nivelácia DR', PROFIL_LINE: 'Rezy A–H' };
function prettyLayer(n) { return LAYER_NAMES[n] || n; }

// kategórie nástrojov v lištách úprav: 1 = hlavné, 2 = bežné, 3 = zriedkavé (pod „Viac“)
const TIERS = {
  edit: { 1: ['Uložiť', 'Späť', 'Zrušiť výber', 'Koniec', 'Nový'], 3: ['Smer', 'Pôvodný', 'Obnoviť', '+2 %', '−2 %'] },
  draw: { 1: ['Dokončiť', 'Späť', 'Zrušiť'], 3: ['Dlhšou', 'Celý obrys'] },
  move: { 1: ['Uložiť', 'Zrušiť', 'Auto fit'], 3: ['Vynulovať', 'Zistiť DR', 'Posunúť sken'] },
  prop: { 1: ['Uložiť prijaté', 'Zrušiť', 'Body', 'Prekresliť'], 3: ['Prepočítať', 'DR'] },
  man: { 1: ['Hotovo', 'Späť', 'Zrušiť'], 3: ['Bez prich.'] },
  pick: { 1: ['Zrušiť'] },
};
function tierOf(mode, lab) {
  const t = TIERS[mode] || {};
  if ((t[1] || []).includes(lab)) return 1;
  if ((t[3] || []).includes(lab)) return 3;
  return 2;
}

connect().then(ok => { if (ok) window.app = new App(); });
