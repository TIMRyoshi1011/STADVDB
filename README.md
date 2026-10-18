# STADVDB OLAP Application

## Note: server is working, run on main terminal

Instructions

- Install dependencies (on client folder): `npm i chart.js react-chartjs-2`
- Go back to main: `cd ..`
- Install dependencies again (on main folder): `npm i concurrently`
- Run: `npm run dev`
- Open `http://localhost:3000/api/dashboard` and `http://localhost:5173/` in browser

The Vite development server proxies `/api` requests to Express at
`http://localhost:3000`. The dashboard loads its summary and chart data from
`GET /api/dashboard?period=Month`. The endpoint currently returns the dashboard's
existing sample data; connect it to the database to serve live analytics.