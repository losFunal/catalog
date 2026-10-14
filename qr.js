// qr.js – malý generátor QR kódu (bajtový režim, korekcia M, verzie 1–10), bez knižníc a internetu.
// qrMatrix(text) -> pole riadkov [ [bool,…], … ];  qrSvg(text, px) -> reťazec <svg>

const ECC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // ECC kódové slová na blok
const BLK_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];             // počet blokov

function rawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
  return r;
}
const dataCw = v => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLK_M[v];

function alignPos(v) {
  if (v === 1) return [];
  const na = Math.floor(v / 7) + 2, size = v * 4 + 17;
  const step = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
  const r = [6];
  for (let p = size - 7; r.length < na; p -= step) r.splice(1, 0, p);
  return r;
}

function gmul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) { r[j] = gmul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
    root = gmul(root, 2);
  }
  return r;
}
function rsRem(data, div) {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
  return r;
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let v = 1;
  for (; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= dataCw(v) * 8) break;
  if (v > 10) throw new Error('Text je príliš dlhý pre QR kód');
  const cap = dataCw(v) * 8;
  // dátové bity
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // bloky + ECC + prekladanie
  const nb = BLK_M[v], ecl = ECC_M[v], raw = Math.floor(rawModules(v) / 8);
  const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(ecl);
  const blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1)); k += d.length;
    const e = rsRem(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e));
  }
  const cw = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nShort) cw.push(b[i]); });

  // matica
  const N = v * 4 + 17;
  const M = Array.from({ length: N }, () => new Array(N).fill(false));
  const F = Array.from({ length: N }, () => new Array(N).fill(false));
  const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
  for (let i = 0; i < N; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < N && y >= 0 && y < N) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  const ap = alignPos(v);
  ap.forEach((ay, i) => ap.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const d = (0 << 3) | mask;   // korekcia M = 00
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(N - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, N - 15 + i, bit(i));
    set(8, N - 8, true);
  };
  drawFormat(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) !== 0, a = N - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }
  // dáta cik-cak
  let i = 0;
  for (let right = N - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < N; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? N - 1 - vert : vert;
      if (!F[y][x] && i < cw.length * 8) { M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  // maska s najmenšou penalizáciou
  const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = m => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!F[y][x] && MASK[m](x, y)) M[y][x] = !M[y][x]; };
  const penalty = () => {
    let p = 0, dark = 0;
    const lines = [];
    for (let y = 0; y < N; y++) { lines.push(M[y]); lines.push(M.map(r => r[y])); }
    for (const L of lines) {
      let run = 1;
      for (let k = 1; k <= N; k++) {
        if (k < N && L[k] === L[k - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; }
      }
      const s = L.map(b => b ? '1' : '0').join('');
      for (const pat of ['00001011101', '10111010000']) { let q = s.indexOf(pat); while (q >= 0) { p += 40; q = s.indexOf(pat, q + 1); } }
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (M[y][x]) dark++;
      if (x < N - 1 && y < N - 1 && M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3;
    }
    return p + 10 * Math.floor(Math.abs(dark * 20 / (N * N) - 10));
  };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty(); if (p < bestP) { bestP = p; best = m; }
    applyMask(m);
  }
  applyMask(best); drawFormat(best);
  return M;
}

export function qrSvg(text, px = 260) {
  const M = qrMatrix(text), N = M.length, q = 4, S = N + 2 * q;
  let d = '';
  M.forEach((row, y) => row.forEach((b, x) => { if (b) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
    `<rect width="${S}" height="${S}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
