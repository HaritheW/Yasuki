const express = require("express");
const router = express.Router();
const db = require("../../database/db");

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

// Create expense
router.post("/", (req, res) => {
    const { description, category, amount, expense_date } = req.body;

    if (!description) {
        return res.status(400).json({ error: "description and amount are required" });
    }

    let amountValue;
    try {
        amountValue = parseAmount(amount, "amount");
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    const query = `
        INSERT INTO Expenses (description, category, amount, expense_date)
        VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `;
    db.run(query, [description, category, amountValue, expense_date], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
            id: this.lastID,
            description,
            category,
            amount: amountValue,
            expense_date: expense_date || new Date().toISOString(),
        });
    });
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
    const { description, category, amount, expense_date } = req.body;

    let amountValue = null;
    try {
        if (amount !== undefined) {
            amountValue = parseAmount(amount, "amount");
        }
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    db.run(
        `
        UPDATE Expenses
        SET description = COALESCE(?, description),
            category = COALESCE(?, category),
            amount = COALESCE(?, amount),
            expense_date = COALESCE(?, expense_date)
        WHERE id = ?
    `,
        [description, category, amountValue, expense_date, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Expense not found" });
            }
            db.get("SELECT * FROM Expenses WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
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

