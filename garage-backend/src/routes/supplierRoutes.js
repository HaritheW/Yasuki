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

const allAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
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

const PURCHASE_SELECT = `
    SELECT
        sp.id,
        sp.supplier_id,
        s.name AS supplier_name,
        sp.inventory_item_id,
        sp.item_name,
        sp.quantity,
        sp.unit_cost,
        sp.payment_status,
        sp.payment_method,
        sp.purchase_date,
        sp.notes
    FROM SupplierPurchases sp
    LEFT JOIN Suppliers s ON s.id = sp.supplier_id
`;

const fetchPurchaseById = async (id) =>
    getAsync(`${PURCHASE_SELECT} WHERE sp.id = ?`, [id]);

const adjustInventoryQuantity = async ({ inventoryItemId, delta, unitCost }) => {
    await runAsync(
        `
        UPDATE InventoryItems
        SET quantity = quantity + ?, unit_cost = CASE WHEN ? IS NULL THEN unit_cost ELSE ? END, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [delta, unitCost, unitCost, inventoryItemId]
    );

    const formattedQuantity = Number.isInteger(delta) ? delta : delta.toFixed(2);

    await createNotification({
        title: delta >= 0 ? "Inventory restocked" : "Inventory adjusted",
        message:
            delta >= 0
                ? `${formattedQuantity} units adjusted for inventory item #${inventoryItemId}.`
                : `${Math.abs(formattedQuantity)} units deducted from inventory item #${inventoryItemId}.`,
        type: delta >= 0 ? "stock-add" : "stock-remove",
    });

    await notifyLowStockIfNeeded(inventoryItemId);
};

const safeNotify = async (payload) => {
    try {
        await createNotification(payload);
    } catch (error) {
        console.error("Supplier notification error:", error.message);
    }
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
        const supplier = {
            id: this.lastID,
            name,
            contact_name,
            phone,
            email,
            address,
            notes,
        };
        safeNotify({
            title: "Supplier added",
            message: `Supplier ${supplier.name} has been added.`,
            type: "supplier",
        });
        res.status(201).json(supplier);
    });
});

// List suppliers
router.get("/", (_req, res) => {
    db.all("SELECT * FROM Suppliers ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// List all purchases
router.get("/purchases", async (_req, res) => {
    try {
        const rows = await allAsync(`${PURCHASE_SELECT} ORDER BY sp.purchase_date DESC, sp.id DESC`);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List purchases for a specific supplier
router.get("/:id/purchases", async (req, res) => {
    const { id } = req.params;
    try {
        const rows = await allAsync(
            `${PURCHASE_SELECT} WHERE sp.supplier_id = ? ORDER BY sp.purchase_date DESC, sp.id DESC`,
            [id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

    db.get("SELECT * FROM Suppliers WHERE id = ?", [id], (lookupErr, existing) => {
        if (lookupErr) return res.status(500).json({ error: lookupErr.message });
        if (!existing) return res.status(404).json({ error: "Supplier not found" });

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

                    const changes = [];
                    if (row.name !== existing.name) changes.push(`name → ${row.name}`);
                    if (row.contact_name !== existing.contact_name)
                        changes.push(
                            row.contact_name
                                ? `contact person → ${row.contact_name}`
                                : "contact person cleared"
                        );
                    if (row.phone !== existing.phone)
                        changes.push(
                            row.phone ? `phone → ${row.phone}` : "phone number cleared"
                        );
                    if (row.email !== existing.email)
                        changes.push(
                            row.email ? `email → ${row.email}` : "email cleared"
                        );
                    if (row.address !== existing.address)
                        changes.push(row.address ? "address updated" : "address cleared");
                    if (row.notes !== existing.notes)
                        changes.push(row.notes ? "notes updated" : "notes cleared");

                    if (changes.length > 0) {
                        safeNotify({
                            title: "Supplier updated",
                            message: `Supplier ${row.name}: ${changes.join(", ")}.`,
                            type: "supplier",
                        });
                    }

                    res.json(row);
                });
            }
        );
    });
});

// Delete supplier
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.get("SELECT * FROM Suppliers WHERE id = ?", [id], (lookupErr, existing) => {
        if (lookupErr) return res.status(500).json({ error: lookupErr.message });
        if (!existing) return res.status(404).json({ error: "Supplier not found" });

        db.run("DELETE FROM Suppliers WHERE id = ?", [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: "Supplier not found" });
            }

            safeNotify({
                title: "Supplier removed",
                message: `Supplier ${existing.name} has been removed.`,
                type: "supplier",
            });

            res.json({ message: "Supplier deleted" });
        });
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
        update_inventory_price,
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

    const shouldUpdateInventoryPrice =
        update_inventory_price === undefined || update_inventory_price === null
            ? true
            : typeof update_inventory_price === "string"
            ? update_inventory_price.toLowerCase() === "true"
            : Boolean(update_inventory_price);

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
                SELECT id, name
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

            await adjustInventoryQuantity({
                inventoryItemId: inventory_item_id,
                delta: quantityValue,
                unitCost: shouldUpdateInventoryPrice ? unitCostValue : null,
            });
        }

        await runAsync("COMMIT");

        const purchase = await fetchPurchaseById(insertResult.lastID);
        await safeNotify({
            title: "Purchase recorded",
            message: `${purchase.item_name} (${purchase.quantity}) logged for ${purchase.supplier_name ?? "supplier #" + purchase.supplier_id}.`,
            type: "supplier-purchase",
        });
        res.status(201).json(purchase);
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

// Update purchase
router.put("/purchases/:purchaseId", async (req, res) => {
    const { purchaseId } = req.params;
    const { item_name, quantity, unit_cost, payment_status, payment_method, purchase_date, notes } = req.body;

    try {
        const existing = await getAsync("SELECT * FROM SupplierPurchases WHERE id = ?", [purchaseId]);
        if (!existing) {
            return res.status(404).json({ error: "Purchase not found" });
        }

        if (payment_status !== undefined && !["paid", "unpaid"].includes(payment_status)) {
            return res.status(400).json({ error: "Invalid payment status" });
        }

        let parsedQuantity = null;
        let parsedUnitCost = null;

        if (quantity !== undefined) {
            parsedQuantity = parseNumber(quantity, "quantity");
        }

        if (unit_cost !== undefined) {
            parsedUnitCost = parseNullableNumber(unit_cost, "unit_cost");
        }

        await runAsync(
            `
            UPDATE SupplierPurchases
            SET item_name = COALESCE(?, item_name),
                quantity = COALESCE(?, quantity),
                unit_cost = COALESCE(?, unit_cost),
                payment_status = COALESCE(?, payment_status),
                payment_method = COALESCE(?, payment_method),
                purchase_date = COALESCE(?, purchase_date),
                notes = COALESCE(?, notes)
            WHERE id = ?
        `,
            [
                item_name,
                quantity !== undefined ? parsedQuantity : null,
                unit_cost !== undefined ? parsedUnitCost : null,
                payment_status,
                payment_method,
                purchase_date,
                notes,
                purchaseId,
            ]
        );

        const updated = await fetchPurchaseById(purchaseId);
        await safeNotify({
            title: "Purchase updated",
            message: `Purchase #${purchaseId} for ${updated.supplier_name ?? "supplier #" + updated.supplier_id} has been updated.`,
            type: "supplier-purchase",
        });
        res.json(updated);
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: error.message });
    }
});

// Delete purchase
router.delete("/purchases/:purchaseId", async (req, res) => {
    const { purchaseId } = req.params;
    const { adjustInventory } = req.body ?? {};

    try {
        const existing = await getAsync("SELECT * FROM SupplierPurchases WHERE id = ?", [purchaseId]);
        if (!existing) {
            return res.status(404).json({ error: "Purchase not found" });
        }

        if (adjustInventory && existing.inventory_item_id && existing.quantity > 0) {
            await adjustInventoryQuantity({
                inventoryItemId: existing.inventory_item_id,
                delta: -Math.abs(existing.quantity),
                unitCost: null,
            });
        }

        await runAsync("DELETE FROM SupplierPurchases WHERE id = ?", [purchaseId]);
        await safeNotify({
            title: "Purchase deleted",
            message: `Purchase #${purchaseId} (${existing.item_name}) removed.`,
            type: "supplier-purchase",
        });
        res.status(204).send();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

