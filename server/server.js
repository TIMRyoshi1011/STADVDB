import express from 'express';
import cors from 'cors';
import mysql from "mysql2/promise";
import 'dotenv/config';

const pool = mysql.createPool({
    host: process.env.HOST,
    user: process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DB,
    port: process.env.DB_PORT
});

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;
const MIN = '2024-09-24';
const MAX = '2025-09-23';
const DIMS = {
  prod: ['cat', 'prod'],
  loc: ['country', 'city'],
};

const queryString = (value, fallback = '') => (
  typeof value === 'string' ? value : fallback
);
const queryList = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : typeof value === 'string'
      ? [value]
      : []
);
const getFilters = (query) => ({
  from: queryString(query.from, MIN),
  to: queryString(query.to, MAX),
  cats: queryList(query.cats),
  country: queryString(query.country),
  courier: queryString(query.courier),
  vehicle: queryString(query.vehicle),
});
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
const validateFilters = (filters, res) => {
  if (!validDate(filters.from) || !validDate(filters.to) || filters.from > filters.to) {
    res.status(400).json({ error: 'Provide a valid date range using YYYY-MM-DD dates.' });
    return false;
  }
  return true;
};
const elapsed = (startedAt) => Math.round(performance.now() - startedAt);

const SALES_PERFORMANCE_SQL = `
  SELECT
      d.year,
      d.quarter,
      d.month,
      d.month_name,
      d.full_date,
      SUM(oi.sales_amount) AS total_revenue,
      SUM(oi.quantity) AS total_quantity
  FROM OrderItem oi
  JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
  WHERE d.full_date BETWEEN ? AND ?
  GROUP BY
      d.year,
      d.quarter,
      d.month,
      d.month_name,
      d.full_date
  WITH ROLLUP
`;
const PRODUCT_DRILLDOWN_SQL = `
  SELECT
      p.category,
      p.product_name,
      SUM(oi.quantity) AS quantity_sold,
      SUM(oi.sales_amount) AS total_sales
  FROM OrderItem oi
  JOIN Product p ON oi.product_id = p.product_id
  WHERE
      (? IS NULL OR p.category = ?)
      AND
      (? IS NULL OR p.product_name = ?)
  GROUP BY
      p.category,
      p.product_id,
      p.product_name
  ORDER BY
      p.category,
      total_sales DESC
`;
const LOCATION_DRILLDOWN_SQL = `
  SELECT
      u.country,
      u.city,
      COUNT(DISTINCT oi.source_order_id) AS total_orders,
      SUM(oi.sales_amount) AS total_sales
  FROM OrderItem oi
  JOIN \`User\` u ON oi.user_id = u.user_id
  WHERE
      (? IS NULL OR u.country = ?)
      AND
      (? IS NULL OR u.city = ?)
  GROUP BY
      u.country,
      u.city
  ORDER BY
      u.country,
      total_sales DESC
`;
const LOCATION_YEAR_SLICE_SQL = `
  SELECT
      u.country,
      u.city,
      d.year,
      COUNT(DISTINCT oi.source_order_id) AS total_orders,
      SUM(oi.quantity) AS total_quantity,
      SUM(oi.sales_amount) AS total_sales
  FROM OrderItem oi
  JOIN \`User\` u ON oi.user_id = u.user_id
  JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
  WHERE u.country = ?
    AND d.year = ?
  GROUP BY u.country, u.city, d.year
  ORDER BY total_sales DESC
`;
const QUARTERLY_CATEGORY_PIVOT_SQL = `
  SELECT
      p.category,
      SUM(CASE WHEN d.quarter = 1 THEN oi.sales_amount ELSE 0 END) AS Q1_sales,
      SUM(CASE WHEN d.quarter = 2 THEN oi.sales_amount ELSE 0 END) AS Q2_sales,
      SUM(CASE WHEN d.quarter = 3 THEN oi.sales_amount ELSE 0 END) AS Q3_sales,
      SUM(CASE WHEN d.quarter = 4 THEN oi.sales_amount ELSE 0 END) AS Q4_sales,
      SUM(oi.sales_amount) AS annual_sales
  FROM OrderItem oi
  JOIN Product p
      ON oi.product_id = p.product_id
  JOIN \`Date\` d
      ON oi.delivery_date_id = d.date_id
  WHERE d.year = ?
  GROUP BY p.category
  ORDER BY annual_sales DESC
`;
const LOGISTICS_DRILLDOWN_SQL = `
  SELECT
      r.courier_name,
      r.rider_name,
      r.vehicle_type,
      COUNT(DISTINCT oi.source_order_id) AS total_orders,
      SUM(oi.sales_amount)               AS total_sales
  FROM OrderItem oi
  JOIN Rider r ON oi.rider_id = r.rider_id
  JOIN \`Date\`  d ON oi.delivery_date_id = d.date_id
  JOIN Product p ON oi.product_id = p.product_id
  JOIN \`User\`  u ON oi.user_id = u.user_id
  WHERE d.full_date BETWEEN ? AND ?
    AND (? IS NULL OR p.category     = ?)
    AND (? IS NULL OR u.country      = ?)
    AND (? IS NULL OR r.courier_name = ?)
    AND (? IS NULL OR r.vehicle_type = ?)
    AND (? IS NULL OR r.rider_name   = ?)
  GROUP BY r.courier_name, r.rider_name, r.vehicle_type
  ORDER BY r.courier_name, total_sales DESC
`;

const productRowsCache = new Map();
const getProductRows = (category, product) => {
  const key = JSON.stringify([category, product]);
  const cached = productRowsCache.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const entry = {};
  entry.promise = pool.execute(PRODUCT_DRILLDOWN_SQL, [
    category, category, product, product,
  ])
    .then(([rows]) => {
      entry.expiresAt = Date.now() + 60_000;
      return rows;
    })
    .catch((error) => {
      productRowsCache.delete(key);
      throw error;
    });
  productRowsCache.set(key, entry);
  if (productRowsCache.size > 20) {
    productRowsCache.delete(productRowsCache.keys().next().value);
  }
  return entry.promise;
};
const locationRowsCache = new Map();
const getLocationRows = (country, city) => {
  const key = JSON.stringify([country, city]);
  const cached = locationRowsCache.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const entry = {};
  entry.promise = pool.execute(LOCATION_DRILLDOWN_SQL, [
    country, country, city, city,
  ])
    .then(([rows]) => {
      entry.expiresAt = Date.now() + 60_000;
      return rows;
    })
    .catch((error) => {
      locationRowsCache.delete(key);
      throw error;
    });
  locationRowsCache.set(key, entry);
  if (locationRowsCache.size > 20) {
    locationRowsCache.delete(locationRowsCache.keys().next().value);
  }
  return entry.promise;
};
const locationYearSliceCache = new Map();
const getLocationYearSliceRows = (country, year) => {
  const key = JSON.stringify([country, year]);
  const cached = locationYearSliceCache.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const entry = {};
  entry.promise = pool.execute(LOCATION_YEAR_SLICE_SQL, [country, year])
    .then(([rows]) => {
      entry.expiresAt = Date.now() + 60_000;
      return rows;
    })
    .catch((error) => {
      locationYearSliceCache.delete(key);
      throw error;
    });
  locationYearSliceCache.set(key, entry);
  if (locationYearSliceCache.size > 20) {
    locationYearSliceCache.delete(locationYearSliceCache.keys().next().value);
  }
  return entry.promise;
};
let pivotYearsCache;
const getPivotYears = async () => {
  if (pivotYearsCache && pivotYearsCache.expiresAt > Date.now()) {
    return pivotYearsCache.years;
  }
  const [rows] = await pool.query(
    'SELECT DISTINCT year FROM `Date` WHERE year IS NOT NULL ORDER BY year',
  );
  pivotYearsCache = {
    years: rows.map(({ year }) => Number(year)),
    expiresAt: Date.now() + 60_000,
  };
  return pivotYearsCache.years;
};
const quarterlyPivotCache = new Map();
const getQuarterlyCategoryPivot = async (requestedYear) => {
  const years = await getPivotYears();
  const defaultYear = years.filter((value) => value <= Number(MAX.slice(0, 4))).at(-1)
    ?? years.at(-1);
  const year = requestedYear ?? defaultYear;
  if (year == null || !years.includes(year)) {
    return { year, years, items: [], totalSales: 0 };
  }

  let entry = quarterlyPivotCache.get(year);
  if (!entry || (entry.expiresAt && entry.expiresAt <= Date.now())) {
    entry = {};
    entry.promise = pool.execute(QUARTERLY_CATEGORY_PIVOT_SQL, [year])
      .then(([rows]) => {
        entry.expiresAt = Date.now() + 60_000;
        const items = rows.map((row) => ({
          category: row.category,
          q1: Number(row.Q1_sales || 0),
          q2: Number(row.Q2_sales || 0),
          q3: Number(row.Q3_sales || 0),
          q4: Number(row.Q4_sales || 0),
          annual: Number(row.annual_sales || 0),
        }));
        return {
          year,
          years,
          items,
          totalSales: items.reduce((sum, item) => sum + item.annual, 0),
        };
      })
      .catch((error) => {
        quarterlyPivotCache.delete(year);
        throw error;
      });
    quarterlyPivotCache.set(year, entry);
    if (quarterlyPivotCache.size > 5) {
      quarterlyPivotCache.delete(quarterlyPivotCache.keys().next().value);
    }
  }
  return entry.promise;
};
const salesRollupCache = new Map();
const getSalesRollup = (filters) => {
  const key = `${filters.from}:${filters.to}`;
  const cached = salesRollupCache.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) {
    return cached.promise;
  }

  const entry = {};
  entry.promise = pool.execute(SALES_PERFORMANCE_SQL, [filters.from, filters.to])
    .then(([rows]) => {
      entry.expiresAt = Date.now() + 60_000;
      return rows;
    })
    .catch((error) => {
      salesRollupCache.delete(key);
      throw error;
    });
  salesRollupCache.set(key, entry);
  if (salesRollupCache.size > 5) {
    salesRollupCache.delete(salesRollupCache.keys().next().value);
  }
  return entry.promise;
};
const rollupTimeKey = (row, level) => {
  if (level === 0 && row.year != null) return String(row.year);
  if (level === 1 && row.year != null && row.quarter != null) {
    const quarter = String(row.quarter).replace(/^Q/i, '');
    return `${row.year} Q${quarter}`;
  }
  if (level === 2 && row.year != null && row.month != null) {
    return `${row.year}-${String(row.month).padStart(2, '0')}`;
  }
  if (level === 3 && row.full_date != null) {
    return row.full_date instanceof Date
      ? row.full_date.toISOString().slice(0, 10)
      : String(row.full_date).slice(0, 10);
  }
  return null;
};
const rollupRowsForLevel = (rows, level) => rows.filter((row) => (
  level === 0
    ? row.year != null && row.quarter == null
    : level === 1
      ? row.year != null && row.quarter != null && row.month == null
      : level === 2
        ? row.year != null && row.month != null && row.full_date == null
        : row.full_date != null
));
const getSalesPerformance = async (filters, groupBy, path) => {
  const rollup = await getSalesRollup(filters);
  const level = groupBy + path.length;
  const matchesPath = (row) => path.every(
    (value, index) => rollupTimeKey(row, groupBy + index) === value,
  );
  const items = rollupRowsForLevel(rollup, level)
    .filter(matchesPath)
    .map((row) => ({
      k: rollupTimeKey(row, level),
      sales: Number(row.total_revenue || 0),
      quantity: Number(row.total_quantity || 0),
    }));
  const total = rollup.find((row) => row.year == null);

  return {
    items,
    can: level < 3,
    level: path.length,
    totalRevenue: Number(total?.total_revenue || 0),
    totalQuantity: Number(total?.total_quantity || 0),
  };
};
const getProductReport = async (path) => {
  if (path.length === 0) {
    const [categories] = await pool.query(
      'SELECT DISTINCT category FROM Product WHERE category IS NOT NULL ORDER BY category',
    );
    const categoryReports = [];
    for (const { category } of categories) {
      categoryReports.push(await getProductReport([category]));
    }
    const items = categoryReports.map((report, index) => ({
      k: categories[index].category,
      sales: report.totalRevenue,
      quantity: report.totalQuantity,
    }));

    return {
      items,
      can: true,
      level: 0,
      totalRevenue: items.reduce((sum, row) => sum + row.sales, 0),
      totalQuantity: items.reduce((sum, row) => sum + row.quantity, 0),
    };
  }

  const category = path[0] ?? null;
  const product = path[1] ?? null;
  const rows = await getProductRows(category, product);
  const products = rows.map((row) => ({
    category: row.category,
    product: row.product_name,
    sales: Number(row.total_sales || 0),
    quantity: Number(row.quantity_sold || 0),
  }));
  const visibleRows = products.map((row) => ({ ...row, k: row.product }));

  return {
    items: visibleRows,
    can: path.length < 2,
    level: path.length,
    totalRevenue: products.reduce((sum, row) => sum + row.sales, 0),
    totalQuantity: products.reduce((sum, row) => sum + row.quantity, 0),
  };
};
const getLocationReport = async (path, requestedYear) => {
  const country = path[0] ?? null;
  const city = path[1] ?? null;
  if (country && !city) {
    const years = await getPivotYears();
    const defaultYear = years.filter((value) => value <= Number(MAX.slice(0, 4))).at(-1)
      ?? years.at(-1);
    const year = requestedYear ?? defaultYear;
    if (!years.includes(year)) {
      const error = new Error('Choose a year available in the Date table.');
      error.status = 400;
      throw error;
    }
    const rows = await getLocationYearSliceRows(country, year);
    const items = rows.map((row) => ({
      k: row.city ?? '(Unknown city)',
      country: row.country,
      sales: Number(row.total_sales || 0),
      orders: Number(row.total_orders || 0),
      quantity: Number(row.total_quantity || 0),
    }));

    return {
      items,
      can: false,
      level: path.length,
      year,
      years,
      totalSales: items.reduce((sum, row) => sum + row.sales, 0),
      totalOrders: items.reduce((sum, row) => sum + row.orders, 0),
      totalQuantity: items.reduce((sum, row) => sum + row.quantity, 0),
    };
  }
  const rows = await getLocationRows(country, city);
  const locations = rows.map((row) => ({
    country: row.country ?? '(Unknown country)',
    city: row.city ?? '(Unknown city)',
    sales: Number(row.total_sales || 0),
    orders: Number(row.total_orders || 0),
  }));
  const visibleRows = path.length === 0
    ? [...locations.reduce((groups, row) => {
      const group = groups.get(row.country) || {
        k: row.country,
        sales: 0,
        orders: 0,
      };
      group.sales += row.sales;
      group.orders += row.orders;
      groups.set(row.country, group);
      return groups;
    }, new Map()).values()]
    : locations.map((row) => ({
      ...row,
      k: row.city,
    }));

  return {
    items: visibleRows,
    can: path.length < 2,
    level: path.length,
    totalSales: locations.reduce((sum, row) => sum + row.sales, 0),
    totalOrders: locations.reduce((sum, row) => sum + row.orders, 0),
  };
};

app.get("/api/conn", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS connected");

        res.json({
            message: "MySQL connected successfully!",
            result: rows[0],
        });
    } catch (error) {
        console.error("MySQL connection error:", error.message);

        res.status(500).json({
            error: "Database connection failed",
        });
    }
});

app.get('/api/meta', async (_req, res) => {
  try {
    const [cats]      = await pool.query('SELECT DISTINCT category     FROM Product WHERE category     IS NOT NULL ORDER BY category');
    const [countries] = await pool.query('SELECT DISTINCT country      FROM `User`  WHERE country      IS NOT NULL ORDER BY country');
    const [couriers]  = await pool.query('SELECT DISTINCT courier_name FROM Rider   WHERE courier_name IS NOT NULL ORDER BY courier_name');
    const [vehicles]  = await pool.query('SELECT DISTINCT vehicle_type FROM Rider   WHERE vehicle_type IS NOT NULL ORDER BY vehicle_type');
    res.json({
      cats:      cats.map((r) => r.category),
      countries: countries.map((r) => r.country),
      couriers:  couriers.map((r) => r.courier_name),
      vehicles:  vehicles.map((r) => r.vehicle_type),
      min: MIN,
      max: MAX,
    });
  } catch (error) {
    console.error('Meta query failed:', error.message);
    res.status(500).json({ error: 'Failed to load filter metadata.' });
  }
});

app.get('/api/kpis', async (req, res) => {
  const filters = getFilters(req.query);
  if (!validateFilters(filters, res)) return;

  const startedAt = performance.now();
  try {
    const [bounds] = await pool.query(
      'SELECT MIN(date_id) AS lo, MAX(date_id) AS hi FROM `Date` WHERE full_date BETWEEN ? AND ?',
      [filters.from, filters.to],
    );
    if (!bounds[0] || bounds[0].lo == null) {
      res.json({ sales: 0, orders: 0, perOrder: 0, top: null, ms: elapsed(startedAt) });
      return;
    }
    const lo = bounds[0].lo;
    const hi = bounds[0].hi;

    const [[totals]] = await pool.query(
      `SELECT SUM(oi.sales_amount) sales,
              COUNT(*)              items,
              COUNT(DISTINCT oi.source_order_id) orders
       FROM OrderItem oi
       WHERE oi.delivery_date_id BETWEEN ? AND ?`,
      [lo, hi],
    );

    const [courierTotals] = await pool.query(
      `SELECT r.courier_name, SUM(oi.sales_amount) sales
       FROM OrderItem oi JOIN Rider r ON oi.rider_id = r.rider_id
       WHERE oi.delivery_date_id BETWEEN ? AND ?
       GROUP BY r.courier_name
       ORDER BY sales DESC
       LIMIT 1`,
      [lo, hi],
    );

    const top = courierTotals[0]
      ? [courierTotals[0].courier_name, Number(courierTotals[0].sales)]
      : null;

    res.json({
      sales:    Number(totals.sales || 0),
      orders:   Number(totals.orders || 0),
      perOrder: totals.orders ? Number(totals.items) / Number(totals.orders) : 0,
      top,
      ms:       elapsed(startedAt),
    });
  } catch (error) {
    console.error('KPI query failed:', error.message);
    res.status(500).json({ error: 'Failed to load KPI summary.' });
  }
});

app.get('/api/report', async (req, res) => {
  const filters = getFilters(req.query);
  const tab = queryString(req.query.tab);
  const path = queryList(req.query.path);
  const locationYearText = queryString(req.query.year);
  const locationYear = locationYearText ? Number(locationYearText) : null;
  const groupBy = Number(queryString(req.query.gb, '1'));

  if (!validateFilters(filters, res)) return;
  if (!['time', 'prod', 'loc', 'log'].includes(tab)) {
    res.status(400).json({ error: 'Choose a valid report tab.' });
    return;
  }
  if (!Number.isInteger(groupBy) || groupBy < 0 || groupBy > 3) {
    res.status(400).json({ error: 'Choose a valid time grouping.' });
    return;
  }

  const startedAt = performance.now();

  if (tab === 'loc') {
    if (path.length > 1) {
      res.status(400).json({ error: 'The selected location drill-down is too deep.' });
      return;
    }
    if (locationYearText && (!/^\d{4}$/.test(locationYearText) || !Number.isInteger(locationYear))) {
      res.status(400).json({ error: 'Choose a valid four-digit year.' });
      return;
    }

    try {
      const report = await getLocationReport(path, locationYear);
      res.json({ ...report, ms: elapsed(startedAt) });
    } catch (error) {
      if (error.status === 400) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Customer location query failed:', error.message);
      res.status(500).json({ error: 'Failed to load customer locations from the database.' });
    }
    return;
  }

  if (tab === 'prod') {
    if (path.length > 2) {
      res.status(400).json({ error: 'The selected product drill-down is too deep.' });
      return;
    }

    try {
      const report = await getProductReport(path);
      res.json({ ...report, ms: elapsed(startedAt) });
    } catch (error) {
      console.error('Product drill-down query failed:', error.message);
      res.status(500).json({ error: 'Failed to load product sales from the database.' });
    }
    return;
  }

  if (tab === 'time') {
    const level = groupBy + path.length;
    if (level > 3) {
      res.status(400).json({ error: 'The selected time drill-down is too deep.' });
      return;
    }

    try {
      const report = await getSalesPerformance(filters, groupBy, path);
      res.json({ ...report, ms: elapsed(startedAt) });
    } catch (error) {
      console.error('Sales performance query failed:', error.message);
      res.status(500).json({ error: 'Failed to load sales performance from the database.' });
    }
    return;
  }

  if (tab === 'log') {
    if (path.length > 1) {
      res.status(400).json({ error: 'The selected logistics drill-down is too deep.' });
      return;
    }
    const courier = path[0] ?? null;
    const rider   = path[1] ?? null;

    try {
      const [rows] = await pool.execute(LOGISTICS_DRILLDOWN_SQL, [
        filters.from, filters.to,
        filters.cats.length === 1 ? filters.cats[0] : null,
        filters.cats.length === 1 ? filters.cats[0] : null,
        filters.country || null, filters.country || null,
        filters.courier || null, filters.courier || null,
        filters.vehicle || null, filters.vehicle || null,
        rider, rider,
      ]);

      const data = rows.map((row) => ({
        courier: row.courier_name,
        rider:   row.rider_name,
        vehicle: row.vehicle_type,
        sales:   Number(row.total_sales || 0),
        orders:  Number(row.total_orders || 0),
      }));

      if (path.length === 0) {
        const groups = new Map();
        data.forEach((row) => {
          const g = groups.get(row.courier) || { k: row.courier, sales: 0, orders: 0 };
          g.sales  += row.sales;
          g.orders += row.orders;
          groups.set(row.courier, g);
        });
        const items = [...groups.values()];
        res.json({
          items,
          can: true,
          level: 0,
          totalRevenue: items.reduce((s, r) => s + r.sales, 0),
          totalOrders:  items.reduce((s, r) => s + r.orders, 0),
          ms: elapsed(startedAt),
        });
        return;
      }

      const items = data
        .filter((row) => row.courier === courier)
        .map((row) => ({ k: row.rider, sales: row.sales, orders: row.orders }));

      res.json({
        items,
        can: false,
        level: 1,
        totalRevenue: items.reduce((s, r) => s + r.sales, 0),
        totalOrders:  items.reduce((s, r) => s + r.orders, 0),
        ms: elapsed(startedAt),
      });
    } catch (error) {
      console.error('Logistics query failed:', error.message);
      res.status(500).json({ error: 'Failed to load logistics data from the database.' });
    }
    return;
  }
});

app.get('/api/pivot', async (req, res) => {
  const requestedYearText = queryString(req.query.year);
  const requestedYear = requestedYearText ? Number(requestedYearText) : null;
  if (requestedYearText && (!/^\d{4}$/.test(requestedYearText) || !Number.isInteger(requestedYear))) {
    res.status(400).json({ error: 'Choose a valid four-digit year.' });
    return;
  }

  const startedAt = performance.now();
  try {
    const years = await getPivotYears();
    if (requestedYear != null && !years.includes(requestedYear)) {
      res.status(400).json({ error: 'Choose a year available in the Date table.' });
      return;
    }
    const pivot = await getQuarterlyCategoryPivot(requestedYear);
    res.json({ ...pivot, ms: elapsed(startedAt) });
  } catch (error) {
    console.error('Quarterly category pivot query failed:', error.message);
    res.status(500).json({ error: 'Failed to load quarterly category sales from the database.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});