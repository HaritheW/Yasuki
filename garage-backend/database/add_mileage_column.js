const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const dbPath = path.resolve(__dirname, "workshop.db");

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Error connecting to SQLite:", err.message);
        process.exit(1);
    }
    console.log("Connected to SQLite database");
});

db.serialize(() => {
    // Check if mileage column exists
    db.get("PRAGMA table_info(Jobs)", (err, rows) => {
        if (err) {
            console.error("Error checking table info:", err.message);
            db.close();
            return;
        }
    });

    // Get all columns
    db.all("PRAGMA table_info(Jobs)", (err, columns) => {
        if (err) {
            console.error("Error getting table info:", err.message);
            db.close();
            return;
        }

        const hasMileage = columns.some(col => col.name === "mileage");
        
        if (hasMileage) {
            console.log("✓ Column 'mileage' already exists in Jobs table");
            db.close();
            return;
        }

        // Add mileage column
        db.run(`
            ALTER TABLE Jobs
            ADD COLUMN mileage REAL
        `, (err) => {
            if (err) {
                console.error("Error adding mileage column:", err.message);
            } else {
                console.log("✓ Successfully added 'mileage' column to Jobs table");
            }
            db.close();
        });
    });
});



