const express = require("express");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const db = require("../../database/db");
const { createNotification, notifyLowStockIfNeeded } = require("../utils/notifications");

const VALID_PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const VALID_INVOICE_ITEM_TYPES = ["consumable", "non-consumable", "bulk"];

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

const roundCurrency = (value = 0) => Number((Number(value) || 0).toFixed(2));

const parseAmount = (value, fieldName) => {
    if (value === undefined || value === null || value === "") return 0;
    const amount = Number(value);
    if (Number.isNaN(amount)) {
        const validationError = new Error(`${fieldName} must be a valid number`);
        validationError.status = 400;
        throw validationError;
    }
    return amount;
};

const parseQuantity = (value, fieldName) => {
    if (value === undefined || value === null || value === "") return 0;
    const quantity = Number(value);
    if (Number.isNaN(quantity)) {
        const validationError = new Error(`${fieldName} must be a valid number`);
        validationError.status = 400;
        throw validationError;
    }
    return quantity;
};

const generateInvoiceNumber = async () => {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `INV-${datePart}-`;
    const latest = await getAsync(
        `
        SELECT invoice_no
        FROM Invoices
        WHERE invoice_no LIKE ?
        ORDER BY invoice_no DESC
        LIMIT 1
    `,
        [`${prefix}%`]
    );

    let sequence = 1;
    if (latest && latest.invoice_no) {
        const tail = Number(latest.invoice_no.split("-").pop());
        if (!Number.isNaN(tail)) {
            sequence = tail + 1;
        }
    }

    return `${prefix}${String(sequence).padStart(4, "0")}`;
};

const prepareInvoiceItems = async (items = []) => {
    if (!Array.isArray(items)) return [];

    const inventoryCache = new Map();
    const consumableUsage = new Map();
    const prepared = [];

    for (const item of items) {
        const {
            inventory_item_id,
            item_name,
            type,
            quantity = 1,
            unit_price,
            price,
        } = item;

        let resolvedName = typeof item_name === "string" ? item_name.trim() : "";
        const quantityValue = parseQuantity(quantity, "quantity");
        const unitPriceValue = parseAmount(unit_price ?? price, "unit_price");
        const lineTotal = roundCurrency(quantityValue * unitPriceValue);

        let resolvedType = type;
        let inventoryType = resolvedType;

        if (inventory_item_id) {
            if (!inventoryCache.has(inventory_item_id)) {
                const inventoryItem = await getAsync(
                    `
                    SELECT id, name, type, quantity
                    FROM InventoryItems
                    WHERE id = ?
                `,
                    [inventory_item_id]
                );

                if (!inventoryItem) {
                    const notFoundError = new Error(`Inventory item ${inventory_item_id} not found`);
                    notFoundError.status = 404;
                    throw notFoundError;
                }
                inventoryCache.set(inventory_item_id, inventoryItem);
            }

            const inventoryItem = inventoryCache.get(inventory_item_id);

            resolvedName = resolvedName || inventoryItem.name;
            resolvedType = inventoryItem.type;
            inventoryType = inventoryItem.type;

            if (inventoryItem.type === "consumable") {
                const plannedUsage = (consumableUsage.get(inventory_item_id) || 0) + quantityValue;
                if (plannedUsage > inventoryItem.quantity) {
                    const stockError = new Error(`Insufficient stock for ${inventoryItem.name}`);
                    stockError.status = 400;
                    throw stockError;
                }
                consumableUsage.set(inventory_item_id, plannedUsage);
            }
        } else {
            if (!resolvedName) {
                const validationError = new Error("Each invoice item requires an item_name or inventory_item_id");
                validationError.status = 400;
                throw validationError;
            }

            const fallbackType = resolvedType || "consumable";
            if (!VALID_INVOICE_ITEM_TYPES.includes(fallbackType)) {
                const typeError = new Error(
                    "Invoice item type must be one of 'consumable', 'non-consumable', or 'bulk'"
                );
                typeError.status = 400;
                throw typeError;
            }
            resolvedType = fallbackType;
            inventoryType = resolvedType;
        }

        if (!VALID_INVOICE_ITEM_TYPES.includes(resolvedType)) {
            const typeError = new Error(
                "Invoice item type must be one of 'consumable', 'non-consumable', or 'bulk'"
            );
            typeError.status = 400;
            throw typeError;
        }

        prepared.push({
            inventory_item_id: inventory_item_id || null,
            item_name: resolvedName,
            type: resolvedType,
            quantity: Number(quantityValue),
            unit_price: roundCurrency(unitPriceValue),
            line_total: lineTotal,
            inventoryType,
        });
    }

    return prepared;
};

const insertInvoiceItems = async (invoiceId, items = [], options = {}) => {
    if (!items.length) return [];

    const { invoiceNo } = options;
    const inserted = [];
    const consumableMovements = [];

    for (const item of items) {
        const result = await runAsync(
            `
            INSERT INTO InvoiceItems (invoice_id, inventory_item_id, item_name, type, quantity, unit_price, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            [
                invoiceId,
                item.inventory_item_id,
                item.item_name,
                item.type,
                item.quantity,
                item.unit_price,
                item.line_total,
            ]
        );

        inserted.push({
            id: result.lastID,
            invoice_id: invoiceId,
            inventory_item_id: item.inventory_item_id,
            item_name: item.item_name,
            type: item.type,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
        });

        if (item.inventory_item_id && item.inventoryType === "consumable") {
            await runAsync(
                `
                UPDATE InventoryItems
                SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
                [item.quantity, item.inventory_item_id]
            );
            consumableMovements.push({
                itemId: item.inventory_item_id,
                itemName: item.item_name,
                quantity: item.quantity,
            });
        }
    }

    if (consumableMovements.length) {
        for (const movement of consumableMovements) {
            await notifyLowStockIfNeeded(movement.itemId);
        }

        const formatQuantity = (qty) => (Number.isInteger(qty) ? qty : qty.toFixed(2));
        const summary = consumableMovements
            .map((movement) => `${formatQuantity(movement.quantity)} x ${movement.itemName}`)
            .join(", ");

        await createNotification({
            title: "Inventory used",
            message: `${summary} deducted for invoice ${invoiceNo || `#${invoiceId}`}.`,
            type: "stock-usage",
        });
    }

    return inserted;
};

const restockInvoiceItems = async (invoiceId, options = {}) => {
    const { invoiceNo, reason } = options;
    const consumables = await allAsync(
        `
        SELECT InvoiceItems.inventory_item_id, InvoiceItems.quantity, InventoryItems.name
        FROM InvoiceItems
        LEFT JOIN InventoryItems ON InventoryItems.id = InvoiceItems.inventory_item_id
        WHERE InvoiceItems.invoice_id = ?
          AND InvoiceItems.inventory_item_id IS NOT NULL
          AND InvoiceItems.type = 'consumable'
    `,
        [invoiceId]
    );

    if (!consumables.length) return;

    const restockedMovements = [];

    for (const item of consumables) {
        await runAsync(
            `
            UPDATE InventoryItems
            SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [item.quantity, item.inventory_item_id]
        );
        restockedMovements.push({
            itemId: item.inventory_item_id,
            itemName: item.name || `Item #${item.inventory_item_id}`,
            quantity: item.quantity,
        });
    }

    if (restockedMovements.length) {
        const formatQuantity = (qty) => (Number.isInteger(qty) ? qty : qty.toFixed(2));
        const summary = restockedMovements
            .map((movement) => `${formatQuantity(movement.quantity)} x ${movement.itemName}`)
            .join(", ");

        const reference = invoiceNo || `#${invoiceId}`;
        const reasonLabel = reason === "delete" ? "invoice deletion" : "invoice update";

        await createNotification({
            title: "Inventory restocked",
            message: `${summary} from invoice ${reference} due to ${reasonLabel}.`,
            type: "stock-add",
        });
    }
};

const prepareExtraItems = (entries = [], type) => {
    if (!Array.isArray(entries)) return [];

    return entries
        .filter((entry) => entry && (entry.label || entry.amount !== undefined))
        .map((entry) => {
            const label = typeof entry.label === "string" ? entry.label.trim() : "";
            if (!label) {
                const error = new Error("Each extra item requires a label");
                error.status = 400;
                throw error;
            }

            const amount = parseAmount(entry.amount, `amount for ${label}`);
            if (amount < 0) {
                const error = new Error("Extra item amount cannot be negative");
                error.status = 400;
                throw error;
            }

            return {
                label,
                amount: roundCurrency(amount),
                type,
            };
        });
};

const insertInvoiceExtraItems = async (invoiceId, entries = []) => {
    for (const entry of entries) {
        await runAsync(
            `
            INSERT INTO InvoiceExtraItems (invoice_id, label, type, amount)
            VALUES (?, ?, ?, ?)
        `,
            [invoiceId, entry.label, entry.type, entry.amount]
        );
    }
};

const calculateTotals = (items = [], charges = [], reductions = []) => {
    const itemsTotal = roundCurrency(items.reduce((sum, item) => sum + (item.line_total || 0), 0));
    const totalCharges = roundCurrency(charges.reduce((sum, entry) => sum + (entry.amount || 0), 0));
    const totalDeductions = roundCurrency(
        reductions.reduce((sum, entry) => sum + (entry.amount || 0), 0)
    );
    const finalTotal = roundCurrency(itemsTotal + totalCharges - totalDeductions);

    return { itemsTotal, totalCharges, totalDeductions, finalTotal };
};

const recalculatePersistedTotals = async (invoiceId) => {
    const itemsRow = await getAsync(
        `
        SELECT COALESCE(SUM(line_total), 0) AS total
        FROM InvoiceItems
        WHERE invoice_id = ?
    `,
        [invoiceId]
    );

    const chargesRow = await getAsync(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM InvoiceExtraItems
        WHERE invoice_id = ? AND type = 'charge'
    `,
        [invoiceId]
    );

    const deductionsRow = await getAsync(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM InvoiceExtraItems
        WHERE invoice_id = ? AND type = 'deduction'
    `,
        [invoiceId]
    );

    const itemsTotal = roundCurrency(itemsRow.total);
    const totalCharges = roundCurrency(chargesRow.total);
    const totalDeductions = roundCurrency(deductionsRow.total);
    const finalTotal = roundCurrency(itemsTotal + totalCharges - totalDeductions);

    return {
        itemsTotal,
        totalCharges,
        totalDeductions,
        finalTotal,
    };
};

const loadInvoiceDetails = async (invoiceId) => {
    const invoice = await getAsync(
        `
        SELECT Invoices.*, Jobs.description AS job_description, Jobs.job_status,
               Jobs.initial_amount, Jobs.advance_amount, Jobs.mileage,
               Customers.id AS customer_id, Customers.name AS customer_name, Customers.email AS customer_email,
               Customers.phone AS customer_phone, Customers.address AS customer_address
        FROM Invoices
        LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        WHERE Invoices.id = ?
    `,
        [invoiceId]
    );

    if (!invoice) return null;

    const items = await allAsync(
        `
        SELECT id, invoice_id, inventory_item_id, item_name, type, quantity, unit_price, line_total
        FROM InvoiceItems
        WHERE invoice_id = ?
        ORDER BY id ASC
    `,
        [invoiceId]
    );

    const extras = await allAsync(
        `
        SELECT id, label, type, amount
        FROM InvoiceExtraItems
        WHERE invoice_id = ?
        ORDER BY id ASC
    `,
        [invoiceId]
    );

    return {
        ...invoice,
        items,
        charges: extras.filter((entry) => entry.type === "charge"),
        reductions: extras.filter((entry) => entry.type === "deduction"),
    };
};

const generateInvoicePdfBuffer = (invoice) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // ═══════════════════════════════════════════════════════════
        // CONFIGURATION
        // ═══════════════════════════════════════════════════════════
        const PRIMARY = "#B91C1C";      // Red for branding
        const DARK = "#111827";         // Dark text
        const GRAY = "#6B7280";         // Secondary text
        const LIGHT = "#F9FAFB";        // Light background
        const BORDER = "#E5E7EB";       // Borders
        const margin = 50;
        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - margin * 2;

        // Helper functions
        const formatCurrency = (val) => `LKR ${Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const formatDate = (val) => {
            if (!val) return "N/A";
            const d = new Date(val);
            return isNaN(d.getTime()) ? val : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        };

        // Data
        const items = invoice.items ?? [];
        const charges = invoice.charges ?? [];
        const reductions = invoice.reductions ?? [];
        const subtotal = items.reduce((s, i) => s + Number(i.line_total ?? 0), 0) + charges.reduce((s, c) => s + Number(c.amount ?? 0), 0);
        const totalReductions = reductions.reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const totalDue = invoice.final_total ?? subtotal - totalReductions;
        const status = (invoice.payment_status ?? "unpaid").charAt(0).toUpperCase() + (invoice.payment_status ?? "unpaid").slice(1);

        let y = margin;

        // ═══════════════════════════════════════════════════════════
        // WATERMARK LOGO (centered, semi-transparent)
        // ═══════════════════════════════════════════════════════════
        const logoPath = path.join(__dirname, "../assets/logo.jpg");
        if (fs.existsSync(logoPath)) {
            doc.save();
            doc.opacity(0.15);
            const logoWidth = 400;
            const logoHeight = 230;
            const logoX = (pageWidth - logoWidth) / 2;
            const logoY = (doc.page.height - logoHeight) / 2;
            doc.image(logoPath, logoX, logoY, { width: logoWidth });
            doc.restore();
            doc.opacity(1);
        }

        // ═══════════════════════════════════════════════════════════
        // HEADER - COMPANY DETAILS (CENTERED)
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", margin, y, { width: contentWidth, align: "center" });
        y += 22;

        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        doc.text("071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com", margin, y, { width: contentWidth, align: "center" });
        y += 15;

        // Divider
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(1.5).stroke();
        y += 15;

        // ═══════════════════════════════════════════════════════════
        // INVOICE TITLE & INFO
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(22).fillColor(DARK);
        doc.text("INVOICE", margin, y);

        // Invoice details (right)
        const invoiceNo = invoice.invoice_no ?? `INV-${String(invoice.id).padStart(5, "0")}`;
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        doc.text(`Invoice #: ${invoiceNo}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Date: ${formatDate(invoice.invoice_date)}`, pageWidth - margin - 180, y + 12, { width: 180, align: "right" });
        doc.text(`Status: ${status}`, pageWidth - margin - 180, y + 24, { width: 180, align: "right" });

        y += 40;

        // ═══════════════════════════════════════════════════════════
        // BILL TO SECTION
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
        doc.text("BILL TO:", margin, y);
        y += 12;

        doc.font("Helvetica").fontSize(9).fillColor(DARK);
        doc.text(invoice.customer_name ?? "Walk-in Customer", margin, y);
        y += 12;

        doc.fillColor(GRAY).fontSize(8);
        if (invoice.customer_phone) { doc.text(invoice.customer_phone, margin, y); y += 10; }
        if (invoice.customer_email) { doc.text(invoice.customer_email, margin, y); y += 10; }
        if (invoice.customer_address) { doc.text(invoice.customer_address, margin, y, { width: 250 }); y += 12; }

        y += 10;

        // ═══════════════════════════════════════════════════════════
        // ITEMS TABLE
        // ═══════════════════════════════════════════════════════════
        const tableTop = y;
        const col1 = 35;    // #
        const col2 = 305;   // Description
        const col3 = 55;    // Qty
        const col4 = contentWidth - col1 - col2 - col3; // Amount
        const rowH = 22;

        // Header
        doc.rect(margin, y, contentWidth, rowH).fill(DARK);
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
        doc.text("#", margin + 8, y + 7, { width: col1 - 8 });
        doc.text("DESCRIPTION", margin + col1 + 8, y + 7, { width: col2 - 8 });
        doc.text("QTY", margin + col1 + col2, y + 7, { width: col3, align: "center" });
        doc.text("AMOUNT", margin + col1 + col2 + col3, y + 7, { width: col4 - 8, align: "right" });
        y += rowH;

        // Rows
        let rowNum = 1;
        const drawRow = (desc, qty, amount, alt) => {
            if (alt) doc.rect(margin, y, contentWidth, rowH).fill(LIGHT);
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(String(rowNum++), margin + 8, y + 7, { width: col1 - 8 });
            doc.text(desc, margin + col1 + 8, y + 7, { width: col2 - 16 });
            doc.text(qty, margin + col1 + col2, y + 7, { width: col3, align: "center" });
            doc.text(amount, margin + col1 + col2 + col3, y + 7, { width: col4 - 8, align: "right" });
            y += rowH;
        };

        items.forEach((item, i) => drawRow(item.item_name ?? "Item", String(item.quantity ?? 1), formatCurrency(item.line_total ?? 0), i % 2 === 0));
        charges.forEach((c, i) => drawRow(c.label ?? "Charge", "1", formatCurrency(c.amount ?? 0), (items.length + i) % 2 === 0));

        y += 15;

        // ═══════════════════════════════════════════════════════════
        // SUMMARY
        // ═══════════════════════════════════════════════════════════
        const sumX = pageWidth - margin - 200;
        const sumW = 200;
        const summaryHeight = 70 + (reductions.length * 14);

        doc.rect(sumX, y, sumW, summaryHeight).strokeColor(BORDER).lineWidth(1).stroke();

        let sumY = y + 10;
        const sumRow = (label, value, bold = false, red = false) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
            doc.fillColor(GRAY).text(label, sumX + 12, sumY, { width: 90 });
            doc.fillColor(red ? PRIMARY : DARK).text(value, sumX + 100, sumY, { width: 85, align: "right" });
            sumY += 14;
        };

        sumRow("Subtotal:", formatCurrency(subtotal));
        if (reductions.length > 0) {
            reductions.forEach(r => sumRow(`- ${r.label ?? "Discount"}:`, `-${formatCurrency(r.amount ?? 0)}`));
        }
        sumY += 3;
        doc.moveTo(sumX + 12, sumY).lineTo(sumX + sumW - 12, sumY).strokeColor(BORDER).stroke();
        sumY += 8;
        sumRow("TOTAL DUE:", formatCurrency(totalDue), true, true);

        y += summaryHeight + 15;

        // ═══════════════════════════════════════════════════════════
        // NOTES
        // ═══════════════════════════════════════════════════════════
        if (invoice.notes) {
            doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
            doc.text("Notes:", margin, y);
            doc.font("Helvetica").fontSize(8).fillColor(GRAY);
            doc.text(invoice.notes, margin, y + 12, { width: contentWidth });
            y += 30;
        }


        doc.end();
    });

// Create invoice
router.post("/", async (req, res) => {
    const {
        job_id,
        items = [],
        charges,
        reductions,
        payment_method,
        payment_status = "unpaid",
        notes,
    } = req.body;

    if (!job_id) {
        return res.status(400).json({ error: "job_id is required" });
    }

    if (!VALID_PAYMENT_STATUSES.includes(payment_status)) {
        return res.status(400).json({ error: "Invalid payment status value" });
    }

    try {
        const job = await getAsync("SELECT * FROM Jobs WHERE id = ?", [job_id]);
        if (!job) {
            return res.status(404).json({ error: "Job not found" });
        }

        if (job.job_status !== "Completed") {
            return res
                .status(400)
                .json({ error: "Invoice can only be created when the job status is Completed" });
        }

        const existingInvoice = await getAsync(
            `
            SELECT id FROM Invoices WHERE job_id = ?
        `,
            [job_id]
        );
        if (existingInvoice) {
            return res.status(409).json({ error: "An invoice already exists for this job" });
        }

        await runAsync("BEGIN TRANSACTION");

        const preparedItems = await prepareInvoiceItems(items);

        const rawCharges = Array.isArray(charges) ? [...charges] : [];
        const rawReductions = Array.isArray(reductions) ? [...reductions] : [];

        if (
            job.advance_amount > 0 &&
            !rawReductions.some(
                (entry) => typeof entry.label === "string" && entry.label.trim().toLowerCase() === "advance"
            )
        ) {
            rawReductions.unshift({ label: "Advance", amount: job.advance_amount });
        }

        const preparedCharges = prepareExtraItems(rawCharges, "charge");
        const preparedReductions = prepareExtraItems(rawReductions, "deduction");

        const totals = calculateTotals(preparedItems, preparedCharges, preparedReductions);
        const invoiceNo = await generateInvoiceNumber();

        const invoiceResult = await runAsync(
            `
            INSERT INTO Invoices (
                job_id,
                invoice_no,
                items_total,
                total_charges,
                total_deductions,
                final_total,
                payment_method,
                payment_status,
                notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
                job_id,
                invoiceNo,
                totals.itemsTotal,
                totals.totalCharges,
                totals.totalDeductions,
                totals.finalTotal,
                payment_method,
                payment_status,
                notes,
            ]
        );

        const invoiceId = invoiceResult.lastID;

        await insertInvoiceItems(invoiceId, preparedItems, { invoiceNo });
        await insertInvoiceExtraItems(invoiceId, [...preparedCharges, ...preparedReductions]);

        await runAsync("COMMIT");

        await createNotification({
            title: "Invoice created",
            message: `Invoice ${invoiceNo} created for job #${job_id}.`,
            type: "invoice",
        });

        const invoiceDetails = await loadInvoiceDetails(invoiceId);
        res.status(201).json(invoiceDetails);
    } catch (error) {
        try {
            await runAsync("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError.message);
        }
        console.error("Create invoice error:", error.message);
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: error.message });
    }
});

// List invoices
router.get("/", async (req, res) => {
    const { startDate, endDate, jobId } = req.query;
    const clauses = [];
    const params = [];

    if (startDate) {
        clauses.push("DATE(invoice_date) >= DATE(?)");
        params.push(startDate);
    }

    if (endDate) {
        clauses.push("DATE(invoice_date) <= DATE(?)");
        params.push(endDate);
    }

    if (jobId) {
        clauses.push("job_id = ?");
        params.push(jobId);
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    try {
        const invoices = await allAsync(
            `
            SELECT Invoices.*, Customers.name AS customer_name
            FROM Invoices
            LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
            LEFT JOIN Customers ON Customers.id = Jobs.customer_id
            ${whereClause}
            ORDER BY invoice_date DESC
        `,
            params
        );
        res.json(invoices);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get invoice by ID
router.get("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const invoice = await loadInvoiceDetails(id);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }
        res.json(invoice);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update invoice
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { items, charges, reductions, payment_method, payment_status, notes } = req.body;

    if (payment_status && !VALID_PAYMENT_STATUSES.includes(payment_status)) {
        return res.status(400).json({ error: "Invalid payment status value" });
    }

    try {
        const existingInvoice = await loadInvoiceDetails(id);
        if (!existingInvoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const paymentStatusChangedToPaid =
            payment_status &&
            payment_status === "paid" &&
            existingInvoice.payment_status !== "paid";

        await runAsync("BEGIN TRANSACTION");

        if (Array.isArray(items)) {
            await restockInvoiceItems(id, { invoiceNo: existingInvoice.invoice_no, reason: "update" });
            await runAsync("DELETE FROM InvoiceItems WHERE invoice_id = ?", [id]);
            const preparedItems = await prepareInvoiceItems(items);
            await insertInvoiceItems(id, preparedItems, { invoiceNo: existingInvoice.invoice_no });
        }

        if (charges !== undefined) {
            await runAsync("DELETE FROM InvoiceExtraItems WHERE invoice_id = ? AND type = 'charge'", [id]);
            const preparedCharges = prepareExtraItems(Array.isArray(charges) ? charges : [], "charge");
            await insertInvoiceExtraItems(id, preparedCharges);
        }

        if (reductions !== undefined) {
            await runAsync("DELETE FROM InvoiceExtraItems WHERE invoice_id = ? AND type = 'deduction'", [
                id,
            ]);
            const preparedReductions = prepareExtraItems(Array.isArray(reductions) ? reductions : [], "deduction");
            await insertInvoiceExtraItems(id, preparedReductions);
        }

        const totals = await recalculatePersistedTotals(id);

        await runAsync(
            `
            UPDATE Invoices
            SET payment_method = COALESCE(?, payment_method),
                payment_status = COALESCE(?, payment_status),
                notes = COALESCE(?, notes),
                items_total = ?,
                total_charges = ?,
                total_deductions = ?,
                final_total = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [
                payment_method,
                payment_status,
                notes,
                totals.itemsTotal,
                totals.totalCharges,
                totals.totalDeductions,
                totals.finalTotal,
                id,
            ]
        );

        await runAsync("COMMIT");

        const invoice = await loadInvoiceDetails(id);

        if (paymentStatusChangedToPaid) {
            await createNotification({
                title: "Invoice paid",
                message: `Invoice ${invoice.invoice_no || `#${id}`} marked as paid.`,
                type: "payment",
            });
        }

        res.json(invoice);
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

// Delete invoice
router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const existing = await loadInvoiceDetails(id);
        if (!existing) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        await runAsync("BEGIN TRANSACTION");

        await restockInvoiceItems(id, { invoiceNo: existing.invoice_no, reason: "delete" });
        await runAsync("DELETE FROM InvoiceExtraItems WHERE invoice_id = ?", [id]);
        await runAsync("DELETE FROM InvoiceItems WHERE invoice_id = ?", [id]);
        await runAsync("DELETE FROM Invoices WHERE id = ?", [id]);
        if (existing.job_id) {
            await runAsync(
                `
                UPDATE Jobs
                SET invoice_created = 0
                WHERE id = ?
            `,
                [existing.job_id]
            );
        }

        await runAsync("COMMIT");

        await createNotification({
            title: "Invoice deleted",
            message: `Invoice ${existing.invoice_no || `#${id}`} deleted.`,
            type: "invoice",
        });

        res.json({ message: "Invoice deleted" });
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

// Generate invoice PDF
router.get("/:id/pdf", async (req, res) => {
    const { id } = req.params;

    try {
        const invoice = await loadInvoiceDetails(id);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const pdfBuffer = await generateInvoicePdfBuffer(invoice);
        const filename = `invoice-${invoice.invoice_no || id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
        res.send(pdfBuffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Email invoice
router.post("/:id/email", async (req, res) => {
    const { id } = req.params;
    const { to, subject = "Garage Invoice", message } = req.body;

    try {
        const invoice = await loadInvoiceDetails(id);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        const recipient = to || invoice.customer_email;
        if (!recipient) {
            return res.status(400).json({ error: "Recipient email is required" });
        }

        const pdfBuffer = await generateInvoicePdfBuffer(invoice);

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === "true",
            auth: process.env.SMTP_USER
                ? {
                      user: process.env.SMTP_USER,
                      pass: process.env.SMTP_PASS,
                  }
                : undefined,
        });

        await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: recipient,
            subject,
            text: message || "Please find attached your invoice.",
            attachments: [
                {
                    filename: `invoice-${invoice.invoice_no || id}.pdf`,
                    content: pdfBuffer,
                },
            ],
        });

        res.json({ message: "Invoice emailed successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;