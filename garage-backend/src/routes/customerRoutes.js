const express = require("express");
const router = express.Router();
const db = require("../../database/db");

// Add new customer
router.post("/", (req, res) => {
    const { name, phone, email, address } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Customer name is required" });
    }

    const query = `
        INSERT INTO Customers (name, phone, email, address)
        VALUES (?, ?, ?, ?)
    `;
    db.run(query, [name, phone, email, address], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, phone, email, address });
    });
});

// Get all customers
router.get("/", (req, res) => {
    db.all("SELECT * FROM Customers ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get customer by ID
router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM Customers WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Customer not found" });
        res.json(row);
    });
});

// Update customer
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;

    db.run(
        `
        UPDATE Customers
        SET name = COALESCE(?, name),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            address = COALESCE(?, address)
        WHERE id = ?
    `,
        [name, phone, email, address, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Customer not found" });
            }
            db.get("SELECT * FROM Customers WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
});

// Delete customer
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM Customers WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Customer not found" });
        }
        res.json({ message: "Customer deleted" });
    });
});

module.exports = router;
