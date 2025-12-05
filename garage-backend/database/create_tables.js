const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./workshop.db");

const log = (name) => (err) =>
  err ? console.error(`${name} error:`, err.message) : console.log(`${name} ready`);

db.serialize(() => {

    // ================================
    //  CUSTOMERS
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `, log("Customers"));


    // ================================
    //  VEHICLES
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            make TEXT,
            model TEXT,
            year TEXT,
            license_plate TEXT,
            archived INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(customer_id) REFERENCES Customers(id)
        );
    `, log("Vehicles"));


    // ================================
    //  TECHNICIANS
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Technicians (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            status TEXT CHECK(status IN ('Active', 'On Leave', 'Inactive')) DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `, log("Technicians"));


    // ================================
    //  JOBS
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            vehicle_id INTEGER NOT NULL,
            description TEXT,
            notes TEXT,
            category TEXT,
            initial_amount REAL,
            advance_amount REAL,
            job_status TEXT CHECK(job_status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
            status_changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            invoice_created INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(customer_id) REFERENCES Customers(id),
            FOREIGN KEY(vehicle_id) REFERENCES Vehicles(id)
        );
    `, log("Jobs"));


    // ================================
    //  JOB ↔ TECHNICIANS (M2M)
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS JobTechnicians (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            technician_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(job_id) REFERENCES Jobs(id),
            FOREIGN KEY(technician_id) REFERENCES Technicians(id)
        );
    `, log("JobTechnicians"));


    // ================================
    //  INVENTORY ITEMS
    // ================================
    db.run(`
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
    `, log("InventoryItems"));


    // ================================
    //  SUPPLIERS
    // ================================
    db.run(`
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
    `, log("Suppliers"));


    // ================================
    //  SUPPLIER PURCHASES (Stock Intake)
    // ================================
    db.run(`
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
    `, log("SupplierPurchases"));


    // ================================
    //  JOB ITEMS (Estimate breakdown)
    // ================================
    db.run(`
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
    `, log("JobItems"));


    // ================================
    //  INVOICES
    // ================================
    db.run(`
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
    `, log("Invoices"));


    // ================================
    //  INVOICE ITEMS
    // ================================
    db.run(`
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
    `, log("InvoiceItems"));


    // ================================
    //  EXTRA INVOICE CHARGES/DEDUCTIONS
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS InvoiceExtraItems (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            type TEXT CHECK(type IN ('charge', 'deduction')) NOT NULL,
            amount REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(invoice_id) REFERENCES Invoices(id)
        );
    `, log("InvoiceExtraItems"));


    // ================================
    //  EXPENSES
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            category TEXT,
            amount REAL NOT NULL,
            expense_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            payment_status TEXT CHECK(payment_status IN ('pending', 'paid', 'unpaid')) DEFAULT 'pending',
            payment_method TEXT,
            remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `, log("Expenses"));


    // ================================
    //  NOTIFICATIONS
    // ================================
    db.run(`
        CREATE TABLE IF NOT EXISTS Notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `, log("Notifications"));

});

db.close();
