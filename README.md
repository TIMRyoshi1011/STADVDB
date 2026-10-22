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

Open the frontend at `http://localhost:5173/`.

For a separate frontend/backend deployment, set `VITE_API_URL` in the frontend
deployment environment to the backend's base URL (for example,
`https://your-api-host`, without an `/api` suffix), then rebuild and redeploy
the frontend. Local development uses the Vite `/api` proxy automatically.
