const express = require("express");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
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
               Jobs.initial_amount, Jobs.advance_amount,
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
        const doc = new PDFDocument({ margin: 40 });
        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const formatCurrency = (value) =>
            `LKR ${Number(value ?? 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;

        const formatDate = (value) => {
            if (!value) return "—";
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
        };

        const capitalize = (value) =>
            typeof value === "string" && value.length
                ? value.charAt(0).toUpperCase() + value.slice(1)
                : value ?? "";

        const items = invoice.items ?? [];
        const charges = invoice.charges ?? [];
        const reductions = invoice.reductions ?? [];

        const servicesTotal = items.reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
        const chargesTotal = charges.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
        const reductionsTotal = reductions.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
        const balanceDue =
            invoice.final_total ?? servicesTotal + chargesTotal - reductionsTotal;

        const pageWidth =
            doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const cardGap = 20;
        const columnWidth = (pageWidth - cardGap) / 2;

        const CARD_BG = "#f9fafb";
        const CARD_BORDER = "#e5e7eb";
        const TEXT_PRIMARY = "#111827";
        const TEXT_MUTED = "#6b7280";

        const setFont = ({ bold = false, size = 10, color = TEXT_PRIMARY } = {}) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica");
            doc.fontSize(size);
            doc.fillColor(color);
        };

        const drawRoundedCard = (x, y, width, height) => {
            doc.save();
            doc.lineWidth(1);
            doc.strokeColor(CARD_BORDER);
            doc.fillColor(CARD_BG);
            doc.roundedRect(x, y, width, height, 8).fillAndStroke(CARD_BG, CARD_BORDER);
            doc.restore();
        };

        const drawHorizontalRule = (x1, y, x2, color = CARD_BORDER) => {
            doc.save();
            doc.strokeColor(color);
            doc.moveTo(x1, y).lineTo(x2, y).stroke();
            doc.restore();
        };

        const renderBlock = (block, x, width, startY) => {
            let currentY = startY;
            if (block.label) {
                setFont({ size: 9, color: TEXT_MUTED });
                doc.y = currentY;
                doc.text(block.label, x, currentY, { width });
                currentY = doc.y + 4;
            }

            (block.lines ?? []).forEach((line) => {
                setFont({
                    size: line.size ?? 11,
                    bold: line.bold ?? false,
                    color: line.color ?? TEXT_PRIMARY,
                });
                doc.y = currentY;
                doc.text(line.text, x, currentY, { width });
                currentY = doc.y + (line.gap ?? 6);
            });

            return currentY;
        };

        const writeTwoColumnGroup = (left, right, options = {}) => {
            const startY = doc.y;
            const leftBottom = renderBlock(
                left,
                doc.page.margins.left,
                columnWidth,
                startY
            );
            const rightBottom = renderBlock(
                right,
                doc.page.margins.left + columnWidth + cardGap,
                columnWidth,
                startY
            );

            doc.y = Math.max(leftBottom, rightBottom) + (options.gap ?? 18);
            doc.x = doc.page.margins.left;
        };

        const drawTableSection = ({
            title,
            headers,
            rows,
            columnWidths,
            alignments = [],
            emptyMessage,
        }) => {
            setFont({ size: 12, bold: true });
            doc.text(title, doc.page.margins.left, doc.y);
            doc.moveDown(0.5);

            if (!rows.length) {
                setFont({ size: 10, color: TEXT_MUTED });
                doc.text(
                    emptyMessage ?? "No records available.",
                    doc.page.margins.left,
                    doc.y
                );
                doc.moveDown();
                return;
            }

            const startX = doc.page.margins.left;
            const columnPositions = [];
            let offset = startX;
            columnWidths.forEach((width) => {
                columnPositions.push(offset);
                offset += width;
            });
            const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);

            setFont({ size: 9, color: TEXT_MUTED, bold: true });
            const headerY = doc.y;
            let headerBottom = headerY;
            headers.forEach((header, idx) => {
                doc.y = headerY;
                doc.text(header, columnPositions[idx], headerY, {
                    width: columnWidths[idx],
                    align: alignments[idx] ?? "left",
                });
                headerBottom = Math.max(headerBottom, doc.y);
            });
            let currentY = headerBottom + 4;
            drawHorizontalRule(startX, currentY - 2, startX + tableWidth);

            setFont({ size: 10, color: TEXT_PRIMARY });
            rows.forEach((row) => {
                let rowHeight = 0;
                row.forEach((cell, idx) => {
                    doc.y = currentY;
                    const before = doc.y;
                    doc.text(cell, columnPositions[idx], currentY, {
                        width: columnWidths[idx],
                        align: alignments[idx] ?? "left",
                    });
                    rowHeight = Math.max(rowHeight, doc.y - before);
                });
                currentY += (rowHeight || 12) + 4;
            });

            drawHorizontalRule(startX, currentY - 4, startX + tableWidth);
            doc.y = currentY + 8;
        };

        const measureTableCardHeight = (rows) => {
            const padding = 16;
            const headerHeight = 18;
            const rowHeight = 18;
            const subLabelExtra = 12;
            const footerHeight = 22;

            const contentRows = rows.length ? rows : [{ placeholder: true }];
            const rowsHeight = contentRows.reduce(
                (sum, row) => sum + rowHeight + (row.subLabel ? subLabelExtra : 0),
                0
            );

            return padding * 2 + headerHeight + rowsHeight + footerHeight;
        };

        const drawTableCard = ({
            x,
            y,
            width,
            title,
            rows,
            footerLabel,
            footerValue,
            emptyMessage,
        }) => {
            const padding = 16;
            const amountColumnWidth = 90;
            const labelWidth = width - padding * 2 - amountColumnWidth;

            const rowsForCard = rows.length
                ? rows
                : [{ placeholder: true, label: emptyMessage ?? "No records.", amount: "" }];
            const cardHeight = measureTableCardHeight(rowsForCard);

            drawRoundedCard(x, y, width, cardHeight);

            let currentY = y + padding;

            setFont({ size: 12, bold: true });
            doc.y = currentY;
            doc.text(title, x + padding, currentY, { width: width - padding * 2 });
            currentY = doc.y + 6;

            setFont({ size: 9, color: TEXT_MUTED, bold: true });
            doc.y = currentY;
            doc.text("Category", x + padding, currentY, { width: labelWidth });
            doc.y = currentY;
            doc.text("Amount", x + width - padding - amountColumnWidth, currentY, {
                width: amountColumnWidth,
                align: "right",
            });
            currentY = Math.max(doc.y, currentY) + 4;
            drawHorizontalRule(x + padding, currentY, x + width - padding);
            currentY += 4;

            rowsForCard.forEach((row) => {
                const rowStart = currentY;
                setFont({ size: 10, color: row.placeholder ? TEXT_MUTED : TEXT_PRIMARY });
                doc.y = rowStart;
                doc.text(row.label ?? "", x + padding, rowStart, { width: labelWidth });
                const labelBottom = doc.y;

                setFont({ size: 10, color: TEXT_PRIMARY });
                doc.y = rowStart;
                doc.text(row.amount ?? "", x + width - padding - amountColumnWidth, rowStart, {
                    width: amountColumnWidth,
                    align: "right",
                });
                const amountBottom = doc.y;

                currentY = Math.max(labelBottom, amountBottom);

                if (row.subLabel) {
                    setFont({ size: 8, color: TEXT_MUTED });
                    doc.y = currentY;
                    doc.text(row.subLabel, x + padding, currentY, { width: labelWidth });
                    currentY = doc.y;
                }

                currentY += 6;
            });

            drawHorizontalRule(x + padding, currentY - 2, x + width - padding);
            setFont({ size: 10, color: TEXT_MUTED });
            doc.y = currentY + 4;
            doc.text(footerLabel, x + padding, doc.y, { width: labelWidth });
            setFont({ size: 11, bold: true });
            doc.y = currentY + 4;
            doc.text(footerValue, x + width - padding - amountColumnWidth, doc.y, {
                width: amountColumnWidth,
                align: "right",
            });

            return y + cardHeight;
        };

        const drawSummaryCard = ({ x, y, width, rows }) => {
            const padding = 16;
            const rowHeight = 18;
            const cardHeight = padding * 2 + rows.length * rowHeight + 6;

            drawRoundedCard(x, y, width, cardHeight);

            let currentY = y + padding;
            const valueWidth = 140;
            const labelWidth = width - padding * 2 - valueWidth;

            rows.forEach((row) => {
                setFont({ size: 10, color: TEXT_MUTED });
                doc.y = currentY;
                doc.text(row.label, x + padding, currentY, { width: labelWidth });
                setFont({
                    size: row.size ?? 11,
                    bold: row.bold ?? false,
                    color: row.color ?? TEXT_PRIMARY,
                });
                doc.y = currentY;
                doc.text(row.value, x + width - padding - valueWidth, currentY, {
                    width: valueWidth,
                    align: "right",
                });
                currentY = doc.y + 4;
            });

            return y + cardHeight;
        };

        setFont({ bold: true, size: 22 });
        doc.text("Garage Invoice", { align: "center" });
        doc.moveDown(1.2);

        writeTwoColumnGroup(
            {
                label: "Invoice number",
                lines: [
                    {
                        text: invoice.invoice_no ? `${invoice.invoice_no}` : `Invoice #${invoice.id}`,
                        bold: true,
                        size: 14,
                    },
                    {
                        text: `Issued on ${formatDate(invoice.invoice_date)}${
                            invoice.job_id ? ` • Job #${invoice.job_id}` : ""
                        }`,
                        size: 10,
                        color: TEXT_MUTED,
                    },
                ],
            },
            {
                label: "Amount due",
                lines: [
                    {
                        text: formatCurrency(balanceDue),
                        bold: true,
                        size: 18,
                    },
                    {
                        text: `Status: ${capitalize(invoice.payment_status ?? "unpaid")}`,
                        size: 10,
                        color: TEXT_MUTED,
                    },
                    {
                        text: `Payment method: ${invoice.payment_method ?? "Not specified"}`,
                        size: 10,
                        color: TEXT_MUTED,
                    },
                ],
            },
            { gap: 20 }
        );

        writeTwoColumnGroup(
            {
                label: "Bill to",
                lines: [
                    {
                        text: invoice.customer_name ?? "Walk-in customer",
                        size: 12,
                        bold: true,
                    },
                    ...(invoice.customer_email
                        ? [
                              {
                                  text: invoice.customer_email,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    ...(invoice.customer_phone
                        ? [
                              {
                                  text: invoice.customer_phone,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    ...(invoice.customer_address
                        ? [
                              {
                                  text: invoice.customer_address,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    {
                        text: "Please review the summary below. Contact us if you have any questions about this invoice.",
                        size: 9,
                        color: TEXT_MUTED,
                    },
                ],
            },
            {
                label: "Job summary",
                lines: [
                    ...(invoice.job_description
                        ? [
                              {
                                  text: invoice.job_description,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    ...(invoice.initial_amount !== undefined && invoice.initial_amount !== null
                        ? [
                              {
                                  text: `Initial estimate: ${formatCurrency(invoice.initial_amount)}`,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    ...(invoice.advance_amount !== undefined && invoice.advance_amount !== null
                        ? [
                              {
                                  text: `Advance received: ${formatCurrency(invoice.advance_amount)}`,
                                  size: 10,
                                  color: TEXT_MUTED,
                              },
                          ]
                        : []),
                    {
                        text: `Items: ${items.length} • Charges: ${charges.length} • Reductions: ${reductions.length}`,
                        size: 9,
                        color: TEXT_MUTED,
                    },
                ],
            },
            { gap: 26 }
        );

        if (items.length) {
            const serviceRows = items.map((item) => [
                item.item_name ?? "Item",
                String(item.quantity ?? 0),
                formatCurrency(item.unit_price ?? 0),
                formatCurrency(item.line_total ?? 0),
            ]);
            drawTableSection({
                title: "Services provided",
                headers: ["Description", "Qty", "Unit price", "Amount"],
                rows: serviceRows,
                columnWidths: [260, 60, 100, 100],
                alignments: ["left", "right", "right", "right"],
                emptyMessage: "No services recorded.",
            });
        }

        const cardStartY = doc.y;
        const leftCardX = doc.page.margins.left;
        const rightCardX = leftCardX + columnWidth + cardGap;

        const chargesRows = charges.map((entry) => ({
            label: entry.label ?? "Charge",
            amount: formatCurrency(entry.amount ?? 0),
        }));

        const reductionsRows = reductions.map((entry) => {
            const lowerLabel = (entry.label ?? "").trim().toLowerCase();
            const isAdvance = lowerLabel === "advance";
            return {
                label: entry.label ?? "Reduction",
                amount: formatCurrency(entry.amount ?? 0),
                subLabel: isAdvance ? "(Advance)" : undefined,
            };
        });

        const leftCardBottom = drawTableCard({
            x: leftCardX,
            y: cardStartY,
            width: columnWidth,
            title: "Charges",
            rows: chargesRows,
            footerLabel: "Total charges",
            footerValue: formatCurrency(chargesTotal),
            emptyMessage: "No additional charges recorded.",
        });

        const rightCardBottom = drawTableCard({
            x: rightCardX,
            y: cardStartY,
            width: columnWidth,
            title: "Reductions",
            rows: reductionsRows,
            footerLabel: "Total reductions",
            footerValue: formatCurrency(reductionsTotal),
            emptyMessage: "No reductions recorded.",
        });

        doc.y = Math.max(leftCardBottom, rightCardBottom) + 24;

        const summaryBottom = drawSummaryCard({
            x: doc.page.margins.left,
            y: doc.y,
            width: pageWidth,
            rows: [
                { label: "Services total", value: formatCurrency(servicesTotal) },
                { label: "Charges", value: formatCurrency(chargesTotal) },
                {
                    label: "Reductions & credits",
                    value: `-${formatCurrency(reductionsTotal)}`,
                },
                {
                    label: "Balance due",
                    value: formatCurrency(balanceDue),
                    bold: true,
                    size: 13,
                },
            ],
        });
        doc.y = summaryBottom + 24;

        if (invoice.notes) {
            setFont({ size: 12, bold: true });
            doc.text("Additional notes", doc.page.margins.left, doc.y, { align: "left" });
            doc.moveDown(0.3);
            setFont({ size: 10, color: TEXT_MUTED });
            doc.text(invoice.notes, doc.page.margins.left, doc.y, {
                width: pageWidth,
                align: "left",
            });
            doc.moveDown(1);
        }

        setFont({ size: 9, color: TEXT_MUTED });
        doc.text(
            "Thank you for choosing our garage.",
            doc.page.margins.left,
            doc.y,
            { width: pageWidth, align: "center" }
        );
        doc.moveDown(0.6);
        doc.text(
            "Please settle the balance by the agreed payment terms. If you have already paid, kindly ignore this reminder.",
            doc.page.margins.left,
            doc.y,
            { width: pageWidth, align: "center" }
        );

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