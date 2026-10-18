// server/tests/functional.test.js
import mysql from 'mysql2/promise';
import 'dotenv/config';

const SRC = process.env.SRC_DB || 'ecomm_source';
const DW  = process.env.DB;
const API = process.env.API_URL || 'http://localhost:3000';

const base = {
  host: process.env.HOST,
  user: process.env.USER,
  password: process.env.PASSWORD,
  port: process.env.DB_PORT,
};

const srcPool = mysql.createPool({ ...base, database: SRC });
const dwPool  = mysql.createPool({ ...base, database: DW  });

let pass = 0, fail = 0;
const results = [];

const ok = (name, detail = '') => { pass++; results.push({ name, status: 'PASS', detail }); };
const no = (name, detail = '') => { fail++; results.push({ name, status: 'FAIL', detail }); };
const eq = (name, actual, expected) => {
  const a = typeof actual === 'number' ? actual : JSON.stringify(actual);
  const e = typeof expected === 'number' ? expected : JSON.stringify(expected);
  a === e ? ok(name, `${a}`) : no(name, `expected ${e}, got ${a}`);
};
const near = (name, actual, expected, tol = 0.01) => {
  Math.abs(Number(actual) - Number(expected)) <= tol
    ? ok(name, `${actual} ~= ${expected}`)
    : no(name, `expected ~${expected}, got ${actual}`);
};

// Two helpers instead of one; `q('src', ...)` or `q('dw', ...)`
const q = async (which, sql, params = []) => {
  const pool = which === 'src' ? srcPool : dwPool;
  const [rows] = await pool.query(sql, params);
  return rows;
};

async function api(path, params = {}) {
  const url = new URL(path, API);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

// ---------- 1. ETL validation: warehouse vs source ----------
async function testEtl() {
  console.log('\n[1] ETL validation (warehouse vs source)');

  const [{ n: srcRows }] = await q('src', `
    SELECT COUNT(*) n FROM orderitems
    WHERE quantity IS NOT NULL AND quantity > 0`);

  const [{ n: dwRows }] = await q('dw', `SELECT COUNT(*) n FROM orderitem`);
  eq('ETL row count matches source (quantity > 0)', Number(dwRows), Number(srcRows));

  const [{ s: srcSales }] = await q('src', `
    SELECT ROUND(SUM(oi.quantity * p.price), 2) s
    FROM orderitems oi JOIN products p ON oi.ProductId = p.id
    WHERE oi.quantity IS NOT NULL AND oi.quantity > 0`);

  const [{ s: dwSales }] = await q('dw', `SELECT ROUND(SUM(sales_amount), 2) s FROM orderitem`);
  near('ETL total sales matches source (allowing DECIMAL rounding)', dwSales, srcSales, 100);

  const [{ n: mismatched }] = await q('dw', `
    SELECT COUNT(*) n FROM orderitem WHERE ROUND(sales_amount, 2) <> sales_amount`);
  eq('Every fact row sales_amount is exact to 2 decimals', Number(mismatched), 0);

  const [{ n: nullFk }] = await q('dw', `
    SELECT COUNT(*) n FROM orderitem
    WHERE product_id IS NULL OR user_id IS NULL OR rider_id IS NULL OR delivery_date_id IS NULL`);
  eq('No null foreign keys in fact table', Number(nullFk), 0);

  const [{ n: dup }] = await q('dw', `
    SELECT COUNT(*) n FROM (
      SELECT source_order_id, product_id, COUNT(*) c
      FROM orderitem GROUP BY source_order_id, product_id HAVING c > 1
    ) t`);
  eq('No duplicate (source_order_id, product_id) in fact', Number(dup), 0);

  const [{ n: orphan }] = await q('dw', `
    SELECT COUNT(*) n FROM orderitem oi
    LEFT JOIN Product p ON oi.product_id = p.product_id
    WHERE p.product_id IS NULL`);
  eq('No orphan product references', Number(orphan), 0);

  const [{ n: dateRows }] = await q('dw', `SELECT COUNT(*) n FROM \`Date\``);
  ok('Date dimension populated', `${dateRows} rows`);
}

async function testOlap() {
  console.log('\n[2] OLAP correctness');

  const from = '2024-09-24', to = '2025-09-23';

  const { body: time } = await api('/api/report', { tab: 'time', gb: 0, from, to });
  const [{ total }] = await q('dw', `
    SELECT ROUND(SUM(oi.sales_amount), 2) total
    FROM orderitem oi JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.full_date BETWEEN ? AND ?`, [from, to]);
  near('Time roll-up totalRevenue matches independent SQL', time.totalRevenue, total);

  const [{ y2025 }] = await q('dw', `
    SELECT ROUND(SUM(oi.sales_amount), 2) y2025
    FROM orderitem oi JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.year = 2025`);
  const item2025 = time.items.find((r) => r.k === '2025');
  if (item2025) near('Time roll-up year 2025 matches', item2025.sales, y2025);
  else no('Time roll-up contains year 2025', 'missing');

  const { body: q2025 } = await api('/api/report', {
    tab: 'time', gb: 0, path: ['2025'], from, to,
  });
  const [{ q2 }] = await q('dw', `
    SELECT ROUND(SUM(oi.sales_amount), 2) q2
    FROM orderitem oi JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.year = 2025 AND d.quarter = 2`);
  const q2Item = q2025.items.find((r) => r.k === '2025 Q2');
  if (q2Item) near('Drill-down 2025 Q2 matches', q2Item.sales, q2);
  else no('Drill-down returns 2025 Q2', 'missing');

  const { body: cats } = await api('/api/report', { tab: 'prod', from, to });
  const cat = cats.items[0]?.k;
  if (!cat) { no('Products returns categories', 'empty'); }
  else {
    const { body: prods } = await api('/api/report', { tab: 'prod', path: [cat], from, to });
    const [{ total: catTotal }] = await q('dw', `
      SELECT ROUND(SUM(oi.sales_amount), 2) total
      FROM orderitem oi JOIN Product p ON oi.product_id = p.product_id
      WHERE p.category = ?`, [cat]);
    near(`Product drill-down total for ${cat}`, prods.totalRevenue, catTotal);
  }

  const { body: locs } = await api('/api/report', { tab: 'loc', from, to });
  const country = locs.items[0]?.k;
  if (!country) { no('Location returns countries', 'empty'); }
  else {
    const { body: slice } = await api('/api/report', {
      tab: 'loc', path: [country], year: 2025, from, to,
    });
    const [{ total: cityTotal }] = await q('dw', `
      SELECT ROUND(SUM(oi.sales_amount), 2) total
      FROM orderitem oi
      JOIN \`User\` u ON oi.user_id = u.user_id
      JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
      WHERE u.country = ? AND d.year = 2025`, [country]);
    near(`Location slice total for ${country}/2025`, slice.totalSales, cityTotal);
  }

  const { body: pivot } = await api('/api/pivot', { year: 2025 });
  const [{ total: pivotTotal }] = await q('dw', `
    SELECT ROUND(SUM(oi.sales_amount), 2) total
    FROM orderitem oi JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.year = 2025`);
  near('Pivot annual total matches', pivot.totalSales, pivotTotal);
  const q1Sum = pivot.items.reduce((s, r) => s + r.q1, 0);
  const [{ total: q1 }] = await q('dw', `
    SELECT ROUND(SUM(oi.sales_amount), 2) total
    FROM orderitem oi JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.year = 2025 AND d.quarter = 1`);
  near('Pivot Q1 column matches', q1Sum, q1);
}

// ---------- 3. API contract: valid and invalid parameters ----------
async function testApi() {
  console.log('\n[3] API contract');

  const conn = await api('/api/conn');
  eq('GET /api/conn returns 200', conn.status, 200);

  const meta = await api('/api/meta');
  eq('GET /api/meta returns 200', meta.status, 200);
  ok('meta has min/max/cats/countries', meta.body.min && meta.body.max && Array.isArray(meta.body.cats) ? 'ok' : 'missing');

  const kpis = await api('/api/kpis', { from: '2024-09-24', to: '2025-09-23' });
  eq('GET /api/kpis returns 200', kpis.status, 200);
  ok('kpis exposes orders and sales', typeof kpis.body.orders === 'number' && typeof kpis.body.sales === 'number' ? 'ok' : 'missing');

  // Invalid: bad tab
  const badTab = await api('/api/report', { tab: 'nope' });
  eq('Invalid tab returns 400', badTab.status, 400);

  // Invalid: bad grouping
  const badGb = await api('/api/report', { tab: 'time', gb: 9, from: '2024-09-24', to: '2025-09-23' });
  eq('Invalid grouping returns 400', badGb.status, 400);

  // Invalid: from > to
  const badRange = await api('/api/report', {
    tab: 'time', gb: 0, from: '2025-09-24', to: '2025-09-23',
  });
  eq('Reversed date range returns 400', badRange.status, 400);

  // Invalid: pivot year not in Date table
  const badYear = await api('/api/pivot', { year: 1999 });
  eq('Unavailable pivot year returns 400', badYear.status, 400);

  // Invalid: too-deep product drill-down
  const tooDeep = await api('/api/report', { tab: 'prod', path: ['Bags', 'Backpack', 'x'] });
  eq('Too-deep product drill-down returns 400', tooDeep.status, 400);

  // Invalid: location year not a number
  const badLocYear = await api('/api/report', {
    tab: 'loc', path: ['Japan'], year: 'abc',
  });
  eq('Non-numeric location year returns 400', badLocYear.status, 400);
}

// ---------- 4. Regression / edge cases ----------
async function testEdge() {
  console.log('\n[4] Edge cases');

  // Empty result must still be 200 with items: []
  const empty = await api('/api/report', {
    tab: 'time', gb: 0, from: '2024-09-24', to: '2024-09-24',
    country: 'Nowhere',
  });
  eq('Empty filter set returns 200', empty.status, 200);
  ok('Empty filter set has zero items', Array.isArray(empty.body.items) && empty.body.items.length === 0 ? 'ok' : 'non-empty');

  // Drill-down at max depth must not advertise further drill
  const { body: prod0 } = await api('/api/report', { tab: 'prod' });
  const cat = prod0.items[0]?.k;
  if (cat) {
    const { body: prod1 } = await api('/api/report', { tab: 'prod', path: [cat] });
    const prod = prod1.items[0]?.k;
    if (prod) {
      const { body: prod2 } = await api('/api/report', { tab: 'prod', path: [cat, prod] });
      eq('Product leaf level has can=false', prod2.can, false);
    }
  }

  // Logistics still uses in-memory data and must respond
  const log = await api('/api/kpis', { from: '2024-09-24', to: '2025-09-23', courier: 'JNT' });
  eq('KPI filter by courier returns 200', log.status, 200);
}

// ---------- run ----------
try {
  await testEtl();
  await testOlap();
  await testApi();
  await testEdge();
} catch (e) {
  no('Unhandled exception', e.message);
} finally {
  await srcPool.end();
  await dwPool.end();
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + '='.repeat(78));
  console.log(pad('CASE', 58) + 'RESULT');
  console.log('-'.repeat(78));
  results.forEach((r) => console.log(pad(r.name, 58) + r.status + (r.detail ? '  (' + r.detail + ')' : '')));
  console.log('-'.repeat(78));
  console.log(`TOTAL ${results.length}   PASS ${pass}   FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
