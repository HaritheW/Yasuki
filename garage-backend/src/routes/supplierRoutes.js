const express = require("express");
const router = express.Router();
const db = require("../../database/db");
const { createNotification, notifyLowStockIfNeeded } = require("../utils/notifications");

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

const toNumber = (value, field) => {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        const error = new Error(`${field} must be a valid number`);
        error.status = 400;
        throw error;
    }
    return numericValue;
};

const parseNumber = (value, field) => {
    if (value === undefined || value === null || value === "") return 0;
    return toNumber(value, field);
};

const parseNullableNumber = (value, field) => {
    if (value === undefined || value === null || value === "") return null;
    return toNumber(value, field);
};

// Create supplier
router.post("/", (req, res) => {
    const { name, contact_name, phone, email, address, notes } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Supplier name is required" });
    }

    const query = `
        INSERT INTO Suppliers (name, contact_name, phone, email, address, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(query, [name, contact_name, phone, email, address, notes], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
            id: this.lastID,
            name,
            contact_name,
            phone,
            email,
            address,
            notes,
        });
    });
});

// List suppliers
router.get("/", (_req, res) => {
    db.all("SELECT * FROM Suppliers ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get supplier by ID
router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM Suppliers WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Supplier not found" });
        res.json(row);
    });
});

// Update supplier
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { name, contact_name, phone, email, address, notes } = req.body;

    db.run(
        `
        UPDATE Suppliers
        SET name = COALESCE(?, name),
            contact_name = COALESCE(?, contact_name),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            address = COALESCE(?, address),
            notes = COALESCE(?, notes)
        WHERE id = ?
    `,
        [name, contact_name, phone, email, address, notes, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Supplier not found" });
            }
            db.get("SELECT * FROM Suppliers WHERE id = ?", [id], (selectErr, row) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });
                res.json(row);
            });
        }
    );
});

// Delete supplier
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.run("DELETE FROM Suppliers WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: "Supplier not found" });
        }
        res.json({ message: "Supplier deleted" });
    });
});

// Add purchase record for supplier
router.post("/:id/purchase", async (req, res) => {
    const { id } = req.params;
    const {
        inventory_item_id,
        item_name,
        quantity = 0,
        unit_cost = 0,
        payment_status = "unpaid",
        payment_method,
        purchase_date,
        notes,
    } = req.body;

    if (!item_name) {
        return res.status(400).json({ error: "item_name is required" });
    }

    if (!["paid", "unpaid"].includes(payment_status)) {
        return res.status(400).json({ error: "payment_status must be 'paid' or 'unpaid'" });
    }

    let quantityValue;
    let unitCostValue;

    try {
        quantityValue = parseNumber(quantity, "quantity");
        unitCostValue = parseNullableNumber(unit_cost, "unit_cost");
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: error.message });
    }

    try {
        await runAsync("BEGIN TRANSACTION");

        const insertResult = await runAsync(
            `
            INSERT INTO SupplierPurchases (
                supplier_id,
                inventory_item_id,
                item_name,
                quantity,
                unit_cost,
                payment_status,
                payment_method,
                purchase_date,
                notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
        `,
            [
                id,
                inventory_item_id,
                item_name,
                quantityValue,
                unitCostValue,
                payment_status,
                payment_method,
                purchase_date,
                notes,
            ]
        );

        if (inventory_item_id && quantityValue > 0) {
            const inventoryItem = await getAsync(
                `
                SELECT id, name, type
                FROM InventoryItems
                WHERE id = ?
            `,
                [inventory_item_id]
            );

            if (!inventoryItem) {
                const lookupError = new Error("Linked inventory item not found");
                lookupError.status = 404;
                throw lookupError;
            }

            if (inventoryItem.type === "consumable") {
                await runAsync(
                    `
                    UPDATE InventoryItems
                    SET quantity = quantity + ?, unit_cost = CASE WHEN ? IS NULL THEN unit_cost ELSE ? END, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                    [quantityValue, unitCostValue, unitCostValue, inventory_item_id]
                );

                const formattedQuantity =
                    Number.isInteger(quantityValue) ? quantityValue : quantityValue.toFixed(2);

                await createNotification({
                    title: "Inventory restocked",
                    message: `${formattedQuantity} x ${inventoryItem.name} added via supplier purchase.`,
                    type: "stock-add",
                });

                await notifyLowStockIfNeeded(inventory_item_id);
            }
        }

        await runAsync("COMMIT");

        res.status(201).json({ id: insertResult.lastID });
    } catch (error) {
        try {
            await runAsync("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError.message);
        }
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: error.message });
    }
});

module.exports = router;

