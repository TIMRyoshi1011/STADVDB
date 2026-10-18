import express from "express";
import pool from "./conn.js";

const app = express();
const PORT = 3000;
const periods = new Set(["Year", "Quarter", "Month", "Day"]);

app.get("/", (req, res) => {
    res.send("Hello, World!");
});

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

app.get("/api/dashboard", (req, res) => {
    const period = req.query.period ?? "Month";

    if (typeof period !== "string" || !periods.has(period)) {
        return res.status(400).json({ error: "period must be Year, Quarter, Month, or Day" });
    }

    res.json({
        period,
        analytics: [
            { title: "Groups Sales", value: "Php 0.00" },
            { title: "Total Units Sold", value: "0.00 units" },
            { title: "Total Shipments", value: "0 orders" },
            { title: "Active Couriers", value: "0 couriers" },
        ],
        sales: {
            labels: [
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September",
            ],
            values: [
                4662889789.09, 4218529944.15, 4645613828.26,
                4524619360.06, 4651692792.81, 4494058740.44,
                4657874928.79, 4655495875.24, 3457438340.27,
            ],
        },
        products: {
            labels: ["Toys", "Appliances", "Makeup", "Bags", "Gadgets"],
            values: [6678, 1292, 2633, 1278, 1251],
        },
        countries: {
            labels: [
                "North Macedonia", "French Southern Territories", "Sudan",
                "Slovakia", "Reunion", "Cook Islands", "Afghanistan",
                "Luxembourg", "Kyrgyz Republic", "Mayonette",
            ],
            values: [26, 21, 21, 20, 21, 20, 20, 21, 28, 20],
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});