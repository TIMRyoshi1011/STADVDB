import { useEffect, useMemo, useState } from 'react';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import 'chart.js/auto';
import { META, MIN, MAX, getKpis, getPivot, getReport } from '../../api.js';
import './App.css';

const TABS = [['time', 'Sales Performance'], ['prod', 'Products'], ['loc', 'Customers by Location'], ['log', 'Logistics'], ['pivot', 'Pivot Table']];
const TITLE = { time: 'How are sales changing over time?', prod: 'Which products sell best?', loc: 'Where are our customers?', log: 'How are deliveries performing?', pivot: 'Compare two things side by side' };
const ROOT = { time: 'All time', prod: 'All categories', loc: 'All countries', log: 'All couriers' };
const PD = { cat: 'Category', quarter: 'Quarter', month: 'Month', courier: 'Courier', vehicle: 'Vehicle type', country: 'Country' };
const GB = ['Year', 'Quarter', 'Month', 'Day'];
const PAL = ['#4fd0e8', '#f6c85f', '#6f9ceb', '#ef767a', '#7bd88f', '#c792ea', '#ffa94d', '#5cc8b6', '#b8c0ff', '#e58fb3'];   // one color per bar / slice
const UP = '#42d9a3', DOWN = '#ff777e';   // line: green = sales went up, red = went down
const DEF = () => ({ from: MIN, to: MAX, cats: [], country: '', courier: '', vehicle: '' });
const php = (v) => 'Php ' + Math.round(v).toLocaleString('en-PH');
const lab = (k) => (/^\d{4}-\d\d$/.test(k) ? new Date(k + '-01T00:00').toLocaleString('en', { month: 'short', year: 'numeric' }) : /^\d{4}-\d\d-\d\d$/.test(k) ? new Date(k + 'T00:00').toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : k);
const fmt = (v) => (v >= 1e6 ? v / 1e6 + 'M' : v >= 1e3 ? v / 1e3 + 'K' : v);
const defSort = (tab) => (tab === 'time' ? { k: 'k', dir: 1 } : { k: 'sales', dir: -1 });
const download = (name, head, rows) => {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head, ...rows].map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' })); a.download = name; a.click();
};

function App() {
  const [tab, setTab] = useState('time');
  const [gb, setGb] = useState(1);
  const [path, setPath] = useState([]);
  const [A, setA] = useState(DEF());   // applied filters
  const [D, setD] = useState(DEF());   // filters being edited (applied with the Apply button)
  const [pr, setPr] = useState('cat');
  const [pc, setPc] = useState('quarter');
  const [sort, setSort] = useState(defSort('time'));
  const [tries, setTries] = useState(0);
  const [res, setRes] = useState({ params: null });

  const params = useMemo(() => ({ tab, gb, path, pr, pc, A, tries }), [tab, gb, path, pr, pc, A, tries]);
  useEffect(() => {
    let on = true;
    const job = params.tab === 'pivot' ? getPivot(params) : getReport(params);
    Promise.all([job, getKpis(params.A)])
      .then(([data, kpi]) => on && setRes({ params, data, kpi }))
      .catch(() => on && setRes({ params, error: true }));
    return () => { on = false; };
  }, [params]);
  const loading = res.params !== params;
  const { data, kpi, error } = res;
  const pivot = tab === 'pivot';
  const empty = !loading && !error && (kpi.orders === 0);

  const setTabTo = (t) => { setTab(t); setPath([]); setSort(defSort(t)); };
  const apply = (next) => { setA(next); setD(next); setPath([]); };
  const toggleCat = (c) => setD((d) => ({ ...d, cats: d.cats.includes(c) ? d.cats.filter((x) => x !== c) : [...d.cats, c] }));
  const setF = (k, v) => setD((d) => { const n = { ...d, [k]: v || (k === 'from' ? MIN : k === 'to' ? MAX : '') }; if (n.from > n.to) [n.from, n.to] = [n.to, n.from]; return n; });

  const chips = [];
  if (A.from !== MIN || A.to !== MAX) chips.push([`${lab(A.from)} – ${lab(A.to)}`, { from: MIN, to: MAX }]);
  A.cats.forEach((c) => chips.push([c, { cats: A.cats.filter((x) => x !== c) }]));
  [['country', 'Country'], ['courier', 'Courier'], ['vehicle', 'Vehicle']].forEach(([k, n]) => A[k] && chips.push([`${n}: ${A[k]}`, { [k]: '' }]));

  // chart + table data
  let items = [], dough = false, type = 'bar', canDrill = false, csvRows = [];
  if (data && !pivot && !loading) {
    canDrill = data.can;
    const sorted = data.items.slice().sort(tab === 'time' ? (a, b) => (a.k < b.k ? -1 : 1) : (a, b) => b.sales - a.sales);
    items = sorted;
    if (tab !== 'time' && items.length > 10) { const o = items.slice(10).reduce((s, x) => s + x.sales, 0); items = [...items.slice(0, 10), { k: 'Others', sales: o, other: true }]; }   // top 10 + Others
    dough = tab === 'log' && data.level === 0 && items.length <= 9;
    type = tab === 'time' ? 'line' : dough ? 'doughnut' : 'bar';
  }
  const rows = data && data.items ? data.items.slice().sort((a, b) => (a[sort.k] < b[sort.k] ? -1 : a[sort.k] > b[sort.k] ? 1 : 0) * sort.dir) : [];
  csvRows = rows.map((r) => [lab(r.k), Math.round(r.sales), r.orders]);

  const grid = { color: 'rgba(255,255,255,.08)' };
  const options = {
    maintainAspectRatio: false, indexAxis: type === 'bar' ? 'y' : 'x',
    scales: dough ? {} : { [type === 'bar' ? 'x' : 'y']: { beginAtZero: true, grid, ticks: { callback: fmt } }, [type === 'bar' ? 'y' : 'x']: { grid: { display: false } } },
    plugins: { legend: { display: dough }, tooltip: { callbacks: { label: (c) => ' Sales: ' + php(c.raw) } } },
    onHover: (e, el) => { e.native.target.style.cursor = el.length && canDrill && !items[el[0].index].other ? 'pointer' : 'default'; },
    onClick: (_, el) => { if (!el.length || !canDrill) return; const x = items[el[0].index]; if (!x.other) { setPath([...path, x.k]); setSort(defSort(tab)); } },
  };
  const vals = items.map((x) => x.sales);
  const up = (i) => i === 0 || vals[i] >= vals[i - 1];
  const barColors = items.map((x, i) => (x.other ? '#8da2b6' : PAL[i % PAL.length]));
  const cdata = { labels: items.map((x) => lab(x.k)), datasets: [{ label: 'Sales (Php)', data: vals,
    backgroundColor: type === 'line' ? vals.map((_, i) => (up(i) ? UP : DOWN)) : barColors,
    borderColor: type === 'line' ? '#4fd0e8' : '#0f3265', borderWidth: type === 'line' ? 3 : dough ? 3 : 0,
    segment: type === 'line' ? { borderColor: (c) => (c.p1.parsed.y >= c.p0.parsed.y ? UP : DOWN) } : undefined,
    pointBackgroundColor: vals.map((_, i) => (up(i) ? UP : DOWN)), pointRadius: tab === 'time' ? 5 : 0, pointHoverRadius: 8, tension: 0.3 }] };
  const crumbs = [tab === 'time' ? 'All time' : ROOT[tab], ...path.map(lab)];
  const max = pivot && data && data.cells ? Math.max(1, ...data.cells.flat()) : 1;   // data can still be the previous tab's result while loading
  const pcell = (v) => (v ? { background: `rgba(0,153,184,${(0.12 + (0.8 * v) / max).toFixed(2)})` } : undefined);
  const sortBy = (k) => setSort({ k, dir: sort.k === k ? -sort.dir : k === 'k' ? 1 : -1 });

  return (
    <div className="app">
      <div className="card">
        <div className="row">
          <div><label>From</label><input type="date" min={MIN} max={MAX} value={D.from} onChange={(e) => setF('from', e.target.value)} /></div>
          <div><label>To</label><input type="date" min={MIN} max={MAX} value={D.to} onChange={(e) => setF('to', e.target.value)} /></div>
          <div><label>Country</label><select value={D.country} onChange={(e) => setF('country', e.target.value)}><option value="">All countries</option>{META.countries.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label>Courier</label><select value={D.courier} onChange={(e) => setF('courier', e.target.value)}><option value="">All couriers</option>{META.couriers.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div><label>Vehicle type</label><select value={D.vehicle} onChange={(e) => setF('vehicle', e.target.value)}><option value="">All vehicle types</option>{META.vehicles.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="push"><button className="pri" onClick={() => apply(D)}>Apply</button><button onClick={() => apply(DEF())}>Reset</button></div>
        </div>
        <div className="cats"><span>Categories:</span>{META.cats.map((c) => <button key={c} className={D.cats.includes(c) ? 'on' : ''} onClick={() => toggleCat(c)}>{c}</button>)}</div>
        <div className="chips"><span className="hint">Active filters:</span>{!chips.length && <span className="hint">none – showing everything</span>}
          {chips.map(([t, patch]) => <span className="chip" key={t}>{t}<b title="Remove" onClick={() => apply({ ...A, ...patch })}>×</b></span>)}</div>
      </div>

      <div className="kpis">
        {[['Total sales', kpi && php(kpi.sales), ''], ['Orders', kpi && kpi.orders.toLocaleString('en-PH'), ''], ['Items per order', kpi && (kpi.orders ? kpi.perOrder.toFixed(1) : '–'), ''], ['Top courier', kpi && (kpi.top ? kpi.top[0] : '–'), kpi && kpi.top ? php(kpi.top[1]) : '']].map(([a, b, e]) => (
          <div className="kpi" key={a}><small>{a}</small><div>{b ?? '…'}</div><em>{e || '\u00a0'}</em></div>))}
      </div>

      <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTabTo(k)}>{t}</button>)}</div>

      <div className="card d">
        {(loading || error || empty) && (
          <div className="state">
            {loading && <><div className="spin" />Loading your numbers…</>}
            {!loading && error && <><div className="big">⚠️</div>Something went wrong while loading the data.<br /><br /><button className="pri" onClick={() => setTries(tries + 1)}>Try again</button></>}
            {!loading && !error && empty && <><div className="big">🔍</div>No sales match these filters.<br /><br /><button className="pri" onClick={() => apply(DEF())}>Clear all filters</button></>}
          </div>
        )}
        {!loading && !error && !empty && (
          <div>
            <h2>{TITLE[tab]}</h2>
            {tab === 'time' && <div className="row mid"><span>Group by</span>{GB.map((g, i) => <button key={g} className={gb === i ? 'on' : ''} onClick={() => { setGb(i); setPath([]); setSort(defSort('time')); }}>{g}</button>)}</div>}
            {!pivot && (
              <>
                <div className="bc">
                  <button disabled={!path.length} onClick={() => { setPath(path.slice(0, -1)); setSort(defSort(tab)); }}>↑ Up</button>
                  <span>{crumbs.map((t, i) => <span key={i}>{i > 0 && ' > '}{i === crumbs.length - 1 ? <span className="cur">{t}</span> : <a onClick={() => { setPath(path.slice(0, i)); setSort(defSort(tab)); }}>{t}</a>}</span>)}</span>
                  <span className="hint">{canDrill ? 'Click a ' + (tab === 'time' ? 'point' : 'bar') + ' to see more detail' : ''}</span>
                  {type === 'line' && <span className="hint"><b className="up">●</b> up from the previous period <b className="down">●</b> down</span>}
                </div>
                <div className="ch">{type === 'line' ? <Line data={cdata} options={options} /> : type === 'doughnut' ? <Doughnut data={cdata} options={options} /> : <Bar data={cdata} options={options} />}</div>
                <div className="sc"><table><thead><tr>{[['k', 'Item'], ['sales', 'Sales'], ['orders', 'Orders']].map(([k, n]) => <th key={k} onClick={() => sortBy(k)}>{n}{sort.k === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.k}><td>{lab(r.k)}</td><td>{php(r.sales)}</td><td>{r.orders.toLocaleString('en-PH')}</td></tr>)}</tbody></table></div>
                <button onClick={() => download(tab + '.csv', ['Item', 'Sales (Php)', 'Orders'], csvRows)}>Export CSV</button>
              </>
            )}
            {pivot && (
              <>
                <div className="row">
                  <div><label>Rows</label><select value={pr} onChange={(e) => setPr(e.target.value)}>{Object.entries(PD).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
                  <div><label>Columns</label><select value={pc} onChange={(e) => setPc(e.target.value)}>{Object.entries(PD).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
                  <button onClick={() => { setPr(pc); setPc(pr); }}>Swap rows and columns</button>
                </div>
                {pr === pc ? <p className="hint">Please pick two different groupings.</p> : (
                  <div className="sc"><table className="pv"><thead><tr><th>{PD[pr]} / {PD[pc]}</th>{data.colLabels.map((c) => <th key={c}>{lab(c)}</th>)}</tr></thead>
                    <tbody>{data.rowLabels.map((r, i) => <tr key={r}><td>{r}</td>{data.cells[i].map((v, j) => <td key={j} style={pcell(v)}>{v ? php(v) : '–'}</td>)}</tr>)}</tbody></table></div>
                )}
                {pr !== pc && <button onClick={() => download('pivot.csv', [PD[pr], ...data.colLabels.map(lab)], data.rowLabels.map((r, i) => [r, ...data.cells[i].map(Math.round)]))}>Export CSV</button>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="foot">
        <span>ℹ️ Dates are delivery dates. Data covers Sept 24, 2024 – Sept 23, 2025; the first and last months are partial. Sales use each product’s current price. Showing sample data until the backend is connected.</span>
        {!loading && res.data && <span>Loaded in {(res.data.ms / 1000).toFixed(2)} s</span>}
      </div>
    </div>
  );
}

export default App;
