const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./workshop.db");

const logTableResult = (tableName) => (err) => {
    if (err) {
        console.error(`${tableName} table error:`, err.message);
    } else {
        console.log(`${tableName} table ready`);
    }
};

db.serialize(() => {
    // ----------------------------------
    // Customers
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("Customers")
    );

    // ----------------------------------
    // Vehicles (one per job selection)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            make TEXT,
            model TEXT,
            year TEXT,
            license_plate TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(customer_id) REFERENCES Customers(id)
        );
    `,
        logTableResult("Vehicles")
    );

    // ----------------------------------
    // Technicians
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Technicians (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            status TEXT CHECK(status IN ('Active', 'On Leave', 'Inactive')) DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("Technicians")
    );

    db.run(
        `
        ALTER TABLE Technicians
        ADD COLUMN status TEXT CHECK(status IN ('Active', 'On Leave', 'Inactive')) DEFAULT 'Active';
    `,
        (err) => {
            if (err && !/duplicate column name/i.test(err.message)) {
                console.error("Technicians add status column error:", err.message);
            }
        }
    );

    db.run(
        `
        UPDATE Technicians
        SET status = 'Active'
        WHERE status IS NULL;
    `,
        (err) => {
            if (err) {
                console.error("Technicians status backfill error:", err.message);
            }
        }
    );

    // ----------------------------------
    // Jobs (core work orders)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            vehicle_id INTEGER NOT NULL,
            description TEXT,
            notes TEXT,
            initial_amount REAL,
            advance_amount REAL,
            job_status TEXT CHECK(job_status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
            status_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(customer_id) REFERENCES Customers(id),
            FOREIGN KEY(vehicle_id) REFERENCES Vehicles(id)
        );
    `,
        logTableResult("Jobs")
    );

    // ----------------------------------
    // JobTechnicians (jobs ↔ technicians m2m)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS JobTechnicians (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            technician_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(job_id) REFERENCES Jobs(id),
            FOREIGN KEY(technician_id) REFERENCES Technicians(id)
        );
    `,
        logTableResult("JobTechnicians")
    );

    // ----------------------------------
    // InventoryItems (consumable / non-consumable / bulk)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS InventoryItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            type TEXT CHECK(type IN ('consumable', 'non-consumable', 'bulk')) NOT NULL,
            unit TEXT,
            quantity REAL DEFAULT 0,
            unit_cost REAL,
            reorder_level REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("InventoryItems")
    );

    // ----------------------------------
    // Suppliers
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("Suppliers")
    );

    // ----------------------------------
    // SupplierPurchases (stock intake for consumables)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS SupplierPurchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL,
            inventory_item_id INTEGER,
            item_name TEXT NOT NULL,
            quantity REAL DEFAULT 0,
            unit_cost REAL DEFAULT 0,
            payment_status TEXT CHECK(payment_status IN ('paid', 'unpaid')) DEFAULT 'unpaid',
            payment_method TEXT,
            purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(supplier_id) REFERENCES Suppliers(id),
            FOREIGN KEY(inventory_item_id) REFERENCES InventoryItems(id)
        );
    `,
        logTableResult("SupplierPurchases")
    );

    // ----------------------------------
    // JobItems (estimation/service breakdown)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS JobItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            inventory_item_id INTEGER,
            item_name TEXT NOT NULL,
            item_type TEXT CHECK(item_type IN ('consumable', 'non-consumable', 'bulk')) DEFAULT 'consumable',
            quantity REAL DEFAULT 1,
            unit_price REAL DEFAULT 0,
            line_total REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(job_id) REFERENCES Jobs(id),
            FOREIGN KEY(inventory_item_id) REFERENCES InventoryItems(id)
        );
    `,
        logTableResult("JobItems")
    );

    // ----------------------------------
    // Invoices (one per completed job)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL UNIQUE,
            invoice_no TEXT UNIQUE,
            invoice_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            items_total REAL DEFAULT 0,
            total_charges REAL DEFAULT 0,
            total_deductions REAL DEFAULT 0,
            final_total REAL DEFAULT 0,
            payment_method TEXT,
            payment_status TEXT CHECK(payment_status IN ('unpaid', 'partial', 'paid')) DEFAULT 'unpaid',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(job_id) REFERENCES Jobs(id)
        );
    `,
        logTableResult("Invoices")
    );

    // ----------------------------------
    // InvoiceItems (line items attached to invoice)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS InvoiceItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            inventory_item_id INTEGER,
            item_name TEXT NOT NULL,
            quantity REAL DEFAULT 1,
            unit_price REAL DEFAULT 0,
            line_total REAL DEFAULT 0,
            type TEXT CHECK(type IN ('consumable', 'non-consumable', 'bulk')) DEFAULT 'consumable',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(invoice_id) REFERENCES Invoices(id),
            FOREIGN KEY(inventory_item_id) REFERENCES InventoryItems(id)
        );
    `,
        logTableResult("InvoiceItems")
    );

    // ----------------------------------
    // InvoiceExtraItems (charges / deductions)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS InvoiceExtraItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            type TEXT CHECK(type IN ('charge', 'deduction')) NOT NULL,
            amount REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(invoice_id) REFERENCES Invoices(id)
        );
    `,
        logTableResult("InvoiceExtraItems")
    );

    // ----------------------------------
    // Expenses (manual operating expenses)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            category TEXT,
            amount REAL NOT NULL,
            expense_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("Expenses")
    );

    // ----------------------------------
    // Notifications (system events)
    // ----------------------------------
    db.run(
        `
        CREATE TABLE IF NOT EXISTS Notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `,
        logTableResult("Notifications")
    );
});

db.close();