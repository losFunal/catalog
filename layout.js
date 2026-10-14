// layout.js – náhľad layoutu ako v ArcGIS Pro (layout_nahlad.LayoutBuilder na serveri) + nastavenia
import { el, api, apiUrl, toast, runJob, confirmBox } from './ui.js';

const GROUPS = [
  ['Úrovne', null],
  ['Strana a rámy', [
    ['Strana', [['šírka', 'page_w', 'mm'], ['výška', 'page_h', 'mm']], 'page'],
    ['Hlavný plán (A–H)', [['veľkosť rámu', 'komplet_k', '%'], ['posun x', 'komplet_dx', 'mm'], ['posun y', 'komplet_dy', 'mm'], ['mierka 1:', 'komplet_S', '0 = auto']]],
    ['Plány úrovní', [['veľkosť rámu', 'level_k', '%'], ['posun x', 'level_dx', 'mm'], ['posun y', 'level_dy', 'mm'], ['mierka 1:', 'level_S', '0 = auto']]],
    ['Rezy', [['veľkosť rámu', 'profil_k', '%'], ['posun x', 'profil_dx', 'mm'], ['posun y', 'profil_dy', 'mm']]]]],
  ['Škála a severka', [
    ['Grafická mierka', [['dĺžka', 'sb_k', '%'], ['výška pásu', 'sb_h', '%'], ['písmo', 'sb_font', 'pt (0 = šablóna)'], ['posun x', 'sb_dx', 'mm'], ['posun y', 'sb_dy', 'mm']]],
    ['Severka', [['veľkosť', 'north_k', '%'], ['posun x', 'north_dx', 'mm'], ['posun y', 'north_dy', 'mm']]]]],
  ['Popisy a symboly', [
    ['Popis úrovne pod plánom', [['písmo', 'lab_font', 'pt'], ['odstup', 'lab_gap', 'mm']]],
    ['Body rezov A–H (hlavný plán)', [['písmo', 'ah_font', 'pt'], ['krížik', 'ah_cross', 'mm']]],
    ['Symbológia máp', [['hrúbka línií', 'line_k', '%'], ['veľkosť značiek', 'marker_k', '%'], ['popisy v mape', 'maplabel_k', '%']]]]],
];

export async function openLayout(app) {
  const root = el('div', { class: 'screen' });
  const top = el('div', { class: 'screen-top' });
  const top2 = el('div', { class: 'screen-top', style: { background: '#2b3742', minHeight: '46px' } });
  const body = el('div', { class: 'screen-body' });
  root.append(top, top2, body);
  document.body.append(root);
  const viewBox = el('div', { class: 'layout-view' });
  const side = el('div', { class: 'side', style: { width: '340px' } });
  body.append(viewBox, side);
  const st = { g: app.G.g, pg: 0, pages: [], meta: null, plany: false, follow: true, tab: 0, busy: false, again: false };
  const B = (t, fn, ti) => el('button', { class: 'tool', title: ti || '', onclick: fn }, t);
  const lbl = el('span', { class: 't', style: { minWidth: '220px' } }, '');
  const pl = el('input', { type: 'checkbox' }); pl.onchange = () => { st.plany = pl.checked; reload(); };
  const fl = el('input', { type: 'checkbox' }); fl.checked = true; fl.onchange = () => (st.follow = fl.checked);
  top.append(B('◀', () => page(-1), 'PgUp'), lbl, B('▶', () => page(1), 'PgDn'), el('label', { class: 'tool' }, pl, 'plány pod kresbou'),
    el('label', { class: 'tool' }, fl, 'sledovať hrob'), el('span', { class: 'spacer' }),
    B('↻', () => reload(), 'Znovu načítať dáta'), B('⬇ PNG', () => exp('png')), B('⬇ PDF', () => exp('pdf')),
    B('→ ArcGIS (všetky hroby)', () => specAll()), B('⚙ Nastavenia', () => side.classList.toggle('hidden')), B('✕ Zavrieť', () => close(), 'Esc'));
  const rotInp = el('input', { class: 'inp', style: { width: '90px', height: '38px' }, inputmode: 'decimal' });
  rotInp.onchange = () => set({ rot: parseFloat(rotInp.value.replace(',', '.')) || 0 });
  top2.append(el('span', { style: { fontSize: '13px' } }, 'rotácia mapy (°, pre hrob):'));
  for (const [t, d] of [['⟲5', -5], ['⟲½', -0.5], ['⟲⅒', -0.1]]) top2.append(B(t, () => rotate(d)));
  top2.append(rotInp);
  for (const [t, d] of [['⟳⅒', 0.1], ['⟳½', 0.5], ['⟳5', 5]]) top2.append(B(t, () => rotate(d)));
  top2.append(B('0', () => set({ rot: 0 })));
  if (window.innerWidth < 1100) side.classList.add('hidden');

  const onKey = e => {
    if (document.querySelector('.modal-back') || (e.target && e.target.tagName === 'INPUT')) return;
    if (e.key === 'Escape') close(); else if (e.key === 'PageUp') page(-1); else if (e.key === 'PageDown') page(1); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  const prevHook = app.onGraveChanged;
  app.onGraveChanged = g => { if (prevHook) prevHook(g); if (st.follow && g !== st.g) { st.g = g; st.pg = 0; reload(); } };
  function close() { root.remove(); document.removeEventListener('keydown', onKey, true); app.onGraveChanged = prevHook; }
  function page(d) { if (st.pages.length) { st.pg = (st.pg + d + st.pages.length) % st.pages.length; show(); } }
  function rotate(d) { const r = parseFloat(st.meta && st.meta.opt.rot) || 0; set({ rot: Math.round((r + d) * 100) / 100 }); }
  let tmr = null;
  async function set(ch, now = false) {
    await api('/api/layout/set', { g: st.g, changes: ch });
    if (st.meta) Object.assign(st.meta.opt, ch);
    clearTimeout(tmr);
    tmr = setTimeout(() => reload(), now ? 10 : 450);
  }
  async function reload() {
    if (st.busy) { st.again = true; return; }
    st.busy = true;
    lbl.textContent = `${st.g} · kreslím…`;
    try {
      const m = await api('/api/layout', { g: st.g, plany: st.plany });
      st.meta = m; st.pages = m.pages;
      st.pg = Math.min(st.pg, Math.max(0, m.pages.length - 1));
      rotInp.value = Number(m.opt.rot || 0).toFixed(2);
      show(); panel();
    } catch (e) { lbl.textContent = st.g + ' · chyba'; viewBox.innerHTML = ''; viewBox.append(el('div', { class: 'pre', style: { background: '#fff', padding: '12px', borderRadius: '10px' } }, e.message)); }
    st.busy = false;
    if (st.again) { st.again = false; reload(); }
  }
  function show() {
    viewBox.innerHTML = '';
    if (!st.pages.length) { lbl.textContent = '(žiadny hrob)'; return; }
    viewBox.append(el('img', { src: apiUrl(st.pages[st.pg]), style: { maxHeight: 'calc(100vh - 140px)' } }));
    lbl.textContent = `${st.g} · strana ${st.pg + 1}/${st.pages.length} · úrovne ${st.meta.n_chosen}/${st.meta.levels.length}`;
  }
  function row(label, key, unit) {
    const o = st.meta.opt;
    const i = el('input', { value: o[key] ?? '', inputmode: 'decimal' });
    i.onchange = () => { const v = parseFloat(String(i.value).replace(',', '.')); if (!isNaN(v)) set({ [key]: v }); };
    return el('div', { class: 'optrow' }, el('span', {}, label), i, el('small', {}, unit));
  }
  function panel() {
    side.innerHTML = '';
    const tabs = el('div', { class: 'tabs' });
    GROUPS.forEach(([t], i) => tabs.append(el('button', { class: i === st.tab ? 'on' : '', onclick: () => { st.tab = i; panel(); } }, t)));
    side.append(tabs);
    const o = st.meta.opt;
    if (st.tab === 0) {
      const mode = (v, t) => { const r = el('input', { type: 'radio', name: 'lm' }); r.checked = o.mode === v; r.onchange = () => set({ mode: v }, true); return el('label', {}, r, t); };
      side.append(el('h4', {}, 'Úrovne layoutu'), mode('dr', 'podľa DR (dokumentačné rozhrania)'), mode('depth', 'hĺbkové (súpis nálezov + DR)'),
        row('krok hĺbky', 'step', 'cm'));
      const sel = el('select', { class: 'inp' }, ...['auto', '1', '2', '3', '4'].map(v => el('option', { value: v }, v)));
      sel.value = o.per_page ? String(o.per_page) : 'auto';
      sel.onchange = () => set({ per_page: sel.value === 'auto' ? 0 : parseInt(sel.value, 10) }, true);
      side.append(el('div', { class: 'optrow' }, el('span', {}, 'úrovní na stranu'), sel, el('small', {}, '')),
        el('div', { class: 'hint' }, 'Hĺbka = cm pod úrovňou zistenia hrobu (DR 0/1). Nálezy so súpisom idú do úrovne podľa „Hloubka“, ostatné prvky podľa DR (nivelácia DR, inak 20 cm × k).'),
        el('h4', {}, 'Zobraziť úrovne'));
      const key = o.mode === 'depth' ? 'sel_depth' : 'sel_dr';
      const boxes = [];
      const upd = () => { const on = boxes.filter(b => b.c.checked).map(b => b.k); set({ [key]: on.length === boxes.length ? null : on }, true); };
      side.append(el('div', { class: 'row', style: { display: 'flex', gap: '6px' } },
        el('button', { class: 'tool', onclick: () => { boxes.forEach(b => (b.c.checked = true)); upd(); } }, 'všetky'),
        el('button', { class: 'tool', onclick: () => { boxes.forEach(b => (b.c.checked = false)); upd(); } }, 'žiadne')));
      for (const l of st.meta.levels) {
        const c = el('input', { type: 'checkbox' }); c.checked = l.on; c.onchange = upd;
        boxes.push({ c, k: l.key });
        side.append(el('label', {}, c, l.label));
      }
      if (!st.meta.levels.length) side.append(el('div', { class: 'hint' }, '(hrob nemá úrovne)'));
    } else {
      for (const [name, rows, extra] of GROUPS[st.tab][1]) {
        side.append(el('h4', {}, name));
        for (const [l, k, u] of rows) side.append(row(l, k, u));
        if (extra === 'page') side.append(el('div', { style: { display: 'flex', gap: '6px' } },
          ...[['160×220', 160, 220], ['A4', 210, 297], ['A3', 297, 420]].map(([t, w, h]) => el('button', { class: 'tool', onclick: () => set({ page_w: w, page_h: h }, true) }, t))));
      }
      if (st.tab === 3) side.append(el('div', { style: { display: 'grid', gap: '6px', marginTop: '12px' } },
        el('button', { class: 'tool', onclick: async () => { if (await confirmBox('Vrátiť spoločné nastavenia na predvolené?')) { await api('/api/layout/reset', { g: st.g, what: 'global' }); reload(); } } }, 'Obnoviť predvolené (všetky hroby)'),
        el('button', { class: 'tool', onclick: async () => { await api('/api/layout/reset', { g: st.g, what: 'grave' }); reload(); } }, 'Obnoviť rotáciu, mierky a úrovne tohto hrobu')));
    }
  }
  function exp(fmt) { runJob(`Layout ${fmt.toUpperCase()} – ${st.g}`, { kind: 'layout_pdf', g: st.g, plany: st.plany, fmt }).catch(() => {}); }
  async function specAll() {
    const md = await new Promise(res => {
      import('./ui.js').then(({ modal }) => {
        const m = modal('Predpisy pre ArcGIS');
        m.body.append(el('div', { class: 'pre' }, 'Pripraviť predpisy layoutov pre ArcGIS Pro (nástroj „8 Export layoutov podľa náhľadu“).'));
        m.foot.append(el('button', { class: 'btn', onclick: () => m.close(null) }, 'Zrušiť'),
          el('button', { class: 'btn', onclick: () => m.close('all') }, 'Všetky hroby'),
          el('button', { class: 'btn primary', onclick: () => m.close('done') }, 'Len hotové hroby'));
        m.done.then(res);
      });
    });
    if (!md) return;
    runJob('Predpisy layoutov pre ArcGIS', { kind: 'layout_spec', only_done: md === 'done' }).catch(() => {});
  }
  reload();
}
