# STADVDB OLAP Application

## Note: server is working, run on main terminal

Instructions
- Go to client folder: `cd client`
- Install dependencies (on client folder): `npm i chart.js react-chartjs-2`
- Go back to main: `cd ..`
- Go to server folder: `cd server`
- Install dependencies (on server folder): `npm install express mysql2`
- Go back to main: `cd ..`
- Install dependencies (on main folder): `npm i concurrently`
- Run: `npm run dev`
- Open `http://localhost:3000/api/conn`, `http://localhost:3000/api/dashboard` and `http://localhost:5173/` in browser

The Vite development server proxies `/api` requests to Express at
`http://localhost:3000`. The dashboard loads its summary and chart data from
`GET /api/dashboard?period=Month`