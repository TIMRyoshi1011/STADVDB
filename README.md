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

The backend serves the dashboard's in-memory sample dataset; it does not
connect to MySQL or require a database. Its endpoints are:

- `GET /api/meta` — filter options
- `GET /api/kpis` — sales summary and courier totals
- `GET /api/report` — chart and drill-down data
- `GET /api/pivot` — pivot table data