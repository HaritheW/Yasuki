const express = require("express");
const router = express.Router();
const db = require("../../database/db");

// Create technician
router.post("/", (req, res) => {
    const { name, phone } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Technician name is required" });
    }

    const query = `
        INSERT INTO Technicians (name, phone)
        VALUES (?, ?)
    `;
    db.run(query, [name, phone], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, phone });
    });
});

// Get all technicians
router.get("/", (_req, res) => {
    db.all("SELECT * FROM Technicians ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get technician by ID
router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM Technicians WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Technician not found" });
        res.json(row);
    });
});

// Update technician
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { name, phone } = req.body;

    db.run(
        `
        UPDATE Technicians
        SET name = COALESCE(?, name),
            phone = COALESCE(?, phone)
        WHERE id = ?
    `,
        [name, phone, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Technician not found" });
            }
            db.get("SELECT * FROM Technicians WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
});

// Delete technician
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM Technicians WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Technician not found" });
        }
        res.json({ message: "Technician deleted" });
    });
});

// Jobs assigned to a technician
router.get("/:id/jobs", (req, res) => {
    const { id } = req.params;

    const query = `
        SELECT
            Jobs.*,
            Customers.name AS customer_name,
            Vehicles.make || ' ' || Vehicles.model AS vehicle_name
        FROM JobTechnicians
        INNER JOIN Jobs ON Jobs.id = JobTechnicians.job_id
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
        WHERE JobTechnicians.technician_id = ?
        ORDER BY Jobs.created_at DESC
    `;

    db.all(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

module.exports = router;

