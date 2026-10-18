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
  from: queryString(query.from),
  to: queryString(query.to),
  cats: queryList(query.cats),
  country: queryString(query.country),
  courier: queryString(query.courier),
  vehicle: queryString(query.vehicle),
});
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
const validateFilters = (filters, res) => {
  if ((filters.from && !validDate(filters.from))
    || (filters.to && !validDate(filters.to))
    || (filters.from && filters.to && filters.from > filters.to)) {
    res.status(400).json({ error: 'Provide a valid date range using YYYY-MM-DD dates.' });
    return false;
  }
  return true;
};
const elapsed = (startedAt) => Math.round(performance.now() - startedAt);
let deliveryDateBoundsCache;
let deliveryDateBoundsPromise;
const getDeliveryDateBounds = async () => {
  if (deliveryDateBoundsCache?.expiresAt > Date.now()) return deliveryDateBoundsCache.bounds;
  if (!deliveryDateBoundsPromise) {
    deliveryDateBoundsPromise = pool.query(`
      SELECT
        DATE_FORMAT(MIN(d.full_date), '%Y-%m-%d') AS min,
        DATE_FORMAT(MAX(d.full_date), '%Y-%m-%d') AS max
      FROM OrderItem oi
      JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    `)
      .then(([rows]) => {
        const bounds = rows[0];
        deliveryDateBoundsCache = { bounds, expiresAt: Date.now() + 60_000 };
        return bounds;
      })
      .catch((error) => {
        deliveryDateBoundsPromise = null;
        throw error;
      });
  }
  const bounds = await deliveryDateBoundsPromise;
  deliveryDateBoundsPromise = null;
  return bounds;
};
const SALES_PERFORMANCE_SQL = (where) => `
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
  ${where}
  GROUP BY
      d.year,
      d.quarter,
      d.month,
      d.month_name,
      d.full_date
  WITH ROLLUP
`;
const getLogisticsWhere = async (filters) => {
  const conditions = [];
  const params = [];
  const joins = [];
  const dateBounds = filters.from || filters.to ? await getDeliveryDateBounds() : null;
  const fromIsRestricted = filters.from && (!dateBounds?.min || filters.from > dateBounds.min);
  const toIsRestricted = filters.to && (!dateBounds?.max || filters.to < dateBounds.max);
  if (fromIsRestricted) {
    conditions.push('d.full_date >= ?');
    params.push(filters.from);
  }
  if (toIsRestricted) {
    conditions.push('d.full_date <= ?');
    params.push(filters.to);
  }
  if (fromIsRestricted || toIsRestricted) {
    joins.push('JOIN `Date` d ON oi.delivery_date_id = d.date_id');
  }
  if (filters.country) {
    conditions.push('u.country = ?');
    params.push(filters.country);
    joins.push('JOIN `User` u ON oi.user_id = u.user_id');
  }
  if (filters.courier) {
    conditions.push('r.courier_name = ?');
    params.push(filters.courier);
  }
  if (filters.vehicle) {
    conditions.push('r.vehicle_type = ?');
    params.push(filters.vehicle);
  }
  if (filters.cats.length) {
    conditions.push(`p.category IN (${filters.cats.map(() => '?').join(', ')})`);
    params.push(...filters.cats);
    joins.push('JOIN Product p ON oi.product_id = p.product_id');
  }
  joins.push('JOIN Rider r ON oi.rider_id = r.rider_id');
  return {
    from: `FROM OrderItem oi ${joins.join(' ')}`,
    where: conditions.length ? conditions.join(' AND ') : '1 = 1',
    params,
    factFirst: !(
      fromIsRestricted || toIsRestricted || filters.country
      || filters.courier || filters.vehicle || filters.cats.length
    ),
  };
};
const getLogisticsSummary = async (filters) => {
  const { from, where, params, factFirst } = await getLogisticsWhere(filters);
  const [rows] = await pool.execute(`
    SELECT ${factFirst ? 'STRAIGHT_JOIN' : ''}
      r.courier_name AS courier,
      SUM(oi.sales_amount) AS sales,
      COUNT(DISTINCT oi.source_order_id) AS orders,
      COUNT(*) AS item_lines,
      GROUPING(r.courier_name) AS is_total
    ${from}
    WHERE ${where}
    GROUP BY r.courier_name WITH ROLLUP
  `, params);
  const total = rows.find((row) => Number(row.is_total) === 1);
  const couriers = rows
    .filter((row) => Number(row.is_total) === 0)
    .sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0));
  const sales = Number(total?.sales || 0);
  const orders = Number(total?.orders || 0);
  return {
    sales,
    orders,
    perOrder: orders ? Number(total?.item_lines || 0) / orders : 0,
    top: couriers.length
      ? [couriers[0].courier ?? '(Unknown)', Number(couriers[0].sales || 0)]
      : null,
  };
};
const logisticsReportCache = new Map();
const getLogisticsReportRows = (filters) => {
  const key = JSON.stringify(filters);
  const cached = logisticsReportCache.get(key);
  if (cached && (!cached.expiresAt || cached.expiresAt > Date.now())) return cached.promise;

  const entry = {};
  entry.promise = (async () => {
    const { from, where, params, factFirst } = await getLogisticsWhere(filters);
    const [rows] = await pool.execute(`
      SELECT ${factFirst ? 'STRAIGHT_JOIN' : ''}
        r.courier_name AS courier,
        r.rider_name AS rider,
        SUM(oi.sales_amount) AS total_sales,
        COUNT(DISTINCT oi.source_order_id) AS total_orders,
        COUNT(*) AS item_lines,
        GROUPING(r.courier_name) AS is_grand_total,
        GROUPING(r.rider_name) AS is_courier_total
      ${from}
      WHERE ${where}
      GROUP BY r.courier_name, r.rider_name WITH ROLLUP
    `, params);
    return rows;
  })()
    .then((rows) => {
      entry.expiresAt = Date.now() + 60_000;
      return rows;
    })
    .catch((error) => {
      logisticsReportCache.delete(key);
      throw error;
    });
  logisticsReportCache.set(key, entry);
  if (logisticsReportCache.size > 5) {
    logisticsReportCache.delete(logisticsReportCache.keys().next().value);
  }
  return entry.promise;
};
const PRODUCT_DRILLDOWN_SQL = (where, factFirst) => `
  SELECT ${factFirst ? 'STRAIGHT_JOIN' : ''}
      p.category,
      p.product_name,
      SUM(oi.quantity) AS quantity_sold,
      SUM(oi.sales_amount) AS total_sales
  FROM OrderItem oi
  JOIN Product p ON oi.product_id = p.product_id
  WHERE ${where}
  GROUP BY
      p.category,
      p.product_id,
      p.product_name
  ORDER BY
      p.category,
      total_sales DESC
`;
const LOCATION_DRILLDOWN_SQL = (where, factFirst) => `
  SELECT ${factFirst ? 'STRAIGHT_JOIN' : ''}
      u.country,
      u.city,
      COUNT(DISTINCT oi.source_order_id) AS total_orders,
      SUM(oi.sales_amount) AS total_sales
  FROM OrderItem oi
  JOIN \`User\` u ON oi.user_id = u.user_id
  WHERE ${where}
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
  const conditions = [];
  const params = [];
  if (category != null) {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (product != null) {
    conditions.push('p.product_name = ?');
    params.push(product);
  }
  entry.promise = pool.execute(
    PRODUCT_DRILLDOWN_SQL(
      conditions.length ? conditions.join(' AND ') : '1 = 1',
      category == null && product == null,
    ),
    params,
  )
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
  const conditions = [];
  const params = [];
  if (country != null) {
    conditions.push('u.country = ?');
    params.push(country);
  }
  if (city != null) {
    conditions.push('u.city = ?');
    params.push(city);
  }
  entry.promise = pool.execute(
    LOCATION_DRILLDOWN_SQL(
      conditions.length ? conditions.join(' AND ') : '1 = 1',
      country == null && city == null,
    ),
    params,
  )
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
  const [rows] = await pool.query(`
    SELECT DISTINCT d.year
    FROM OrderItem oi
    JOIN \`Date\` d ON oi.delivery_date_id = d.date_id
    WHERE d.year IS NOT NULL
    ORDER BY d.year
  `);
  pivotYearsCache = {
    years: rows.map(({ year }) => Number(year)),
    expiresAt: Date.now() + 60_000,
  };
  return pivotYearsCache.years;
};
const quarterlyPivotCache = new Map();
const getQuarterlyCategoryPivot = async (requestedYear) => {
  const years = await getPivotYears();
  const defaultYear = years.at(-1);
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
  const conditions = [];
  const params = [];
  if (filters.from) {
    conditions.push('d.full_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push('d.full_date <= ?');
    params.push(filters.to);
  }
  entry.promise = pool.execute(
    SALES_PERFORMANCE_SQL(conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''),
    params,
  )
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
    const rows = await getProductRows(null, null);
    const groups = new Map();
    rows.forEach((row) => {
      if (row.category == null) return;
      const group = groups.get(row.category) || {
        k: row.category,
        sales: 0,
        quantity: 0,
      };
      group.sales += Number(row.total_sales || 0);
      group.quantity += Number(row.quantity_sold || 0);
      groups.set(row.category, group);
    });
    const items = [...groups.values()];

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
    const defaultYear = years.at(-1);
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
  Promise.all([
    pool.query('SELECT DISTINCT category FROM Product WHERE category IS NOT NULL ORDER BY category'),
    pool.query('SELECT DISTINCT country FROM `User` WHERE country IS NOT NULL ORDER BY country'),
    pool.query('SELECT DISTINCT courier_name FROM Rider WHERE courier_name IS NOT NULL ORDER BY courier_name'),
    pool.query('SELECT DISTINCT vehicle_type FROM Rider WHERE vehicle_type IS NOT NULL ORDER BY vehicle_type'),
    getDeliveryDateBounds(),
  ])
    .then(([categories, countries, couriers, vehicles, dateBounds]) => {
      res.json({
        cats: categories[0].map(({ category }) => category),
        countries: countries[0].map(({ country }) => country),
        couriers: couriers[0].map(({ courier_name }) => courier_name),
        vehicles: vehicles[0].map(({ vehicle_type }) => vehicle_type),
        min: dateBounds.min,
        max: dateBounds.max,
      });
    })
    .catch((error) => {
      console.error('Dashboard metadata query failed:', error.message);
      res.status(500).json({ error: 'Failed to load dashboard metadata from the database.' });
    });
});

app.get('/api/kpis', async (req, res) => {
  const filters = getFilters(req.query);
  if (!validateFilters(filters, res)) return;

  const startedAt = performance.now();
  try {
    res.json({ ...await getLogisticsSummary(filters), ms: elapsed(startedAt) });
  } catch (error) {
    console.error('Logistics KPI query failed:', error.message);
    res.status(500).json({ error: 'Failed to load logistics KPIs from the database.' });
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
    try {
      const rows = await getLogisticsReportRows(filters);
      const total = rows.find((row) => (
        Number(row.is_grand_total) === 1 && Number(row.is_courier_total) === 1
      ));
      const courierRows = rows
        .filter((row) => (
          Number(row.is_grand_total) === 0 && Number(row.is_courier_total) === 1
        ))
        .sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0));
      const selectedCourier = path[0] === '(Unknown)' ? null : path[0];
      const visibleRows = path.length
        ? rows.filter((row) => (
          Number(row.is_grand_total) === 0
          && Number(row.is_courier_total) === 0
          && row.courier === selectedCourier
        )).map((row) => ({
          k: row.rider ?? '(Unknown)',
          sales: Number(row.total_sales || 0),
          orders: Number(row.total_orders || 0),
        }))
        : courierRows.map((row) => ({
          k: row.courier ?? '(Unknown)',
          sales: Number(row.total_sales || 0),
          orders: Number(row.total_orders || 0),
        }));
      const sales = Number(total?.total_sales || 0);
      const orders = Number(total?.total_orders || 0);
      res.json({
        items: visibleRows,
        can: path.length === 0,
        level: path.length,
        kpi: {
          sales,
          orders,
          perOrder: orders ? Number(total?.item_lines || 0) / orders : 0,
          top: courierRows.length
            ? [courierRows[0].courier ?? '(Unknown)', Number(courierRows[0].total_sales || 0)]
            : null,
        },
        ms: elapsed(startedAt),
      });
    } catch (error) {
      console.error('Logistics report query failed:', error.message);
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
