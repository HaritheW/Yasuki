const express = require("express");
const router = express.Router();
const db = require("../../database/db");

const VALID_TECHNICIAN_STATUSES = ["Active", "On Leave", "Inactive"];

const isValidStatus = (value) =>
    typeof value === "string" && VALID_TECHNICIAN_STATUSES.includes(value);

// Create technician
router.post("/", (req, res) => {
    const { name, phone, status = "Active" } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Technician name is required" });
    }

    if (!isValidStatus(status)) {
        return res.status(400).json({ error: "Invalid technician status" });
    }

    const query = `
        INSERT INTO Technicians (name, phone, status)
        VALUES (?, ?, ?)
    `;
    db.run(query, [name, phone, status], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, phone, status });
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
    const { name, phone, status } = req.body;

    if (status !== undefined && !isValidStatus(status)) {
        return res.status(400).json({ error: "Invalid technician status" });
    }

    db.run(
        `
        UPDATE Technicians
        SET name = COALESCE(?, name),
            phone = COALESCE(?, phone),
            status = COALESCE(?, status)
        WHERE id = ?
    `,
        [name, phone, status, id],
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
    const { include_completed } = req.query;

    const includeAllStatuses =
        include_completed === "1" ||
        include_completed === "true" ||
        include_completed === "yes";

    const statusFilterClause = includeAllStatuses
        ? ""
        : "AND Jobs.job_status NOT IN ('Completed', 'Cancelled')";

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
        ${statusFilterClause}
        ORDER BY Jobs.created_at DESC
    `;

    db.all(query, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

module.exports = router;

