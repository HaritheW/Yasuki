/**
 * One-time migration: add selling_price column to InventoryItems.
 * Run with: node database/migrations/add_selling_price.js
 *
 * unit_cost = garage purchase cost
 * selling_price = customer default selling price (nullable; not copied from unit_cost)
 */
const db = require("../db");

db.run(`ALTER TABLE InventoryItems ADD COLUMN selling_price REAL`, (err) => {
    if (err) {
        if (err.message.includes("duplicate column name")) {
            console.log("Column selling_price already exists, skipping.");
        } else {
            console.error("Migration failed:", err.message);
            process.exit(1);
        }
    } else {
        console.log("Added column selling_price to InventoryItems.");
    }
    db.close();
});
