import express from 'express';
import cors from 'cors';
import mysql from "mysql2/promise";
import 'dotenv/config';

const pool = mysql.createPool({
    host: process.env.HOST,
    user: process.env.USER,
    password: process.env.PASSWORD,         // change to mysql password
    database: process.env.DB,
    port: process.env.DB_PORT
});

const app = express();
app.use(cors()); // Allow requests from your frontend
app.use(express.json());

const PORT = process.env.PORT;
const MIN = '2024-09-24';
const MAX = '2025-09-23';
const CATS = {
  Toys: ['Toy robot:350', 'Building blocks:890', 'Plush bear:520'],
  Bags: ['Backpack:1450', 'Tote bag:780', 'Sling bag:990'],
  Makeup: ['Lipstick:420', 'Foundation:850', 'Eyeshadow kit:1100'],
  Gadgets: ['Smart watch:2900', 'Earbuds:1500', 'Power bank:900'],
  Clothes: ['T-shirt:350', 'Dress:1200', 'Jacket:2100'],
  "Men's Apparel": ['Polo shirt:650', 'Chinos:1100', 'Denim jeans:1500'],
  Electronics: ['Bluetooth speaker:1800', 'Monitor:6500', 'Keyboard:1300'],
  Appliances: ['Air fryer:3200', 'Rice cooker:1900', 'Electric fan:1400'],
  Laptops: ['Laptop 14in:32000', 'Laptop 16in:45000', 'Gaming laptop:62000'],
};
const COUNTRIES = [
  'Sudan', 'Dominican Republic', 'Reunion', 'Slovenia',
  'United States of America', 'Equatorial Guinea', 'Antarctica',
  'North Macedonia', 'Slovakia', 'Luxembourg', 'Kyrgyz Republic',
  'Cook Islands',
];
const COURIERS = {
  JNT: ['JNT Rider 1', 'JNT Rider 2', 'JNT Rider 3', 'JNT Rider 4'],
  FEDEZ: ['FEDEZ Rider 1', 'FEDEZ Rider 2', 'FEDEZ Rider 3', 'FEDEZ Rider 4'],
  LBCD: ['LBCD Rider 1', 'LBCD Rider 2', 'LBCD Rider 3', 'LBCD Rider 4'],
};
const VEHICLES = ['Motorcycle', 'Bicycle', 'Car', 'Tricycle'];
const META = {
  cats: Object.keys(CATS),
  countries: COUNTRIES.slice().sort(),
  couriers: Object.keys(COURIERS),
  vehicles: VEHICLES,
};
const DIMS = {
  prod: ['cat', 'prod'],
  loc: ['country', 'city'],
  log: ['courier', 'rider'],
};

let seed = 7;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6D2B79F5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
const pick = (values) => values[Math.floor(rnd() * values.length)];
const startDate = Date.UTC(2024, 8, 24);
const rows = [];

for (let orderId = 1; orderId <= 2500; orderId++) {
  const courier = pick(Object.keys(COURIERS));
  const rider = pick(COURIERS[courier]);
  const country = COUNTRIES[Math.floor(Math.pow(rnd(), 1.6) * COUNTRIES.length)];
  const city = `City ${1 + Math.floor(rnd() * 4)}`;
  const vehicle = VEHICLES[(rider.length + rider.charCodeAt(rider.length - 1)) % VEHICLES.length];
  const date = new Date(startDate + Math.floor(365 * rnd()) * 864e5)
    .toISOString().slice(0, 10);
  const orderItems = new Set();

  for (let i = 0, count = 1 + Math.floor(rnd() * 3); i < count; i++) {
    orderItems.add(`${pick(Object.keys(CATS))}|${Math.floor(rnd() * 3)}`);
  }

  orderItems.forEach((item) => {
    const [category, index] = item.split('|');
    const [product, price] = CATS[category][Number(index)].split(':');
    const units = 1 + Math.floor(rnd() * 10);
    rows.push({
      oid: orderId,
      d: date,
      cat: category,
      prod: product,
      country,
      city,
      courier,
      rider,
      vehicle,
      units,
      sales: units * Number(price),
    });
  });
}

const timeKey = (date, level) => (
  level === 0
    ? date.slice(0, 4)
    : level === 1
      ? `${date.slice(0, 4)} Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`
      : level === 2
        ? date.slice(0, 7)
        : date
);
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
const filterRows = (filters) => rows.filter((row) => (
  row.d >= filters.from
  && row.d <= filters.to
  && (!filters.cats.length || filters.cats.includes(row.cat))
  && (!filters.country || row.country === filters.country)
  && (!filters.courier || row.courier === filters.courier)
  && (!filters.vehicle || row.vehicle === filters.vehicle)
));
const groupRows = (filteredRows, keyFor) => {
  const groups = new Map();
  filteredRows.forEach((row) => {
    const key = keyFor(row);
    const group = groups.get(key) || { k: key, sales: 0, ids: new Set() };
    group.sales += row.sales;
    group.ids.add(row.oid);
    groups.set(key, group);
  });
  return [...groups.values()].map(({ k, sales, ids }) => ({
    k,
    sales,
    orders: ids.size,
  }));
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
    const categoryReports = await Promise.all(categories.map(({ category }) => (
      getProductReport([category])
    )));
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
  const visibleRows = path.length === 0
    ? [...products.reduce((groups, row) => {
      const group = groups.get(row.category) || {
        k: row.category,
        sales: 0,
        quantity: 0,
      };
      group.sales += row.sales;
      group.quantity += row.quantity;
      groups.set(row.category, group);
      return groups;
    }, new Map()).values()]
    : products.map((row) => ({ ...row, k: row.product }));

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

app.get('/api/meta', (_req, res) => {
  res.json({ ...META, min: MIN, max: MAX });
});

app.get('/api/kpis', (req, res) => {
  const filters = getFilters(req.query);
  if (!validateFilters(filters, res)) return;

  const startedAt = performance.now();
  const filteredRows = filterRows(filters);
  const orderIds = new Set(filteredRows.map((row) => row.oid));
  const courierSales = {};
  filteredRows.forEach((row) => {
    courierSales[row.courier] = (courierSales[row.courier] || 0) + row.sales;
  });
  const top = Object.entries(courierSales).sort((a, b) => b[1] - a[1])[0] || null;

  res.json({
    sales: filteredRows.reduce((sum, row) => sum + row.sales, 0),
    orders: orderIds.size,
    perOrder: orderIds.size ? filteredRows.length / orderIds.size : 0,
    top,
    ms: elapsed(startedAt),
  });
});

app.get('/api/report', async (req, res) => {
  const filters = getFilters(req.query);
  const tab = queryString(req.query.tab);
  const path = queryList(req.query.path);
  const locationYearText = queryString(req.query.year);
  const locationYear = locationYearText ? Number(locationYearText) : null;
  const groupBy = Number(queryString(req.query.gb, '1'));

  if (!validateFilters(filters, res)) return;
  if (!['time', ...Object.keys(DIMS)].includes(tab)) {
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

  let filteredRows = filterRows(filters);
  let keyFor;
  let canDrill;

  const dimensions = DIMS[tab];
  if (path.length >= dimensions.length) {
    res.status(400).json({ error: 'The selected report drill-down is too deep.' });
    return;
  }
  path.forEach((value, index) => {
    filteredRows = filteredRows.filter((row) => row[dimensions[index]] === value);
  });
  keyFor = (row) => row[dimensions[path.length]];
  canDrill = path.length < dimensions.length - 1;

  res.json({
    items: groupRows(filteredRows, keyFor),
    can: canDrill,
    level: path.length,
    ms: elapsed(startedAt),
  });
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
