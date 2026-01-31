/**
 * One-time migration: add genuine_or_non_genuine column to InventoryItems.
 * Run with: node database/migrations/add_genuine_or_non_genuine.js
 */
const db = require("../db");

db.run(
    `ALTER TABLE InventoryItems ADD COLUMN genuine_or_non_genuine TEXT CHECK(genuine_or_non_genuine IN ('genuine', 'non-genuine'))`,
    (err) => {
        if (err) {
            if (err.message.includes("duplicate column name")) {
                console.log("Column genuine_or_non_genuine already exists, skipping.");
            } else {
                console.error("Migration failed:", err.message);
                process.exit(1);
            }
        } else {
            console.log("Added column genuine_or_non_genuine to InventoryItems.");
        }
        db.close();
    }
);
