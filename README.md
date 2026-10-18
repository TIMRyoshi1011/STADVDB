# STADVDB OLAP Application

Instructions
- Go to client folder: `cd client`
- Install dependencies (on client folder): `npm i chart.js react-chartjs-2`
- Go back to main: `cd ..`
- Go to server folder: `cd server`
- Install dependencies (on server folder): `npm install express mysql2 dotenv`
- Go back to main: `cd ..`
- Install dependencies (on main folder): `npm i concurrently`
- Run: `npm run dev`

Open the frontend at `http://localhost:5173/`. The Express backend runs at
`http://localhost:3000`, and Vite proxies frontend `/api` requests to it.

All dashboard data, including filter options, date boundaries, logistics, and
KPIs, is queried from the MySQL database configured in `server/.env`; there is
no in-memory sample-data fallback. The date controls use the minimum and
maximum delivery dates present in `OrderItem`. The Sales Performance tab runs
its roll-up against the database and requires the `OrderItem` and `Date` tables
and their `delivery_date_id`, `date_id`, `year`, `quarter`, `month`,
`month_name`, `full_date`, `sales_amount`, and `quantity` columns. The Products tab drills
from category totals into product totals. Customers by Location drills from
country into city. The Pivot Table shows quarterly category sales for a
selected year. Products requires
`OrderItem.product_id`, `OrderItem.quantity`, `OrderItem.sales_amount`, and
`Product.product_id`, `Product.category`, and `Product.product_name`.
Customers by Location requires `OrderItem.user_id`,
`OrderItem.source_order_id`, `OrderItem.sales_amount`, and `User.user_id`,
`User.country`, and `User.city`. The selected country can be sliced by year
and city using `OrderItem.delivery_date_id`, `OrderItem.quantity`, `Date.date_id`,
and `Date.year`. Pivot Table requires `OrderItem.product_id`,
`OrderItem.delivery_date_id`, `OrderItem.sales_amount`, `Product.product_id`,
`Product.category`, `Date.date_id`, `Date.year`, and `Date.quarter`. Logistics
and its filter options require `OrderItem.rider_id`,
`OrderItem.source_order_id`, `OrderItem.user_id`, `OrderItem.product_id`,
`OrderItem.delivery_date_id`, `OrderItem.sales_amount`, `Rider.rider_id`,
`Rider.rider_name`, `Rider.courier_name`, `Rider.vehicle_type`, `User.user_id`,
`User.country`, `Product.product_id`, `Product.category`, and `Date.date_id`,
`Date.full_date`.

For large `OrderItem` tables, a covering index can improve roll-up query
performance. Apply this explicitly if appropriate for your database:

```sql
CREATE INDEX idx_orderitem_delivery_rollup
ON OrderItem (delivery_date_id, sales_amount, quantity);
```

The Products tab can also benefit from a covering index:

```sql
CREATE INDEX idx_orderitem_product_sales_quantity
ON OrderItem (product_id, sales_amount, quantity);
```

Customers by Location can benefit from a covering index:

```sql
CREATE INDEX idx_orderitem_user_location
ON OrderItem (user_id, source_order_id, sales_amount);
```

The quarterly pivot can benefit from a delivery-date/product covering index:

```sql
CREATE INDEX idx_orderitem_date_product_sales
ON OrderItem (delivery_date_id, product_id, sales_amount);
```

Logistics can benefit from a rider/order covering index:

```sql
CREATE INDEX idx_orderitem_rider_orders_sales
ON OrderItem (rider_id, source_order_id, sales_amount);
```

The backend does not create database indexes automatically.

- `GET /api/meta` — database-backed filter options and date boundaries
- `GET /api/kpis` — database-backed logistics sales summary and courier totals
- `GET /api/report?tab=time` — MySQL roll-up chart and drill-down data
- `GET /api/report?tab=prod` — MySQL category/product sales and quantity data
- `GET /api/report?tab=loc` — MySQL country/city order counts and sales
- `GET /api/report?tab=loc&path=<country>&year=2025` — MySQL city sales, orders, and quantity for a country/year
- `GET /api/report?tab=log` — database-backed courier/rider logistics data and KPIs
- `GET /api/pivot?year=2024` — MySQL quarterly sales by category for the selected year