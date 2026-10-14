// nalezy.js – súpis nálezov (xlsx) ↔ vektory nálezov hrobu: prepojenie, návrhy, priradenie, report
import { el, api, toast, confirmBox, runJob } from './ui.js';

export async function openNalezy(app) {
  const root = el('div', { class: 'screen' });
  const top = el('div', { class: 'screen-top' });
  const msg = el('div', { class: 'screen-msg' });
  const body = el('div', { class: 'screen-body', style: { flexDirection: 'column' } });
  root.append(top, msg, body);
  document.body.append(root);
  const st = { g: app.G.g, data: null, rows: new Set(), vec: null, follow: true };
  const B = (t, fn, ti) => el('button', { class: 'tool', title: ti || '', onclick: fn }, t);
  const fl = el('input', { type: 'checkbox' }); fl.checked = true; fl.onchange = () => (st.follow = fl.checked);
  const title = el('span', { class: 't' }, 'Súpis nálezov');
  top.append(title, el('label', { class: 'tool' }, fl, 'sledovať hrob'), el('span', { class: 'spacer' }),
    B('🗺 Ukázať na pláne', () => showOnMap()), B('→ Priradiť riadok k vektoru', () => assign()),
    B('Priradiť jednoznačné návrhy', () => unique()), B('Report XLSX', () => runJob('Report súpisu nálezov', { kind: 'nal_report' }).catch(() => {})),
    B('↻', () => load(true), 'Načítať znova'), B('✕ Zavrieť', () => close(), 'Esc'));
  const t1 = el('div', { class: 'tblwrap', style: { flex: 3 } });
  const t2 = el('div', { class: 'tblwrap', style: { flex: 2, borderTop: '2px solid #ccd' } });
  const det = el('div', { class: 'pre small', style: { padding: '8px 12px', background: '#fff', borderTop: '1px solid #ddd', maxHeight: '22vh', overflow: 'auto', minHeight: '60px' } });
  body.append(t1, t2, det);
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const prevHook = app.onGraveChanged;
  app.onGraveChanged = g => { if (prevHook) prevHook(g); if (st.follow && g !== st.g) { st.g = g; load(); } };
  function close() {
    root.remove(); document.removeEventListener('keydown', onKey, true); app.onGraveChanged = prevHook;
    app.map.highlight = new Set(); app.map.request();
  }
  async function load(refresh = false) {
    msg.textContent = 'Načítavam súpis…';
    try { st.data = await api(`/api/nalezy?g=${encodeURIComponent(st.g)}${refresh ? '&refresh=1' : ''}`); }
    catch (e) { msg.textContent = e.message.split('\n')[0]; msg.className = 'screen-msg bad'; return; }
    const d = st.data;
    st.rows = new Set(); st.vec = null;
    title.textContent = 'Súpis nálezov – ' + d.g;
    msg.className = 'screen-msg';
    msg.textContent = `Hrob ${d.g} – súpis: ${d.n} položiek, s vektorom ${d.nlk} · vektory bez súpisu: ${d.vecs.length}   (zelená = prepojené, oranžová = je návrh, červená = bez vektora, fialová = nesúlad materiálu)`;
    t1.innerHTML = ''; t2.innerHTML = '';
    const tb = el('tbody');
    t1.append(el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, ...['Č.N.', 'P.Č.', 'Nález', 'Špecifikácia', 'Kontext', 'Hĺbka', 'Plán', 'Dat.', 'Vektor', 'DR'].map(h => el('th', {}, h)))), tb));
    for (const r of d.rows) {
      const tr = el('tr', { class: r.tag }, ...[r.cn, r.pc, r.nalez, r.spec, r.kontext, r.hloubka, r.plan, r.datovani,
        r.vek.slice(0, 3).map(k => k.replace('|', ' ')).join('; ') + (r.vek.length > 3 ? ' …' : ''), r.dr].map(v => el('td', {}, v ?? '')));
      tr.onclick = ev => { if (!(ev.ctrlKey || ev.shiftKey)) st.rows.clear(); st.rows.has(r.id) ? st.rows.delete(r.id) : st.rows.add(r.id); st.vec = null; mark(); detail(); };
      tr.ondblclick = () => { st.rows = new Set([r.id]); showOnMap(); };
      tr._id = r.id;
      tb.append(tr);
    }
    const tb2 = el('tbody');
    t2.append(el('div', { class: 'small', style: { padding: '4px 8px', color: '#555' } }, 'Vektory nálezov hrobu bez súpisu (návrh = nepriradené položky toho istého materiálu)'),
      el('table', { class: 'grid' }, el('thead', {}, el('tr', {}, ...['Vrstva', 'OID', 'DR', 'Č.nál.', 'Č.sáčku', 'Popis', 'Návrhy zo súpisu'].map(h => el('th', {}, h)))), tb2));
    for (const v of d.vecs) {
      const tr = el('tr', {}, ...[v.layer, v.fid, v.dr, v.cn, v.sack, v.popis, v.navrh.slice(0, 5).map(n => n.text).join('; ')].map(x => el('td', {}, x ?? '')));
      tr.onclick = () => { st.vec = v.key; mark(); detail(); };
      tr.ondblclick = () => { st.vec = v.key; showOnMap(); };
      tr._key = v.key;
      tb2.append(tr);
    }
    det.textContent = '';
  }
  function mark() {
    t1.querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('sel', st.rows.has(tr._id)));
    t2.querySelectorAll('tbody tr').forEach(tr => tr.classList.toggle('sel', tr._key === st.vec));
  }
  function detail() {
    const d = st.data;
    let t = '', hl = new Set();
    if (st.vec) {
      const v = d.vecs.find(x => x.key === st.vec);
      t = `${v.layer} OID ${v.fid} · DR ${v.dr} · Cislo_nalezu ${v.cn} · Cislo_sacku ${v.sack} · Plan_nalez ${v.plan}\n${v.popis || ''}\n\n` + v.navrh.map(n => '• ' + n.text).join('\n');
      hl.add(v.key);
    } else {
      for (const r of d.rows) if (st.rows.has(r.id)) { t += r.text + '\n' + r.links.map(l => '   → ' + l).join('\n') + '\n\n'; r.vek.forEach(k => hl.add(k)); }
    }
    det.textContent = t;
    app.map.highlight = hl; app.map.request();
  }
  function showOnMap() {
    detail();
    const keys = [...app.map.highlight];
    if (!keys.length) return;
    const drs = new Set();
    for (const k of keys) for (const x of (st.data.drmap[k] || [])) drs.add(x);
    const first = [...drs].sort((a, b) => parseInt(a) - parseInt(b))[0];
    if (first && app.G.drs.some(d => d.dr === first) && app.dr !== first) app.setDr(first);
    close();
    app.map.highlight = new Set(keys); app.map.request();
    toast('Vektory sú zvýraznené purpurovo. Súpis znova: ⋯ → Súpis nálezov (F6).', 'info', 5000);
  }
  async function assign() {
    if (st.rows.size !== 1) { toast('Vyber jeden riadok súpisu.', 'warn'); return; }
    let key = st.vec;
    if (!key && app.map.sel) key = app.map.sel.key;
    if (!key) { toast('Vyber vektor v dolnom zozname alebo prvok v mape (✏ Upraviť).', 'warn'); return; }
    const r = await api('/api/nalezy/assign', { g: st.g, row: [...st.rows][0], key });
    toast(r.msg, 'ok');
    load(true);
  }
  async function unique() {
    const p = await api('/api/nalezy/unique', { g: st.g, preview: true });
    if (!p.n) { toast('Žiadne jednoznačné návrhy.', 'warn'); return; }
    if (!(await confirmBox(`Priradiť ${p.n} vektorov?\n\n${p.items.join('\n')}`, 'Priradiť'))) return;
    const r = await api('/api/nalezy/unique', { g: st.g });
    toast(r.msg, 'ok');
    load(true);
  }
  load();
}
