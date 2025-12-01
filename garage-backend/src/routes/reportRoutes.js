const express = require("express");
const router = express.Router();
const db = require("../../database/db");

const getAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

const allAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

router.get("/daily", async (req, res) => {
    const { date = new Date().toISOString().slice(0, 10) } = req.query;

    try {
        const revenueRow = await getAsync(
            `
            SELECT COALESCE(SUM(final_total), 0) AS revenue
            FROM Invoices
            WHERE DATE(invoice_date) = DATE(?)
        `,
            [date]
        );

        const expenseRow = await getAsync(
            `
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM Expenses
            WHERE DATE(expense_date) = DATE(?)
        `,
            [date]
        );

        const jobsSummary = await getAsync(
            `
            SELECT
                COUNT(*) AS total_jobs,
                SUM(CASE WHEN job_status = 'Completed' THEN 1 ELSE 0 END) AS completed_jobs,
                SUM(CASE WHEN job_status = 'Pending' THEN 1 ELSE 0 END) AS pending_jobs
            FROM Jobs
            WHERE DATE(created_at) = DATE(?)
        `,
            [date]
        );

        res.json({
            date,
            revenue: revenueRow.revenue,
            expenses: expenseRow.expenses,
            net: revenueRow.revenue - expenseRow.expenses,
            jobs: jobsSummary,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/monthly", async (req, res) => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = req.query;

    try {
        const revenueRow = await getAsync(
            `
            SELECT COALESCE(SUM(final_total), 0) AS revenue
            FROM Invoices
            WHERE strftime('%m', invoice_date) = printf('%02d', ?) AND strftime('%Y', invoice_date) = ?
        `,
            [month, year]
        );

        const expenseRow = await getAsync(
            `
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM Expenses
            WHERE strftime('%m', expense_date) = printf('%02d', ?) AND strftime('%Y', expense_date) = ?
        `,
            [month, year]
        );

        const jobs = await allAsync(
            `
            SELECT job_status, COUNT(*) AS count
            FROM Jobs
            WHERE strftime('%m', created_at) = printf('%02d', ?) AND strftime('%Y', created_at) = ?
            GROUP BY job_status
        `,
            [month, year]
        );

        res.json({
            month: Number(month),
            year: Number(year),
            revenue: revenueRow.revenue,
            expenses: expenseRow.expenses,
            net: revenueRow.revenue - expenseRow.expenses,
            jobs,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/inventory", async (_req, res) => {
    try {
        const inventory = await allAsync(
            `
            SELECT
                InventoryItems.*,
                COALESCE(usage_summary.total_used, 0) AS total_used,
                CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END AS low_stock
            FROM InventoryItems
            LEFT JOIN (
                SELECT inventory_item_id, SUM(quantity) AS total_used
                FROM JobItems
                WHERE inventory_item_id IS NOT NULL
                GROUP BY inventory_item_id
            ) AS usage_summary ON usage_summary.inventory_item_id = InventoryItems.id
            ORDER BY InventoryItems.name ASC
        `
        );

        res.json(inventory);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/customer/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const customer = await getAsync("SELECT * FROM Customers WHERE id = ?", [id]);
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        const jobs = await allAsync(
            `
            SELECT Jobs.*, Vehicles.make, Vehicles.model, Vehicles.license_plate
            FROM Jobs
            LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
            WHERE Jobs.customer_id = ?
            ORDER BY Jobs.created_at DESC
        `,
            [id]
        );

        const invoices = await allAsync(
            `
            SELECT Invoices.*
            FROM Invoices
            INNER JOIN Jobs ON Jobs.id = Invoices.job_id
            WHERE Jobs.customer_id = ?
            ORDER BY invoice_date DESC
        `,
            [id]
        );

        res.json({
            customer,
            jobs,
            invoices,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

