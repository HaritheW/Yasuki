/**
 * Inventory stock helpers.
 * Stock deduction is driven by item TYPE only — never by unit label.
 * Units are for display in messages.
 *
 * Stock-managed / invoice-selectable types:
 *   - consumable
 *   - bulk
 * Non-consumable: inventory-only (not on customer invoices; no stock deduction).
 */

const STOCK_MANAGED_TYPES = new Set(["consumable", "bulk"]);

/** Same set: only these may appear on Quick Service / invoice inventory lines. */
const INVOICE_SELECTABLE_INVENTORY_TYPES = STOCK_MANAGED_TYPES;

/** @deprecated Prefer isStockManagedType — kept as alias for existing imports. */
const STOCK_DEDUCTED_TYPES = STOCK_MANAGED_TYPES;

const isStockManagedType = (type) => STOCK_MANAGED_TYPES.has(String(type || "").toLowerCase());

const isStockDeductedType = isStockManagedType;

const isInvoiceSelectableInventoryType = (type) =>
    INVOICE_SELECTABLE_INVENTORY_TYPES.has(String(type || "").toLowerCase());

const assertInvoiceSelectableInventoryItem = (inventoryItem) => {
    if (!inventoryItem) return;
    if (isInvoiceSelectableInventoryType(inventoryItem.type)) return;
    const err = new Error("Non-Consumable inventory items cannot be added to customer invoices.");
    err.status = 400;
    throw err;
};

const formatStockAmount = (quantity) => {
    const amount = Number(quantity);
    if (!Number.isFinite(amount)) return "0";
    if (Number.isInteger(amount)) return String(amount);
    return String(Number(amount.toFixed(3)));
};

const formatStockWithUnit = (quantity, unit) => {
    const amount = formatStockAmount(quantity);
    const unitLabel = typeof unit === "string" ? unit.trim() : "";
    return unitLabel ? `${amount} ${unitLabel}` : amount;
};

/**
 * Compare requested quantity against InventoryItems.quantity.
 * Unit is ignored for the comparison and used only in the error text.
 * Uses Number() — not parseInt — so decimal bulk quantities work.
 */
const assertSufficientStock = (item, requestedQty) => {
    const available = Number(item?.quantity ?? 0);
    const requested = Number(requestedQty ?? 0);
    const availableSafe = Number.isFinite(available) ? available : 0;
    const requestedSafe = Number.isFinite(requested) ? requested : 0;

    if (requestedSafe > availableSafe) {
        const name = item?.name || (item?.id != null ? `item #${item.id}` : "inventory item");
        const err = new Error(
            `Insufficient stock for ${name}. Available: ${formatStockWithUnit(
                availableSafe,
                item?.unit
            )}, requested: ${formatStockAmount(requestedSafe)}.`
        );
        err.status = 400;
        throw err;
    }
};

module.exports = {
    STOCK_MANAGED_TYPES,
    INVOICE_SELECTABLE_INVENTORY_TYPES,
    STOCK_DEDUCTED_TYPES,
    isStockManagedType,
    isStockDeductedType,
    isInvoiceSelectableInventoryType,
    assertInvoiceSelectableInventoryItem,
    formatStockAmount,
    formatStockWithUnit,
    assertSufficientStock,
};
