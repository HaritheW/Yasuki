const express = require("express");
const router = express.Router();
const db = require("../../database/db");

// Create vehicle
router.post("/", (req, res) => {
    const { customer_id, make, model, year, license_plate } = req.body;

    if (!customer_id || !make || !model) {
        return res.status(400).json({ error: "customer_id, make and model are required" });
    }

    const query = `
        INSERT INTO Vehicles (customer_id, make, model, year, license_plate)
        VALUES (?, ?, ?, ?, ?)
    `;
    db.run(query, [customer_id, make, model, year, license_plate], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
            id: this.lastID,
            customer_id,
            make,
            model,
            year,
            license_plate,
        });
    });
});

// Get all vehicles (optional filter by customer_id)
router.get("/", (req, res) => {
    const { customer_id, include_archived } = req.query;

    const baseQuery = "SELECT * FROM Vehicles";
    const filters = [];
    const params = [];

    if (customer_id) {
        filters.push("customer_id = ?");
        params.push(customer_id);
    }

    if (!include_archived || include_archived === "0" || include_archived === "false") {
        filters.push("archived = 0");
    }

    const whereClause = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";

    db.all(`${baseQuery}${whereClause} ORDER BY id DESC`, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get vehicle by ID
router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM Vehicles WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Vehicle not found" });
        res.json(row);
    });
});

// Update vehicle
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { make, model, year, license_plate } = req.body;

    db.run(
        `
        UPDATE Vehicles
        SET make = COALESCE(?, make),
            model = COALESCE(?, model),
            year = COALESCE(?, year),
            license_plate = COALESCE(?, license_plate)
        WHERE id = ?
    `,
        [make, model, year, license_plate, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Vehicle not found" });
            }
            db.get("SELECT * FROM Vehicles WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
});

// Soft delete / unassign vehicle from customer
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.get(
        `
        SELECT id, job_status
        FROM Jobs
        WHERE vehicle_id = ?
          AND job_status NOT IN ('Completed', 'Cancelled')
        LIMIT 1
    `,
        [id],
        (jobErr, activeJob) => {
            if (jobErr) {
                return res.status(500).json({ error: jobErr.message });
            }

            if (activeJob) {
                return res.status(409).json({
                    error: `Vehicle cannot be unassigned while job #${activeJob.id} is ${activeJob.job_status.toLowerCase()}. Complete or cancel the job first.`,
                });
            }

            db.run(
                `
                UPDATE Vehicles
                SET archived = 1
                WHERE id = ?
            `,
                [id],
                function (err) {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    if (this.changes === 0) {
                        return res.status(404).json({ error: "Vehicle not found" });
                    }
                    res.json({ message: "Vehicle unassigned" });
                }
            );
        }
    );
});

module.exports = router;

