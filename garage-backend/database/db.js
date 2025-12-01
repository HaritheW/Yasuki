const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.resolve(__dirname, "workshop.db");

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Error connecting to SQLite:", err.message);
    else console.log("Connected to SQLite database");
});

module.exports = db;
