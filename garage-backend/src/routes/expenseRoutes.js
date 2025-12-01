const express = require("express");
const router = express.Router();
const db = require("../../database/db");

const VALID_PAYMENT_STATUSES = ["pending", "paid", "unpaid"];

const parseAmount = (value, fieldName) => {
    if (value === undefined || value === null || value === "") {
        const error = new Error(`${fieldName} is required`);
        error.status = 400;
        throw error;
    }
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        const error = new Error(`${fieldName} must be a valid number`);
        error.status = 400;
        throw error;
    }
    return numericValue;
};

const normalizeStatus = (status) => {
    if (status === undefined || status === null || status === "") return "pending";
    const normalized = String(status).toLowerCase();
    if (!VALID_PAYMENT_STATUSES.includes(normalized)) {
        const error = new Error("payment_status must be one of pending, paid, or unpaid");
        error.status = 400;
        throw error;
    }
    return normalized;
};

// Create expense
router.post("/", (req, res) => {
    const { description, category, amount, expense_date, payment_status, payment_method, remarks } =
        req.body;

    if (!description) {
        return res.status(400).json({ error: "description and amount are required" });
    }

    let amountValue;
    let statusValue;
    try {
        amountValue = parseAmount(amount, "amount");
        statusValue = normalizeStatus(payment_status);
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    if (statusValue === "paid" && !payment_method) {
        return res.status(400).json({ error: "payment_method is required when payment_status is paid" });
    }

    const query = `
        INSERT INTO Expenses (description, category, amount, expense_date, payment_status, payment_method, remarks)
        VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)
    `;
    db.run(
        query,
        [
            description,
            category,
            amountValue,
            expense_date,
            statusValue,
            payment_method || null,
            remarks || null,
        ],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({
                id: this.lastID,
                description,
                category,
                amount: amountValue,
                expense_date: expense_date || new Date().toISOString(),
                payment_status: statusValue,
                payment_method: payment_method || null,
                remarks: remarks || null,
            });
        }
    );
});

// List expenses with optional date range
router.get("/", (req, res) => {
    const { startDate, endDate } = req.query;
    const clauses = [];
    const params = [];

    if (startDate) {
        clauses.push("DATE(expense_date) >= DATE(?)");
        params.push(startDate);
    }

    if (endDate) {
        clauses.push("DATE(expense_date) <= DATE(?)");
        params.push(endDate);
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    db.all(
        `
        SELECT *
        FROM Expenses
        ${whereClause}
        ORDER BY expense_date DESC
    `,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Update expense
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { description, category, amount, expense_date, payment_status, payment_method, remarks } =
        req.body;

    db.get("SELECT * FROM Expenses WHERE id = ?", [id], (lookupErr, existing) => {
        if (lookupErr) return res.status(500).json({ error: lookupErr.message });
        if (!existing) return res.status(404).json({ error: "Expense not found" });

        let amountValue = existing.amount;
        if (amount !== undefined) {
            try {
                amountValue = parseAmount(amount, "amount");
            } catch (error) {
                const status = Number.isInteger(error.status) ? error.status : 500;
                return res.status(status).json({ error: error.message });
            }
        }

        let statusValue = existing.payment_status || "pending";
        if (payment_status !== undefined) {
            try {
                statusValue = normalizeStatus(payment_status);
            } catch (error) {
                const status = Number.isInteger(error.status) ? error.status : 500;
                return res.status(status).json({ error: error.message });
            }
        }

        const nextDescription = description !== undefined ? description : existing.description;
        const nextCategory = category !== undefined ? category : existing.category;
        const nextExpenseDate =
            expense_date !== undefined ? expense_date : existing.expense_date;
        const nextRemarks = remarks !== undefined ? remarks : existing.remarks;
        const nextPaymentMethod =
            payment_method !== undefined ? payment_method || null : existing.payment_method;

        if (statusValue === "paid" && !nextPaymentMethod) {
            return res
                .status(400)
                .json({ error: "payment_method is required when payment_status is paid" });
        }

        db.run(
            `
            UPDATE Expenses
            SET description = ?,
                category = ?,
                amount = ?,
                expense_date = ?,
                payment_status = ?,
                payment_method = ?,
                remarks = ?
            WHERE id = ?
        `,
            [
                nextDescription,
                nextCategory,
                amountValue,
                nextExpenseDate,
                statusValue,
                nextPaymentMethod,
                nextRemarks,
                id,
            ],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                db.get("SELECT * FROM Expenses WHERE id = ?", [id], (selectErr, row) => {
                    if (selectErr) return res.status(500).json({ error: selectErr.message });
                    res.json(row);
                });
            }
        );
    });
});

// Delete expense
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM Expenses WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Expense not found" });
        }
        res.json({ message: "Expense deleted" });
    });
});

module.exports = router;

