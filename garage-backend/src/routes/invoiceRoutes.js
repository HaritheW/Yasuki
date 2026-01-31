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

            await runAsync(
                `
                INSERT INTO InventoryUsage (invoice_id, inventory_item_id, quantity, source, created_at)
                VALUES (?, ?, ?, 'invoice', CURRENT_TIMESTAMP)
            `,
                [invoiceId, item.inventory_item_id, item.quantity]
            );
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

    const rawItems = await allAsync(
        `
        SELECT ii.id, ii.invoice_id, ii.inventory_item_id, ii.item_name, ii.type, ii.quantity, ii.unit_price, ii.line_total,
               inv.genuine_or_non_genuine AS genuine_or_non_genuine
        FROM InvoiceItems ii
        LEFT JOIN InventoryItems inv ON inv.id = ii.inventory_item_id
        WHERE ii.invoice_id = ?
        ORDER BY ii.id ASC
    `,
        [invoiceId]
    );
    // Normalize row keys (sqlite3 may return prefixed or different-cased keys from JOINs)
    const items = (rawItems || []).map((row) => ({
        id: row.id,
        invoice_id: row.invoice_id,
        inventory_item_id: row.inventory_item_id,
        item_name: row.item_name ?? row.Item_name ?? row["ii.item_name"],
        type: row.type,
        quantity: row.quantity,
        unit_price: row.unit_price,
        line_total: row.line_total,
        genuine_or_non_genuine: row.genuine_or_non_genuine ?? row.Genuine_or_non_genuine,
    }));

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
        const formatAmount = (val) => Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatAmountStar = (val) => `${formatAmount(val)}*`;
        const formatQuantity = (val) => Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
        const formatDate = (val) => {
            if (!val) return "N/A";
            const d = new Date(val);
            return isNaN(d.getTime())
                ? val
                : d.toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "Asia/Colombo",
                  });
        };

        // Data – split for invoice format: Workshop Charges (labour), Genuine parts, Non-Genuine parts
        const items = invoice.items ?? [];
        const charges = invoice.charges ?? [];
        const reductions = invoice.reductions ?? [];
        // Normalize genuine flag (handle casing/whitespace; null/undefined = non-genuine)
        const isGenuine = (i) => String(i.genuine_or_non_genuine || "").toLowerCase().trim() === "genuine";
        const genuineItems = items.filter(isGenuine);
        const nonGenuineItems = items.filter((i) => !isGenuine(i));
        const labourTotal = charges.reduce((s, c) => s + Number(c.amount ?? 0), 0);
        const genuineTotal = genuineItems.reduce((s, i) => s + Number(i.line_total ?? 0), 0);
        const nonGenuineTotal = nonGenuineItems.reduce((s, i) => s + Number(i.line_total ?? 0), 0);
        const subtotal = labourTotal + genuineTotal + nonGenuineTotal;
        const totalReductions = reductions.reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const totalDue = invoice.final_total ?? subtotal - totalReductions;
        const status = (invoice.payment_status ?? "unpaid").charAt(0).toUpperCase() + (invoice.payment_status ?? "unpaid").slice(1);
        const invoiceDateYyyymmdd = invoice.invoice_date
            ? new Date(invoice.invoice_date).toISOString().slice(0, 10).replace(/-/g, "")
            : "";

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
        // HEADER - LOGO + COMPANY DETAILS (Compact banner design)
        // ═══════════════════════════════════════════════════════════
        const logoSize = 55; // Compact logo size for standard header
        const logoX = margin;
        const headerStartY = y;
        
        // Draw company logo on left (compact banner design)
        if (fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, logoX, y, { 
                    width: logoSize, 
                    height: logoSize
                });
            } catch (err) {
                console.error("Error loading company logo:", err.message);
            }
        }
        
        // Company name next to logo - ensure it fits on one line
        const textX = margin + logoSize + 12;
        const companyNameWidth = contentWidth - (textX - margin) - 10; // Available width for company name
        
        doc.font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY);
        // Ensure company name fits on one line by using available width
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", textX, y + 6, { 
            width: companyNameWidth,
            ellipsis: false
        });
        
        // Contact information below company name (compact spacing)
        doc.font("Helvetica").fontSize(8).fillColor(DARK);
        const contactY = y + 26;
        doc.text("Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com", textX, contactY, {
            width: companyNameWidth
        });
        
        // Calculate position for brand logos - compact spacing
        const topSectionBottom = Math.max(y + logoSize, contactY + 10);
        
        // Add brand logos image spanning full width below contact info (compact)
        const brandLogosPath = path.join(__dirname, "../assets/Brand logos.png");
        const brandLogosY = topSectionBottom + 10; // Compact spacing below contact info
        
        if (fs.existsSync(brandLogosPath)) {
            const brandLogosWidth = contentWidth;
            const brandLogosHeight = 50; // Compact height for standard header
            
            // Draw brand logos spanning full width - compact design
            try {
                doc.image(brandLogosPath, margin, brandLogosY, { 
                    width: brandLogosWidth,
                    height: brandLogosHeight
                });
                // Update y position to after logos
                y = brandLogosY + brandLogosHeight + 8;
            } catch (err) {
                // If image fails to load, log error but continue
                console.error("Error loading brand logos image:", err.message);
                y = brandLogosY + 15;
            }
        } else {
            console.warn("Brand logos image not found at:", brandLogosPath);
            y = brandLogosY + 15;
        }

        // Red horizontal line at the bottom of header (matching banner design)
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(2).stroke();
        y += 15;

        // ═══════════════════════════════════════════════════════════
        // INVOICE TITLE & INFO
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK);
        doc.text("INVOICE", margin, y);

        // Invoice details (right)
        const invoiceNo = invoice.invoice_no ?? `INV-${String(invoice.id).padStart(5, "0")}`;
        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        doc.text(`Invoice #: ${invoiceNo}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Date: ${formatDate(invoice.invoice_date)}`, pageWidth - margin - 180, y + 10, { width: 180, align: "right" });
        doc.text(`Status: ${status}`, pageWidth - margin - 180, y + 20, { width: 180, align: "right" });

        y += 32;

        // ═══════════════════════════════════════════════════════════
        // BILL TO SECTION
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("BILL TO:", margin, y);
        y += 10;

        doc.font("Helvetica").fontSize(8).fillColor(DARK);
        doc.text(invoice.customer_name ?? "Walk-in Customer", margin, y);
        y += 10;

        doc.fillColor(GRAY).fontSize(7);
        if (invoice.customer_phone) { doc.text(invoice.customer_phone, margin, y); y += 8; }
        if (invoice.customer_email) { doc.text(invoice.customer_email, margin, y); y += 8; }
        if (invoice.customer_address) { doc.text(invoice.customer_address, margin, y, { width: 250 }); y += 10; }

        y += 8;

        // ═══════════════════════════════════════════════════════════
        // INVOICE DATA FORMAT: Workshop Charges, Genuine Parts, Non-Genuine Parts
        // ═══════════════════════════════════════════════════════════
        const rowH = 20;
        const dashY = () => {
            doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(BORDER).lineWidth(0.5).stroke();
            y += 8;
        };

        // Helper to clean item name (remove quantity pattern)
        const cleanItemName = (itemName) => {
            if (!itemName || typeof itemName !== "string") return itemName;
            return itemName
                .replace(/\s*\(\d+(?:\.\d+)?\s*×\s*\)/gi, "")
                .replace(/\s*\(\d+(?:\.\d+)?\s*x\s*\)/gi, "")
                .trim();
        };

        // ─── 1. WORKSHOP CHARGES (Labour) ───
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
        doc.text("WORKSHOP CHARGES", margin, y, { width: contentWidth, align: "center" });
        y += 14;

        const cColNo = 40;
        const cColDesc = contentWidth - cColNo - 90;
        const cColAmt = 90;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("ITEM NO.", margin + 6, y + 6, { width: cColNo - 6 });
        doc.text("DESCRIPTION", margin + cColNo + 6, y + 6, { width: cColDesc - 6 });
        doc.text("AMOUNT", margin + cColNo + cColDesc, y + 6, { width: cColAmt - 6, align: "right" });
        y += rowH;
        dashY();

        let chargeNo = 1;
        charges.forEach((c, i) => {
            if (i > 0) doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(String(chargeNo++), margin + 6, y + 6, { width: cColNo - 6 });
            doc.text(cleanItemName(c.label ?? "Charge"), margin + cColNo + 6, y + 6, { width: cColDesc - 12 });
            doc.text(formatAmountStar(c.amount ?? 0), margin + cColNo + cColDesc, y + 6, { width: cColAmt - 6, align: "right" });
            y += rowH;
        });
        if (charges.length === 0) {
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            y += rowH;
        }
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Labour Total:", margin + cColNo + cColDesc - 80, y + 6, { width: 80, align: "right" });
        doc.text(formatAmountStar(labourTotal), margin + cColNo + cColDesc, y + 6, { width: cColAmt - 6, align: "right" });
        y += rowH + 10;
        dashY();

        // ─── 2. WORKSHOP PARTS & MATERIALS (Genuine) ───
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
        doc.text("WORKSHOP PARTS & MATERIALS", margin, y, { width: contentWidth, align: "center" });
        y += 14;

        const pColNo = 35;
        const pColDesc = 260;
        const pColQty = 55;
        const pColTotal = contentWidth - pColNo - pColDesc - pColQty;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("IT.NO.", margin + 6, y + 6, { width: pColNo - 6 });
        doc.text("DESCRIPTION", margin + pColNo + 6, y + 6, { width: pColDesc - 6 });
        doc.text("QUANTITY", margin + pColNo + pColDesc, y + 6, { width: pColQty, align: "right" });
        doc.text("TOTAL", margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
        y += rowH;
        dashY();

        let genNo = 1;
        genuineItems.forEach((item, i) => {
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            const qty = Number(item.quantity);
            const qtyVal = !isNaN(qty) && qty > 0 ? qty : 1;
            const desc = (item.item_name != null ? item.item_name : item.Item_name) ?? "Item";
            const lineTotal = Number(item.line_total);
            const lineTotalVal = isNaN(lineTotal) ? 0 : lineTotal;
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(String(genNo++), margin + 6, y + 6, { width: pColNo - 6 });
            doc.text(cleanItemName(desc), margin + pColNo + 6, y + 6, { width: pColDesc - 12 });
            doc.text(formatQuantity(qtyVal), margin + pColNo + pColDesc, y + 6, { width: pColQty, align: "right" });
            doc.text(formatAmountStar(lineTotalVal), margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
            y += rowH;
        });
        if (genuineItems.length === 0) {
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            y += rowH;
        }
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Genuine Spare Parts Total:", margin + pColNo + pColDesc - 20, y + 6, { width: 140, align: "right" });
        doc.text(formatAmountStar(genuineTotal), margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
        y += rowH + 10;
        dashY();

        // ─── 3. WORKSHOP PARTS & MATERIALS (Non-Genuine) ───
        doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
        doc.text("WORKSHOP PARTS & MATERIALS", margin, y, { width: contentWidth, align: "center" });
        y += 14;

        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("IT.NO.", margin + 6, y + 6, { width: pColNo - 6 });
        doc.text("DESCRIPTION", margin + pColNo + 6, y + 6, { width: pColDesc - 6 });
        doc.text("QUANTITY", margin + pColNo + pColDesc, y + 6, { width: pColQty, align: "right" });
        doc.text("TOTAL", margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
        y += rowH;
        dashY();

        let nonGenNo = 1;
        nonGenuineItems.forEach((item, i) => {
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            const qty = Number(item.quantity);
            const qtyVal = !isNaN(qty) && qty > 0 ? qty : 1;
            const desc = (item.item_name != null ? item.item_name : item.Item_name) ?? "Item";
            const lineTotal = Number(item.line_total);
            const lineTotalVal = isNaN(lineTotal) ? 0 : lineTotal;
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(String(nonGenNo++), margin + 6, y + 6, { width: pColNo - 6 });
            doc.text(cleanItemName(desc), margin + pColNo + 6, y + 6, { width: pColDesc - 12 });
            doc.text(formatQuantity(qtyVal), margin + pColNo + pColDesc, y + 6, { width: pColQty, align: "right" });
            doc.text(formatAmountStar(lineTotalVal), margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
            y += rowH;
        });
        if (nonGenuineItems.length === 0) {
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
            y += rowH;
        }
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("None Genuine Spare Parts Total:", margin + pColNo + pColDesc - 20, y + 6, { width: 160, align: "right" });
        doc.text(formatAmountStar(nonGenuineTotal), margin + pColNo + pColDesc + pColQty, y + 6, { width: pColTotal - 6, align: "right" });
        y += rowH + 10;
        dashY();

        // ─── Date and Grand Total ───
        doc.font("Helvetica").fontSize(9).fillColor(DARK);
        doc.text(invoiceDateYyyymmdd, margin, y + 4);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
        doc.text("Grand Total:", pageWidth - margin - 130, y + 4, { width: 80, align: "right" });
        doc.text(formatAmountStar(totalDue), pageWidth - margin - 48, y + 4, { width: 48, align: "right" });
        y += 24;

        // Reductions (if any) – show below Grand Total
        if (reductions.length > 0) {
            reductions.forEach((r) => {
                doc.font("Helvetica").fontSize(8).fillColor(GRAY);
                doc.text(`- ${r.label ?? "Discount"}: -${formatCurrency(r.amount ?? 0)}`, pageWidth - margin - 200, y + 2, { width: 200, align: "right" });
                y += 12;
            });
            y += 6;
        }

        // ─── Signature lines ───
        y += 16;
        const sigLabels = ["Prepared By", "Checked By", "Approved By", "Customer Signature"];
        const sigW = contentWidth / 4;
        sigLabels.forEach((label, idx) => {
            doc.moveTo(margin + idx * sigW + 8, y).lineTo(margin + (idx + 1) * sigW - 8, y).strokeColor(BORDER).lineWidth(0.5).stroke();
            doc.font("Helvetica").fontSize(7).fillColor(GRAY);
            doc.text(label, margin + idx * sigW + 8, y + 6, { width: sigW - 16, align: "center" });
        });
        y += 28;

        // ═══════════════════════════════════════════════════════════
        // NOTES
        // ═══════════════════════════════════════════════════════════
        if (invoice.notes) {
            doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
            doc.text("Notes:", margin, y);
            doc.font("Helvetica").fontSize(7).fillColor(GRAY);
            doc.text(invoice.notes, margin, y + 10, { width: contentWidth });
            y += 20;
        }

        // ═══════════════════════════════════════════════════════════
        // FOOTER (Compact for one-page invoice)
        // ═══════════════════════════════════════════════════════════
        // Compact footer to fit on one page - only add new page if absolutely necessary
        const footerSpace = 50;
        const footerY = doc.page.height - margin - footerSpace;
        
        // Only add new page if content is very close to bottom (tight threshold)
        if (y > footerY - 10) {
            doc.addPage();
            // Add watermark to new page
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
            y = margin + 40;
        }
        
        // Position footer near bottom of current page (compact)
        const finalFooterY = doc.page.height - margin - footerSpace;
        
        // Draw compact dark gray horizontal line
        doc.save();
        doc.strokeColor("#374151"); // Dark gray color
        doc.lineWidth(2);
        doc.moveTo(margin, finalFooterY)
            .lineTo(pageWidth - margin, finalFooterY)
            .stroke();
        doc.restore();
        
        // Add thank you message below the line (centered, dark red, compact)
        doc.font("Helvetica").fontSize(9).fillColor(PRIMARY);
        const thankYouText = "Thank you for choosing New Yasuki Auto Motors!";
        doc.text(thankYouText, margin, finalFooterY + 6, { 
            width: contentWidth,
            align: "center" 
        });

        // Footer lines (business info, compact)
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text("We have the best-equipped automobile accident repair center in Kurunegala Srilanka", margin, finalFooterY + 18, { width: contentWidth, align: "center" });
        doc.text("Authorized dealer for TOYOTA/NISSAN/SUZUKI/KIA/MICRO/MAHINDRA/CHERRY", margin, finalFooterY + 28, { width: contentWidth, align: "center" });
        doc.text("E-mail : yasukiauto@gmail.com", margin, finalFooterY + 38, { width: contentWidth, align: "center" });

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
            await runAsync("DELETE FROM InventoryUsage WHERE invoice_id = ?", [id]);
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
        await runAsync("DELETE FROM InventoryUsage WHERE invoice_id = ?", [id]);
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