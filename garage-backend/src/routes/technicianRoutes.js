const express = require("express");
const router = express.Router();
const db = require("../../database/db");
const { createNotification } = require("../utils/notifications");

const VALID_TECHNICIAN_STATUSES = ["Active", "On Leave", "Inactive"];

const runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

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

const isValidStatus = (value) =>
    typeof value === "string" && VALID_TECHNICIAN_STATUSES.includes(value);

const safeNotify = async (payload) => {
    try {
        await createNotification(payload);
    } catch (error) {
        console.error("Technician notification error:", error.message);
    }
};

// Create technician
router.post("/", async (req, res) => {
    const { name, phone, status = "Active" } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Technician name is required" });
    }

    if (!isValidStatus(status)) {
        return res.status(400).json({ error: "Invalid technician status" });
    }

    try {
        const result = await runAsync(
            `
            INSERT INTO Technicians (name, phone, status)
            VALUES (?, ?, ?)
        `,
            [name.trim(), phone ?? null, status]
        );

        const technician = await getAsync("SELECT * FROM Technicians WHERE id = ?", [result.lastID]);

        await safeNotify({
            title: "Technician added",
            message: `Technician ${technician.name} added (status: ${technician.status}).`,
            type: "technician",
        });

        res.status(201).json(technician);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all technicians
router.get("/", async (_req, res) => {
    try {
        const rows = await allAsync("SELECT * FROM Technicians ORDER BY name ASC");
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get technician by ID
router.get("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const row = await getAsync("SELECT * FROM Technicians WHERE id = ?", [id]);
        if (!row) return res.status(404).json({ error: "Technician not found" });
        res.json(row);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update technician
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { name, phone, status } = req.body;

    if (status !== undefined && !isValidStatus(status)) {
        return res.status(400).json({ error: "Invalid technician status" });
    }

    try {
        const existing = await getAsync("SELECT * FROM Technicians WHERE id = ?", [id]);
        if (!existing) {
            return res.status(404).json({ error: "Technician not found" });
        }

        await runAsync(
            `
            UPDATE Technicians
            SET name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                status = COALESCE(?, status)
            WHERE id = ?
        `,
            [name ?? null, phone ?? null, status ?? null, id]
        );

        const updated = await getAsync("SELECT * FROM Technicians WHERE id = ?", [id]);

        const changes = [];
        if (name !== undefined && updated.name !== existing.name) {
            changes.push(`name updated to ${updated.name}`);
        }
        if (phone !== undefined && updated.phone !== existing.phone) {
            changes.push(
                updated.phone
                    ? `contact set to ${updated.phone}`
                    : "contact number cleared"
            );
        }
        if (status !== undefined && updated.status !== existing.status) {
            changes.push(`status changed from ${existing.status} to ${updated.status}`);
        }

        if (changes.length > 0) {
            await safeNotify({
                title: "Technician updated",
                message: `Technician ${updated.name}: ${changes.join(", ")}.`,
                type: "technician",
            });
        }

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete technician
router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const existing = await getAsync("SELECT * FROM Technicians WHERE id = ?", [id]);
        if (!existing) {
            return res.status(404).json({ error: "Technician not found" });
        }

        const result = await runAsync("DELETE FROM Technicians WHERE id = ?", [id]);
        if (!result.changes) {
            return res.status(404).json({ error: "Technician not found" });
        }

        await safeNotify({
            title: "Technician removed",
            message: `Technician ${existing.name} has been removed from the roster.`,
            type: "technician",
        });

        res.json({ message: "Technician deleted" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Jobs assigned to a technician
router.get("/:id/jobs", async (req, res) => {
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

    try {
        const rows = await allAsync(query, [id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

