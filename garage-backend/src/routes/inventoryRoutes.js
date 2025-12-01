const express = require("express");
const router = express.Router();
const db = require("../../database/db");

const VALID_TYPES = ["consumable", "non-consumable", "bulk"];

const toNumber = (value, fieldName) => {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        const error = new Error(`${fieldName} must be a valid number`);
        error.status = 400;
        throw error;
    }
    return numericValue;
};

const parseNumber = (value, fieldName) => {
    if (value === undefined || value === null || value === "") return 0;
    return toNumber(value, fieldName);
};

const parseNullableNumber = (value, fieldName) => {
    if (value === undefined || value === null || value === "") return null;
    return toNumber(value, fieldName);
};

// Create inventory item
router.post("/", (req, res) => {
    const { name, description, type, unit, quantity = 0, unit_cost, reorder_level = 0 } = req.body;

    if (!name || !type || !VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: "name and valid type are required" });
    }

    let quantityValue;
    let unitCostValue;
    let reorderLevelValue;
    try {
        quantityValue = parseNumber(quantity, "quantity");
        unitCostValue = parseNullableNumber(unit_cost, "unit_cost");
        reorderLevelValue = parseNumber(reorder_level, "reorder_level");
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    const query = `
        INSERT INTO InventoryItems (name, description, type, unit, quantity, unit_cost, reorder_level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(
        query,
        [name, description, type, unit, quantityValue, unitCostValue, reorderLevelValue],
        function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
            id: this.lastID,
            name,
            description,
            type,
                unit,
            quantity: quantityValue,
                unit_cost: unitCostValue,
            reorder_level: reorderLevelValue,
        });
        }
    );
});

// Get all inventory items
router.get("/", (req, res) => {
    const { type, lowStock } = req.query;
    const clauses = [];
    const params = [];

    if (type && VALID_TYPES.includes(type)) {
        clauses.push("type = ?");
        params.push(type);
    }

    if (lowStock === "true") {
        clauses.push("quantity <= reorder_level");
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    db.all(
        `SELECT * FROM InventoryItems${whereClause} ORDER BY name ASC`,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Get inventory item by ID
router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM InventoryItems WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Inventory item not found" });
        res.json(row);
    });
});

// Update inventory item
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { name, description, type, unit, quantity, unit_cost, reorder_level } = req.body;

    if (type && !VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: "Invalid inventory type" });
    }

    let quantityValue = null;
    let unitCostValue = null;
    let unitCostProvided = false;
    let reorderLevelValue = null;

    try {
        if (quantity !== undefined) quantityValue = parseNumber(quantity, "quantity");
        if (unit_cost !== undefined) {
            unitCostProvided = true;
            unitCostValue = parseNullableNumber(unit_cost, "unit_cost");
        }
        if (reorder_level !== undefined) reorderLevelValue = parseNumber(reorder_level, "reorder_level");
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    db.run(
        `
        UPDATE InventoryItems
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            type = COALESCE(?, type),
            unit = COALESCE(?, unit),
            quantity = COALESCE(?, quantity),
            reorder_level = COALESCE(?, reorder_level),
            unit_cost = CASE WHEN ? = 1 THEN ? ELSE unit_cost END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [
            name,
            description,
            type,
            unit,
            quantityValue,
            reorderLevelValue,
            unitCostProvided ? 1 : 0,
            unitCostValue,
            id,
        ],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Inventory item not found" });
            }
            db.get("SELECT * FROM InventoryItems WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
});

// Delete inventory item
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM InventoryItems WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Inventory item not found" });
        }
        res.json({ message: "Inventory item deleted" });
    });
});

// Deduct consumable quantity
router.post("/:id/deduct", (req, res) => {
    const { id } = req.params;
    const { quantity = 0 } = req.body;

    let quantityValue;
    try {
        quantityValue = parseNumber(quantity, "quantity");
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    if (quantityValue <= 0) {
        return res.status(400).json({ error: "Deduction quantity must be greater than zero" });
    }

    db.get("SELECT * FROM InventoryItems WHERE id = ?", [id], (err, item) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!item) return res.status(404).json({ error: "Inventory item not found" });
        if (item.type !== "consumable") {
            return res.status(400).json({ error: "Only consumable items can be auto deducted" });
        }
        if (item.quantity < quantityValue) {
            return res.status(400).json({ error: "Insufficient inventory quantity" });
        }

        const updateQuery = `
            UPDATE InventoryItems
            SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        db.run(updateQuery, [quantityValue, id], function (updateErr) {
            if (updateErr) return res.status(500).json({ error: updateErr.message });

            db.get("SELECT * FROM InventoryItems WHERE id = ?", [id], (selectErr, updatedItem) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(updatedItem);
            });
        });
    });
});

module.exports = router;

