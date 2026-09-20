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

const calculateTotals = (items = [], charges = [], reductions = [], extras = []) => {
    const itemsTotal = roundCurrency(items.reduce((sum, item) => sum + (item.line_total || 0), 0));
    const totalLabour = roundCurrency(charges.reduce((sum, entry) => sum + (entry.amount || 0), 0));
    const totalExtras = roundCurrency(extras.reduce((sum, entry) => sum + (entry.amount || 0), 0));
    const totalCharges = roundCurrency(totalLabour + totalExtras);
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

    const extrasRow = await getAsync(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM InvoiceExtraItems
        WHERE invoice_id = ? AND type = 'extra'
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
    const totalCharges = roundCurrency(Number(chargesRow.total ?? 0) + Number(extrasRow.total ?? 0));
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
               Vehicles.license_plate AS vehicle_license_plate,
               Vehicles.make AS vehicle_make,
               Vehicles.model AS vehicle_model,
               Vehicles.year AS vehicle_year,
               Customers.id AS customer_id, Customers.name AS customer_name, Customers.email AS customer_email,
               Customers.phone AS customer_phone, Customers.address AS customer_address
        FROM Invoices
        LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
        LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
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

    const extraRows = await allAsync(
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
        charges: extraRows.filter((entry) => entry.type === "charge"),
        extras: extraRows.filter((entry) => entry.type === "extra"),
        reductions: extraRows.filter((entry) => entry.type === "deduction"),
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

        // Data – Workshop Charges (labour) + one parts table with genuine / non-genuine column
        const items = invoice.items ?? [];
        const charges = invoice.charges ?? [];
        const extras = invoice.extras ?? [];
        const reductions = invoice.reductions ?? [];
        // Normalize genuine flag (handle casing/whitespace; null/undefined = non-genuine)
        const isGenuine = (i) => String(i.genuine_or_non_genuine || "").toLowerCase().trim() === "genuine";
        const genuineLabel = (i) => (isGenuine(i) ? "Genuine" : "Non Genuine");
        const genuineItems = items.filter(isGenuine);
        const nonGenuineItems = items.filter((i) => !isGenuine(i));
        const labourTotal = charges.reduce((s, c) => s + Number(c.amount ?? 0), 0);
        const extraTotal = extras.reduce((s, e) => s + Number(e.amount ?? 0), 0);
        const genuineTotal = genuineItems.reduce((s, i) => s + Number(i.line_total ?? 0), 0);
        const nonGenuineTotal = nonGenuineItems.reduce((s, i) => s + Number(i.line_total ?? 0), 0);
        const partsTotal = genuineTotal + nonGenuineTotal;
        const subtotal = labourTotal + partsTotal + extraTotal;
        const totalReductions = reductions.reduce((s, r) => s + Number(r.amount ?? 0), 0);
        const totalDue = invoice.final_total ?? subtotal - totalReductions;
        const status = (invoice.payment_status ?? "unpaid").charAt(0).toUpperCase() + (invoice.payment_status ?? "unpaid").slice(1);

        const invoiceNo = invoice.invoice_no ?? `INV-${String(invoice.id).padStart(5, "0")}`;
        const plate = String(invoice.vehicle_license_plate ?? "").trim() || "—";
        const hasMileage = invoice.mileage !== null && invoice.mileage !== undefined && invoice.mileage !== "";
        const mileageText = hasMileage
            ? `${Number(invoice.mileage).toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                  minimumFractionDigits: Number(invoice.mileage) % 1 === 0 ? 0 : 2,
              })} km`
            : "—";
        const vehicleBits = [invoice.vehicle_make, invoice.vehicle_model, invoice.vehicle_year]
            .map((part) => String(part ?? "").trim())
            .filter(Boolean);
        const vehicleDescription = vehicleBits.length ? vehicleBits.join(" ") : "—";
        const paymentMethod = String(invoice.payment_method ?? "").trim() || "Not specified";
        const jobSummary = String(invoice.job_description ?? "").trim() || "—";
        const estimateAmount =
            invoice.initial_amount !== null && invoice.initial_amount !== undefined
                ? formatCurrency(invoice.initial_amount)
                : "—";
        const advanceReduction = reductions.find((entry) => String(entry.label ?? "").toLowerCase() === "advance");

        const cleanItemName = (itemName) => {
            if (!itemName || typeof itemName !== "string") return itemName;
            return itemName
                .replace(/\s*\(\d+(?:\.\d+)?\s*×\s*\)/gi, "")
                .replace(/\s*\(\d+(?:\.\d+)?\s*x\s*\)/gi, "")
                .trim();
        };

        const HEADER_BG = "#F3F4F6";
        const rowH = 18;
        const footerSpace = 46;
        let y = margin;

        const logoPath = path.join(__dirname, "../assets/logo.jpg");
        const brandLogosPath = path.join(__dirname, "../assets/Brand logos.png");

        const drawWatermark = () => {
            if (!fs.existsSync(logoPath)) return;
            doc.save();
            doc.opacity(0.08);
            doc.image(logoPath, (pageWidth - 360) / 2, (doc.page.height - 200) / 2, { width: 360 });
            doc.restore();
            doc.opacity(1);
        };

        const ensureSpace = (needed) => {
            const limit = doc.page.height - margin - footerSpace - 8;
            if (y + needed <= limit) return;
            doc.addPage();
            drawWatermark();
            y = margin;
        };

        const drawSectionTitle = (title) => {
            ensureSpace(36);
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text(title, margin, y);
            y += 16;
        };

        const drawHeaderRow = (columns) => {
            doc.rect(margin, y, contentWidth, rowH).fill(HEADER_BG);
            doc.fillColor(DARK).font("Helvetica-Bold").fontSize(7.5);
            columns.forEach((col) => {
                doc.text(col.label, col.x, y + 5, { width: col.w, align: col.align || "left" });
            });
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.6).stroke();
            y += rowH;
        };

        const drawDataRow = (columns, { bold = false, fill = null } = {}) => {
            if (fill) {
                doc.rect(margin, y, contentWidth, rowH).fill(fill);
            }
            doc.rect(margin, y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.4).stroke();
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(DARK);
            columns.forEach((col) => {
                doc.text(String(col.text ?? ""), col.x, y + 5, { width: col.w, align: col.align || "left" });
            });
            y += rowH;
        };

        const drawMetaPair = (label, value, x, startY, width) => {
            doc.font("Helvetica").fontSize(7).fillColor(GRAY);
            doc.text(label, x, startY, { width });
            doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
            doc.text(value, x, startY + 10, { width });
            return startY + 24;
        };

        drawWatermark();

        // Header banner: logo + red company name + contact + brand logos + red rule
        const logoSize = 52;
        if (fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, margin, y, { width: logoSize, height: logoSize });
            } catch (err) {
                console.error("Error loading company logo:", err.message);
            }
        }

        const brandX = margin + logoSize + 12;
        const brandW = contentWidth - logoSize - 12;
        doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", brandX, y + 6, { width: brandW });
        doc.font("Helvetica").fontSize(8).fillColor(PRIMARY);
        doc.text(
            "Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com",
            brandX,
            y + 28,
            { width: brandW }
        );

        y += logoSize + 8;

        if (fs.existsSync(brandLogosPath)) {
            try {
                doc.image(brandLogosPath, margin, y, { width: contentWidth, height: 32 });
                y += 40;
            } catch (err) {
                console.error("Error loading brand logos image:", err.message);
                y += 8;
            }
        }

        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(2).stroke();
        y += 14;

        doc.font("Helvetica-Bold").fontSize(18).fillColor(DARK);
        doc.text("INVOICE", margin, y);
        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        doc.text(`Invoice #: ${invoiceNo}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Date: ${formatDate(invoice.invoice_date)}`, pageWidth - margin - 180, y + 11, { width: 180, align: "right" });
        doc.text(`Status: ${status}  •  ${paymentMethod}`, pageWidth - margin - 180, y + 22, { width: 180, align: "right" });
        doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
        doc.text(formatCurrency(totalDue), pageWidth - margin - 180, y + 34, { width: 180, align: "right" });
        y += 52;

        // Two-column details
        const colW = (contentWidth - 20) / 2;
        const rightX = margin + colW + 20;
        let leftY = y;
        let rightY = y;

        leftY = drawMetaPair("Invoice number", invoiceNo, margin, leftY, colW);
        leftY = drawMetaPair(
            "Issued on",
            `${formatDate(invoice.invoice_date)}${invoice.job_id ? `  •  Job #${invoice.job_id}` : ""}`,
            margin,
            leftY,
            colW
        );
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text("Bill to", margin, leftY);
        leftY += 10;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
        doc.text(invoice.customer_name ?? "Walk-in Customer", margin, leftY, { width: colW });
        leftY += 12;
        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        if (invoice.customer_email) {
            doc.text(invoice.customer_email, margin, leftY, { width: colW });
            leftY += 11;
        }
        if (invoice.customer_phone) {
            doc.text(invoice.customer_phone, margin, leftY, { width: colW });
            leftY += 11;
        }
        if (invoice.customer_address) {
            const addressHeight = doc.heightOfString(invoice.customer_address, { width: colW });
            doc.text(invoice.customer_address, margin, leftY, { width: colW });
            leftY += addressHeight + 4;
        }

        rightY = drawMetaPair("Vehicle No", plate, rightX, rightY, colW);
        rightY = drawMetaPair("Mileage", mileageText, rightX, rightY, colW);
        rightY = drawMetaPair("Vehicle", vehicleDescription, rightX, rightY, colW);
        rightY = drawMetaPair("Job summary", jobSummary, rightX, rightY, colW);
        rightY = drawMetaPair("Initial estimate", estimateAmount, rightX, rightY, colW);
        if (advanceReduction) {
            rightY = drawMetaPair("Advance received", formatCurrency(advanceReduction.amount), rightX, rightY, colW);
        }

        y = Math.max(leftY, rightY) + 10;

        // ─── WORKSHOP CHARGES ───
        const cColNo = 36;
        const cColAmt = 90;
        const cColDesc = contentWidth - cColNo - cColAmt;
        drawSectionTitle("WORKSHOP CHARGES");
        drawHeaderRow([
            { label: "NO", x: margin + 6, w: cColNo - 6 },
            { label: "DESCRIPTION", x: margin + cColNo + 6, w: cColDesc - 12 },
            { label: "AMOUNT (LKR)", x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
        ]);
        if (charges.length === 0) {
            ensureSpace(rowH);
            drawDataRow([
                { text: "—", x: margin + 6, w: cColNo - 6 },
                { text: "No workshop charges", x: margin + cColNo + 6, w: cColDesc - 12 },
                { text: formatAmount(0), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
            ]);
        } else {
            charges.forEach((entry, index) => {
                ensureSpace(rowH);
                drawDataRow([
                    { text: String(index + 1), x: margin + 6, w: cColNo - 6 },
                    { text: cleanItemName(entry.label ?? "Charge"), x: margin + cColNo + 6, w: cColDesc - 12 },
                    { text: formatAmount(entry.amount ?? 0), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
                ]);
            });
        }
        ensureSpace(rowH);
        drawDataRow(
            [
                { text: "", x: margin + 6, w: cColNo - 6 },
                { text: "Labour Total", x: margin + cColNo + 6, w: cColDesc - 12 },
                { text: formatAmount(labourTotal), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
            ],
            { bold: true, fill: LIGHT }
        );
        y += 12;

        // ─── WORKSHOP PARTS & MATERIALS ───
        const pColNo = 32;
        const pColType = 72;
        const pColQty = 54;
        const pColTotal = 78;
        const pColDesc = contentWidth - pColNo - pColType - pColQty - pColTotal;
        const pTypeX = margin + pColNo + pColDesc;
        const pQtyX = pTypeX + pColType;
        const pTotalX = pQtyX + pColQty;
        drawSectionTitle("WORKSHOP PARTS & MATERIALS");
        drawHeaderRow([
            { label: "NO", x: margin + 6, w: pColNo - 6 },
            { label: "DESCRIPTION", x: margin + pColNo + 6, w: pColDesc - 12 },
            { label: "TYPE", x: pTypeX, w: pColType, align: "center" },
            { label: "QTY", x: pQtyX, w: pColQty, align: "right" },
            { label: "TOTAL (LKR)", x: pTotalX, w: pColTotal - 6, align: "right" },
        ]);
        if (items.length === 0) {
            ensureSpace(rowH);
            drawDataRow([
                { text: "—", x: margin + 6, w: pColNo - 6 },
                { text: "No parts used", x: margin + pColNo + 6, w: pColDesc - 12 },
                { text: "—", x: pTypeX, w: pColType, align: "center" },
                { text: "—", x: pQtyX, w: pColQty, align: "right" },
                { text: formatAmount(0), x: pTotalX, w: pColTotal - 6, align: "right" },
            ]);
        } else {
            items.forEach((item, index) => {
                ensureSpace(rowH);
                const qty = Number(item.quantity);
                const qtyVal = !isNaN(qty) && qty > 0 ? qty : 1;
                const desc = (item.item_name != null ? item.item_name : item.Item_name) ?? "Item";
                drawDataRow([
                    { text: String(index + 1), x: margin + 6, w: pColNo - 6 },
                    { text: cleanItemName(desc), x: margin + pColNo + 6, w: pColDesc - 12 },
                    { text: genuineLabel(item), x: pTypeX, w: pColType, align: "center" },
                    { text: formatQuantity(qtyVal), x: pQtyX, w: pColQty, align: "right" },
                    { text: formatAmount(item.line_total ?? 0), x: pTotalX, w: pColTotal - 6, align: "right" },
                ]);
            });
        }
        const partsTotalCols = (label, amount, bold = false) =>
            drawDataRow(
                [
                    { text: "", x: margin + 6, w: pColNo - 6 },
                    { text: label, x: margin + pColNo + 6, w: pColDesc + pColType + pColQty - 12, align: "right" },
                    { text: formatAmount(amount), x: pTotalX, w: pColTotal - 6, align: "right" },
                ],
                { bold, fill: LIGHT }
            );
        ensureSpace(rowH * 3);
        partsTotalCols("Genuine Spare Parts Total", genuineTotal);
        partsTotalCols("Non Genuine Spare Parts Total", nonGenuineTotal);
        partsTotalCols("WORKSHOP PARTS & MATERIALS", partsTotal, true);
        y += 12;

        // ─── EXTRA ───
        drawSectionTitle("EXTRA");
        drawHeaderRow([
            { label: "NO", x: margin + 6, w: cColNo - 6 },
            { label: "DESCRIPTION", x: margin + cColNo + 6, w: cColDesc - 12 },
            { label: "AMOUNT (LKR)", x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
        ]);
        if (extras.length === 0) {
            ensureSpace(rowH);
            drawDataRow([
                { text: "—", x: margin + 6, w: cColNo - 6 },
                { text: "No extras", x: margin + cColNo + 6, w: cColDesc - 12 },
                { text: formatAmount(0), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
            ]);
        } else {
            extras.forEach((entry, index) => {
                ensureSpace(rowH);
                drawDataRow([
                    { text: String(index + 1), x: margin + 6, w: cColNo - 6 },
                    { text: cleanItemName(entry.label ?? "Extra"), x: margin + cColNo + 6, w: cColDesc - 12 },
                    { text: formatAmount(entry.amount ?? 0), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
                ]);
            });
        }
        ensureSpace(rowH);
        drawDataRow(
            [
                { text: "", x: margin + 6, w: cColNo - 6 },
                { text: "Extra Total", x: margin + cColNo + 6, w: cColDesc - 12 },
                { text: formatAmount(extraTotal), x: margin + cColNo + cColDesc, w: cColAmt - 6, align: "right" },
            ],
            { bold: true, fill: LIGHT }
        );
        y += 16;

        // Summary cards
        const cardGap = 16;
        const cardW = (contentWidth - cardGap) / 2;
        const reductionLines = Math.max(reductions.length, 1) + 2;
        const cardH = Math.max(72, 28 + reductionLines * 14);
        ensureSpace(cardH + 20);

        const drawCard = (x, title, lines, emphasizeLast = false) => {
            doc.roundedRect(x, y, cardW, cardH, 4).strokeColor(BORDER).lineWidth(0.8).stroke();
            doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
            doc.text(title, x + 10, y + 8, { width: cardW - 20 });
            let lineY = y + 26;
            lines.forEach((line, index) => {
                const isLast = index === lines.length - 1;
                doc.font(isLast && emphasizeLast ? "Helvetica-Bold" : "Helvetica").fontSize(8);
                doc.fillColor(isLast && emphasizeLast ? PRIMARY : GRAY);
                doc.text(line.label, x + 10, lineY, { width: cardW - 90 });
                doc.fillColor(isLast && emphasizeLast ? PRIMARY : DARK);
                doc.text(line.value, x + cardW - 86, lineY, { width: 76, align: "right" });
                lineY += 14;
            });
        };

        drawCard(
            margin,
            "Services total",
            [
                { label: "Workshop charges", value: formatCurrency(labourTotal) },
                { label: "Parts & materials", value: formatCurrency(partsTotal) },
                { label: "Extras", value: formatCurrency(extraTotal) },
                { label: "Reductions & credits", value: formatCurrency(totalReductions) },
                { label: "Balance due", value: formatCurrency(totalDue) },
            ],
            true
        );
        drawCard(margin + cardW + cardGap, "Reductions", [
            ...reductions.map((entry) => ({
                label: entry.label ?? "Reduction",
                value: formatCurrency(entry.amount ?? 0),
            })),
            ...(reductions.length === 0 ? [{ label: "No reductions", value: formatCurrency(0) }] : []),
            { label: "Total reductions", value: formatCurrency(totalReductions) },
        ]);
        y += cardH + 18;

        // Notes + signatures
        ensureSpace(70);
        const noteW = contentWidth * 0.42;
        const sigW = (contentWidth - noteW) / 2;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Additional notes", margin, y);
        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        doc.text(invoice.notes || "Thank you for choosing New Yasuki Auto Motors.", margin, y + 12, {
            width: noteW - 12,
        });

        const sigY = y + 28;
        doc.moveTo(margin + noteW, sigY).lineTo(margin + noteW + sigW - 16, sigY).strokeColor(BORDER).lineWidth(0.7).stroke();
        doc.moveTo(margin + noteW + sigW, sigY).lineTo(pageWidth - margin, sigY).strokeColor(BORDER).lineWidth(0.7).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text("Customer Signature", margin + noteW, sigY + 6, { width: sigW - 16, align: "center" });
        doc.text("Authorized Signature", margin + noteW + sigW, sigY + 6, { width: sigW, align: "center" });
        y += 58;

        // Footer
        const finalFooterY = doc.page.height - margin - footerSpace;
        doc.moveTo(margin, finalFooterY).lineTo(pageWidth - margin, finalFooterY).strokeColor("#374151").lineWidth(1.5).stroke();
        doc.font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY);
        doc.text("Thank you for choosing New Yasuki Auto Motors!", margin, finalFooterY + 6, {
            width: contentWidth,
            align: "center",
        });
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text("We have the best-equipped automobile accident repair center in Kurunegala, Sri Lanka", margin, finalFooterY + 18, {
            width: contentWidth,
            align: "center",
        });
        doc.text("Authorized dealer for TOYOTA / NISSAN / SUZUKI / KIA / MICRO / MAHINDRA / CHERRY", margin, finalFooterY + 28, {
            width: contentWidth,
            align: "center",
        });

        doc.end();
    });

// Create invoice
router.post("/", async (req, res) => {
    const {
        job_id,
        items = [],
        charges,
        extras,
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
        const preparedExtras = prepareExtraItems(Array.isArray(extras) ? extras : [], "extra");
        const preparedReductions = prepareExtraItems(rawReductions, "deduction");

        const totals = calculateTotals(preparedItems, preparedCharges, preparedReductions, preparedExtras);
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
        await insertInvoiceExtraItems(invoiceId, [...preparedCharges, ...preparedExtras, ...preparedReductions]);

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
            SELECT Invoices.*, Customers.name AS customer_name,
                   Jobs.mileage,
                   Vehicles.license_plate AS vehicle_license_plate,
                   Vehicles.make AS vehicle_make,
                   Vehicles.model AS vehicle_model,
                   Vehicles.year AS vehicle_year
            FROM Invoices
            LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
            LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
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
    const { items, charges, extras, reductions, payment_method, payment_status, notes } = req.body;

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

        if (extras !== undefined) {
            await runAsync("DELETE FROM InvoiceExtraItems WHERE invoice_id = ? AND type = 'extra'", [id]);
            const preparedExtras = prepareExtraItems(Array.isArray(extras) ? extras : [], "extra");
            await insertInvoiceExtraItems(id, preparedExtras);
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