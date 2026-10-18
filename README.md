# STADVDB OLAP Application

## Note: server is working, run on main terminal

Instructions

Install dependencies: npm install chart.js react-chartjs-2 concurrently
Run: npm run dev

The Vite development server proxies `/api` requests to Express at
`http://localhost:3000`. The dashboard loads its summary and chart data from
`GET /api/dashboard?period=Month`. The endpoint currently returns the dashboard's
existing sample data; connect it to the database to serve live analytics.