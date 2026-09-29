/**
 * One-time migration: create QuickServiceCustomServices table.
 * Run with: node database/migrations/add_quick_service_custom_services.js
 *
 * Stores user-added Quick Service dropdown names only (not built-in defaults).
 */
const db = require("../db");

db.run(
    `
    CREATE TABLE IF NOT EXISTS QuickServiceCustomServices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`,
    (err) => {
        if (err) {
            console.error("Migration failed:", err.message);
            process.exit(1);
        } else {
            console.log("Ensured table QuickServiceCustomServices exists.");
        }
        db.close();
    }
);
