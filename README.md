# STADVDB OLAP Application

## Run the application

From the repository root, install dependencies and start both applications:

```sh
npm install
npm install --prefix client
npm install --prefix server
npm run dev
```

Open the frontend at `http://localhost:5173/`. The Express backend runs at
`http://localhost:3000`, and Vite proxies frontend `/api` requests to it.

The backend serves the dashboard's in-memory sample dataset; it does not
connect to MySQL or require a database. Its endpoints are:

- `GET /api/meta` — filter options
- `GET /api/kpis` — sales summary and courier totals
- `GET /api/report` — chart and drill-down data
- `GET /api/pivot` — pivot table data