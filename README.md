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

The Sales Performance tab runs its annual sales roll-up against the MySQL
database configured in `server/.env`. It requires the `OrderItem` and `Date`
tables and their `delivery_date_id`, `date_id`, `year`, `quarter`, `month`,
`month_name`, `full_date`, `sales_amount`, and `quantity` columns. The date
range controls filter by delivery date. The Products tab also queries MySQL,
drilling from category totals into product totals. Customers by Location,
Logistics, and Pivot Table continue to use the backend's in-memory sample
dataset. Products requires `OrderItem.product_id`, `OrderItem.quantity`,
`OrderItem.sales_amount`, and `Product.product_id`, `Product.category`, and
`Product.product_name`.

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

The backend does not create database indexes automatically.

- `GET /api/meta` — filter options
- `GET /api/kpis` — sample-data sales summary and courier totals
- `GET /api/report?tab=time` — MySQL roll-up chart and drill-down data
- `GET /api/report?tab=prod` — MySQL category/product sales and quantity data
- `GET /api/report` — sample-data chart and drill-down data for other reports
- `GET /api/pivot` — pivot table data