// Sample-data layer (the backend is not connected yet).
// Each function mirrors what a backend endpoint will return, so only this file changes later:
//   getReport -> GET /api/report?tab=&gb=&path=&from=&to=&cats=&country=&courier=&vehicle=
//   getKpis   -> GET /api/kpis?...    getPivot -> GET /api/pivot?rows=&cols=&...
export const MIN = '2024-09-24';
export const MAX = '2025-09-23';
const CATS = { Toys: ['Toy robot:350', 'Building blocks:890', 'Plush bear:520'], Bags: ['Backpack:1450', 'Tote bag:780', 'Sling bag:990'], Makeup: ['Lipstick:420', 'Foundation:850', 'Eyeshadow kit:1100'], Gadgets: ['Smart watch:2900', 'Earbuds:1500', 'Power bank:900'], Clothes: ['T-shirt:350', 'Dress:1200', 'Jacket:2100'], "Men's Apparel": ['Polo shirt:650', 'Chinos:1100', 'Denim jeans:1500'], Electronics: ['Bluetooth speaker:1800', 'Monitor:6500', 'Keyboard:1300'], Appliances: ['Air fryer:3200', 'Rice cooker:1900', 'Electric fan:1400'], Laptops: ['Laptop 14in:32000', 'Laptop 16in:45000', 'Gaming laptop:62000'] };
const COUNTRIES = ['Sudan', 'Dominican Republic', 'Reunion', 'Slovenia', 'United States of America', 'Equatorial Guinea', 'Antarctica', 'North Macedonia', 'Slovakia', 'Luxembourg', 'Kyrgyz Republic', 'Cook Islands'];
const COUR = { JNT: ['JNT Rider 1', 'JNT Rider 2', 'JNT Rider 3', 'JNT Rider 4'], FEDEZ: ['FEDEZ Rider 1', 'FEDEZ Rider 2', 'FEDEZ Rider 3', 'FEDEZ Rider 4'], LBCD: ['LBCD Rider 1', 'LBCD Rider 2', 'LBCD Rider 3', 'LBCD Rider 4'] };
const VEH = ['Motorcycle', 'Bicycle', 'Car', 'Tricycle'];
export const META = { cats: Object.keys(CATS), countries: COUNTRIES.slice().sort(), couriers: Object.keys(COUR), vehicles: VEH };

let seed = 7;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const t0 = Date.UTC(2024, 8, 24);
// one row = one order ITEM (like the fact table); several rows can share an order id
const ROWS = [];
for (let o = 1; o <= 2500; o++) {
  const cn = pick(Object.keys(COUR)), rider = pick(COUR[cn]), country = COUNTRIES[Math.floor(Math.pow(rnd(), 1.6) * COUNTRIES.length)];
  const city = 'City ' + (1 + Math.floor(rnd() * 4)), vehicle = VEH[(rider.length + rider.charCodeAt(rider.length - 1)) % 4];
  const d = new Date(t0 + Math.floor(365 * rnd()) * 864e5).toISOString().slice(0, 10);
  const items = new Set(); for (let i = 0, n = 1 + Math.floor(rnd() * 3); i < n; i++) items.add(pick(Object.keys(CATS)) + '|' + Math.floor(rnd() * 3));
  items.forEach((it) => { const [cat, i] = it.split('|'), [prod, price] = CATS[cat][+i].split(':'), units = 1 + Math.floor(rnd() * 10); ROWS.push({ oid: o, d, cat, prod, country, city, courier: cn, rider, vehicle, units, sales: units * +price }); });
}

export const tk = (d, l) => (l === 0 ? d.slice(0, 4) : l === 1 ? d.slice(0, 4) + ' Q' + Math.ceil(+d.slice(5, 7) / 3) : l === 2 ? d.slice(0, 7) : d);
const DIMS = { prod: ['cat', 'prod'], loc: ['country', 'city'], log: ['courier', 'rider'] };
const dk = (r, d) => (d === 'quarter' ? tk(r.d, 1) : d === 'month' ? tk(r.d, 2) : r[d]);
const filt = (f) => ROWS.filter((r) => r.d >= f.from && r.d <= f.to && (!f.cats.length || f.cats.includes(r.cat)) && (!f.country || r.country === f.country) && (!f.courier || r.courier === f.courier) && (!f.vehicle || r.vehicle === f.vehicle));
const run = (fn) => new Promise((res) => { const t = performance.now(); setTimeout(() => res({ ...fn(), ms: Math.round(performance.now() - t) }), 300); });
const group = (rows, kf) => { const m = new Map(); rows.forEach((r) => { const k = kf(r), o = m.get(k) || { k, sales: 0, ids: new Set() }; o.sales += r.sales; o.ids.add(r.oid); m.set(k, o); }); return [...m.values()].map((o) => ({ k: o.k, sales: o.sales, orders: o.ids.size })); };

export const getReport = ({ tab, gb, path, A }) => run(() => {
  let rows = filt(A), kf, can;
  if (tab === 'time') { const lvl = gb + path.length; path.forEach((v, i) => { rows = rows.filter((r) => tk(r.d, gb + i) === v); }); kf = (r) => tk(r.d, lvl); can = lvl < 3; }
  else { const D = DIMS[tab], lvl = path.length; path.forEach((v, i) => { rows = rows.filter((r) => r[D[i]] === v); }); kf = (r) => r[D[lvl]]; can = lvl < D.length - 1; }
  return { items: group(rows, kf), can, level: path.length };
});

export const getKpis = (A) => run(() => {
  const r = filt(A), ids = new Set(r.map((x) => x.oid)), c = {};
  r.forEach((x) => { c[x.courier] = (c[x.courier] || 0) + x.sales; });
  return { sales: r.reduce((s, x) => s + x.sales, 0), orders: ids.size, perOrder: ids.size ? r.length / ids.size : 0, top: Object.entries(c).sort((a, b) => b[1] - a[1])[0] || null };
});

export const getPivot = ({ pr, pc, A }) => run(() => {
  const rows = filt(A), top = (d) => { const t = {}; rows.forEach((r) => { t[dk(r, d)] = (t[dk(r, d)] || 0) + r.sales; }); const ks = Object.keys(t).sort((a, b) => t[b] - t[a]); return new Set(ks.slice(0, 10)); };
  const kr = top(pr), kc = top(pc), m = {}, cols = new Set();   // top 10 per axis, rest become "Others"
  rows.forEach((r) => { const a = kr.has(dk(r, pr)) ? dk(r, pr) : 'Others', c = kc.has(dk(r, pc)) ? dk(r, pc) : 'Others'; cols.add(c); (m[a] = m[a] || {})[c] = (m[a][c] || 0) + r.sales; });
  const tot = (a) => Object.values(m[a]).reduce((s, v) => s + v, 0), cl = [...cols].sort((a, b) => (a === 'Others') - (b === 'Others') || (a < b ? -1 : 1));
  const rl = Object.keys(m).sort((a, b) => (a === 'Others') - (b === 'Others') || tot(b) - tot(a));
  return { rowLabels: rl, colLabels: cl, cells: rl.map((a) => cl.map((c) => m[a][c] || 0)) };
});
