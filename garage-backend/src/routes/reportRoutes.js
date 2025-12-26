const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const db = require("../../database/db");

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

const pad2 = (value) => String(value).padStart(2, "0");

const normalizeDateString = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const deriveDateRange = (query = {}) => {
    const today = new Date();
    const timeframe = (query.timeframe || "monthly").toLowerCase();

    if (timeframe === "daily") {
        const date = normalizeDateString(query.date) || today.toISOString().slice(0, 10);
        return {
            startDate: date,
            endDate: date,
            label: `Daily • ${date}`,
        };
    }

    if (timeframe === "yearly") {
        const year = Number(query.year) || today.getFullYear();
        return {
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            label: `Year ${year}`,
        };
    }

    if (timeframe === "custom") {
        const start = normalizeDateString(query.startDate || query.from);
        const end = normalizeDateString(query.endDate || query.to);
        const fallbackEnd = today.toISOString().slice(0, 10);
        const fallbackStart = new Date(today);
        fallbackStart.setDate(fallbackStart.getDate() - 29);

        return {
            startDate: start || fallbackStart.toISOString().slice(0, 10),
            endDate: end || fallbackEnd,
            label: `Custom ${start || "N/A"} → ${end || "N/A"}`,
        };
    }

    // Default: monthly
    const month = Number(query.month) || today.getMonth() + 1;
    const year = Number(query.year) || today.getFullYear();
    const startDate = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;

    return {
        startDate,
        endDate,
        label: `Month ${pad2(month)}/${year}`,
    };
};

const PDF_BRAND = process.env.PDF_BRAND || "Garage ERP";

const pdfFormatDate = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
};

const pdfFormatCurrency = (value) =>
    `LKR ${Number(value || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;

const pdfTruncate = (value, maxChars) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (!maxChars || text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

// ────────────────────────────────────────────────────────────────
// Timezone helpers for Excel
// SQLite CURRENT_TIMESTAMP is UTC. Many deployments run in UTC even on local PCs,
// so we convert UTC timestamps to the business local time for display in exports.
// Default offset is Sri Lanka (UTC+05:30).
// ────────────────────────────────────────────────────────────────
// Sri Lanka time is UTC+05:30 => +330 minutes
const EXCEL_TZ_OFFSET_MINUTES = Number(process.env.EXCEL_TZ_OFFSET_MINUTES ?? 330);

const parseSqliteDateTimeUtcMs = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();

    const text = String(value).trim();
    // ISO or any string Date.parse understands
    if (text.includes("T") || text.endsWith("Z") || text.includes("+")) {
        const ms = Date.parse(text);
        return Number.isNaN(ms) ? null : ms;
    }

    // "YYYY-MM-DD"
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/;
    const m1 = text.match(dateOnly);
    if (m1) {
        const y = Number(m1[1]);
        const mo = Number(m1[2]);
        const d = Number(m1[3]);
        return Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
    }

    // "YYYY-MM-DD HH:MM:SS" (optionally ".sss")
    const dateTime = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
    const m2 = text.match(dateTime);
    if (m2) {
        const y = Number(m2[1]);
        const mo = Number(m2[2]);
        const d = Number(m2[3]);
        const hh = Number(m2[4]);
        const mm = Number(m2[5]);
        const ss = Number(m2[6] ?? 0);
        const ms = Number(String(m2[7] ?? "0").padEnd(3, "0"));
        return Date.UTC(y, mo - 1, d, hh, mm, ss, ms);
    }

    const fallback = Date.parse(text);
    return Number.isNaN(fallback) ? null : fallback;
};

const asExcelLocalDate = (value, offsetMinutes = EXCEL_TZ_OFFSET_MINUTES) => {
    const utcMs = parseSqliteDateTimeUtcMs(value);
    if (utcMs === null) return null;
    // Shift for display (Excel dates are timezone-less)
    return new Date(utcMs + offsetMinutes * 60_000);
};

const formatExcelHeaderDateSL = (date) => {
    if (!date) return "";
    // We treat `date` as already shifted to Sri Lanka time, so format using UTC parts.
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getUTCFullYear());
    let h = date.getUTCHours();
    const min = String(date.getUTCMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${dd}/${mm}/${yyyy} ${h}:${min} ${ampm}`;
};

// ────────────────────────────────────────────────────────────────
// Excel styling helpers (business-friendly defaults)
// ────────────────────────────────────────────────────────────────
const EXCEL_BRAND_NAME = process.env.EXCEL_BRAND_NAME || "NEW YASUKI AUTO MOTORS (PVT) Ltd.";
const EXCEL_THEME_DARK = "FF0f172a";
const EXCEL_THEME_MUTED = "FF475569";
const EXCEL_ALT_ROW = "FFF8FAFC";

const setWorkbookMeta = (workbook) => {
    try {
        workbook.creator = EXCEL_BRAND_NAME;
        workbook.lastModifiedBy = EXCEL_BRAND_NAME;
        workbook.created = new Date();
        workbook.modified = new Date();
    } catch (_) {
        // ignore (depends on ExcelJS version)
    }
};

const styleHeaderRow = (row, columnCount) => {
    row.height = 20;
    for (let c = 1; c <= columnCount; c += 1) {
        const cell = row.getCell(c);
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_THEME_DARK } };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
        };
    }
};

const applySheetChrome = (sheet, { headerRow = 1, headerColumnCount, freezeRow = headerRow + 0 } = {}) => {
    // Freeze header row
    sheet.views = [{ state: "frozen", ySplit: freezeRow }];
    // Filter on header
    if (headerColumnCount) {
        sheet.autoFilter = {
            from: { row: headerRow, column: 1 },
            to: { row: headerRow, column: headerColumnCount },
        };
    }
    sheet.properties.defaultRowHeight = 18;
};

const applyTableBorders = (sheet) => {
    sheet.eachRow((row) => {
        row.eachCell((cell) => {
            if (!cell.border) {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            }
        });
    });
};

const setPrintSetup = (sheet, { landscape = false } = {}) => {
    sheet.pageSetup = {
        paperSize: 9, // A4
        orientation: landscape ? "landscape" : "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
    };
};

const statusChip = (cell, raw) => {
    const status = String(raw || "").trim().toLowerCase();
    const map = {
        paid: { fg: "FFDCFCE7", font: "FF166534" },     // green
        pending: { fg: "FFFFF7ED", font: "FF9A3412" },  // orange
        unpaid: { fg: "FFFEE2E2", font: "FF991B1B" },   // red
        partial: { fg: "FFFEF9C3", font: "FF854D0E" },  // amber
        completed: { fg: "FFDCFCE7", font: "FF166534" },
        "in progress": { fg: "FFE0F2FE", font: "FF075985" }, // blue
        cancelled: { fg: "FFFEE2E2", font: "FF991B1B" },
    };
    const style = map[status];
    if (!style) return;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: style.fg } };
    cell.font = { bold: true, color: { argb: style.font } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
};

const addTotalsRow = (sheet, { labelColumn = 1, valueColumn, startRow, endRow, currency = false, label = "TOTAL" }) => {
    if (!startRow || !endRow || endRow < startRow) return;
    const rowIdx = endRow + 2;
    const totalsRow = sheet.getRow(rowIdx);
    totalsRow.height = 20;
    totalsRow.getCell(labelColumn).value = label;
    totalsRow.getCell(labelColumn).font = { bold: true, color: { argb: EXCEL_THEME_MUTED } };
    if (valueColumn) {
        const colLetter = sheet.getColumn(valueColumn).letter;
        totalsRow.getCell(valueColumn).value = { formula: `SUM(${colLetter}${startRow}:${colLetter}${endRow})` };
        totalsRow.getCell(valueColumn).font = { bold: true };
        totalsRow.getCell(valueColumn).alignment = { horizontal: "right" };
        if (currency) totalsRow.getCell(valueColumn).numFmt = '"LKR "#,##0.00';
    }
};

const addSheetBanner = (sheet, { reportTitle, range, columnCount }) => {
    const cols = Math.max(1, Number(columnCount) || 1);
    const generatedSL = asExcelLocalDate(new Date().toISOString());

    sheet.mergeCells(1, 1, 1, cols);
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = reportTitle;
    titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_THEME_DARK } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(1).height = 30;

    sheet.mergeCells(2, 1, 2, cols);
    const metaCell = sheet.getCell(2, 1);
    const periodText =
        range && range.startDate && range.endDate ? `Period: ${range.startDate} → ${range.endDate}` : "";
    const generatedText = `Generated (Sri Lanka): ${formatExcelHeaderDateSL(generatedSL)}`;
    metaCell.value = [EXCEL_BRAND_NAME, periodText, generatedText].filter(Boolean).join("  •  ");
    metaCell.font = { size: 10, color: { argb: "FFFFFFFF" } };
    metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_THEME_MUTED } };
    metaCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    sheet.getRow(2).height = 20;

    // spacer row
    sheet.getRow(3).height = 6;
};

const attachPdfScaffold = (doc, { title, range }) => {
    let page = 1;

    const setFont = ({ size = 10, bold = false, color = "#111827" } = {}) =>
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

    const drawHeader = () => {
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const left = doc.page.margins.left;
        const top = doc.page.margins.top;
        const headerHeight = 62;

        doc.save();
        doc.rect(left, top, pageWidth, headerHeight).fill("#0f172a");
        doc.restore();

        setFont({ size: 20, bold: true, color: "#ffffff" });
        doc.text(title, left + 12, top + 14, { width: pageWidth - 24 });

        setFont({ size: 9, color: "#cbd5e1" });
        doc.text(PDF_BRAND, left + 12, top + 18, { width: pageWidth - 24, align: "right" });

        setFont({ size: 9, color: "#e2e8f0" });
        doc.text(`Period: ${range.startDate} → ${range.endDate}`, left + 12, top + 38, { width: pageWidth - 24 });
        doc.text(`Generated: ${pdfFormatDate(new Date())}`, left + 12, top + 50, { width: pageWidth - 24 });

        doc.y = top + headerHeight + 16;
    };

    const drawFooter = () => {
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const left = doc.page.margins.left;
        const bottomY = doc.page.height - doc.page.margins.bottom + 6;

        doc.save();
        doc.strokeColor("#e2e8f0").moveTo(left, bottomY - 14).lineTo(left + pageWidth, bottomY - 14).stroke();
        doc.restore();

        setFont({ size: 8, color: "#64748b" });
        doc.text(`Generated by ${PDF_BRAND}`, left, bottomY - 10, { width: pageWidth / 2 });
        doc.text(`Page ${page}`, left, bottomY - 10, { width: pageWidth, align: "right" });
    };

    const addPage = () => {
        drawFooter();
        doc.addPage();
        page += 1;
        drawHeader();
    };

    const finish = () => {
        drawFooter();
        doc.end();
    };

    drawHeader();

    return { addPage, finish, setFont };
};

const fetchExpenseReport = async (range) => {
    const expenses = await allAsync(
        `
        SELECT id, description, category, amount, expense_date, payment_status, payment_method, remarks, created_at
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY DATE(expense_date) DESC, id DESC
    `,
        [range.startDate, range.endDate]
    );

    const categories = await allAsync(
        `
        SELECT COALESCE(category, 'Uncategorized') AS category, COUNT(*) AS count, SUM(amount) AS total
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        GROUP BY COALESCE(category, 'Uncategorized')
        ORDER BY total DESC
    `,
        [range.startDate, range.endDate]
    );

    const statuses = await allAsync(
        `
        SELECT payment_status AS status, COUNT(*) AS count, SUM(amount) AS total
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        GROUP BY payment_status
        ORDER BY total DESC
    `,
        [range.startDate, range.endDate]
    );

    const totalAmount = expenses.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

    return {
        range,
        totals: {
            totalAmount: Number(totalAmount.toFixed(2)),
        },
        categories,
        statuses,
        expenses,
    };
};

const fetchJobReport = async (range) => {
    const jobs = await allAsync(
        `
        SELECT
            Jobs.id,
            Jobs.description,
            Jobs.job_status,
            Jobs.created_at,
            Jobs.updated_at,
            Jobs.status_changed_at,
            Jobs.category,
            Customers.name AS customer_name,
            Vehicles.license_plate AS plate,
            Invoices.invoice_no,
            Invoices.invoice_date,
            Invoices.final_total,
            Invoices.payment_status
        FROM Jobs
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
        LEFT JOIN Invoices ON Invoices.job_id = Jobs.id
        WHERE DATE(Jobs.created_at) BETWEEN DATE(?) AND DATE(?)
        ORDER BY Jobs.created_at DESC, Jobs.id DESC
    `,
        [range.startDate, range.endDate]
    );

    const statuses = await allAsync(
        `
        SELECT job_status AS status, COUNT(*) AS count
        FROM Jobs
        WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        GROUP BY job_status
    `,
        [range.startDate, range.endDate]
    );

    const completedRevenue = await getAsync(
        `
        SELECT COALESCE(SUM(final_total), 0) AS total
        FROM Invoices
        WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    return {
        range,
        totals: {
            jobCount: jobs.length,
            completedRevenue: Number((completedRevenue?.total || 0).toFixed(2)),
        },
        statuses,
        jobs,
    };
};

const fetchRevenueReport = async (range) => {
    // Get invoice summary with payment status breakdown
    const summary = await getAsync(
        `
        SELECT
            COALESCE(SUM(final_total), 0) AS totalRevenue,
            COUNT(*) AS invoiceCount,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN final_total ELSE 0 END), 0) AS paidRevenue,
            COALESCE(SUM(CASE WHEN payment_status = 'partial' THEN final_total ELSE 0 END), 0) AS partialRevenue,
            COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN final_total ELSE 0 END), 0) AS unpaidRevenue
        FROM Invoices
        WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    // Get expenses total
    const expensesTotal = await getAsync(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    // Get payment status breakdown
    const statuses = await allAsync(
        `
        SELECT payment_status AS status, COUNT(*) AS count, COALESCE(SUM(final_total), 0) AS total
        FROM Invoices
        WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
        GROUP BY payment_status
        ORDER BY total DESC
    `,
        [range.startDate, range.endDate]
    );

    // Get detailed invoices list
    const invoices = await allAsync(
        `
        SELECT
            Invoices.id,
            Invoices.invoice_no,
            Invoices.invoice_date,
            Invoices.created_at,
            Invoices.final_total,
            Invoices.payment_status,
            Jobs.description AS job_description,
            Customers.name AS customer_name
        FROM Invoices
        LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        WHERE DATE(Invoices.invoice_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY Invoices.invoice_date DESC, Invoices.id DESC
    `,
        [range.startDate, range.endDate]
    );

    // Get expenses list
    const expenses = await allAsync(
        `
        SELECT id, description, category, amount, expense_date, payment_status, payment_method, remarks, created_at
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY expense_date DESC, id DESC
    `,
        [range.startDate, range.endDate]
    );

    const totalRevenue = Number(summary?.totalRevenue || 0);
    const invoiceCount = Number(summary?.invoiceCount || 0);
    const paidRevenue = Number(summary?.paidRevenue || 0);
    const partialRevenue = Number(summary?.partialRevenue || 0);
    const unpaidRevenue = Number(summary?.unpaidRevenue || 0);
    const expensesTotalAmount = Number((expensesTotal?.total || 0).toFixed(2));
    const netRevenue = Number((totalRevenue - expensesTotalAmount).toFixed(2));

    return {
        range,
        totals: {
            totalRevenue: Number(totalRevenue.toFixed(2)),
            invoicesTotal: Number(totalRevenue.toFixed(2)), // Alias for backward compatibility
            invoiceCount,
            averageInvoice: invoiceCount ? Number((totalRevenue / invoiceCount).toFixed(2)) : 0,
            paidRevenue: Number(paidRevenue.toFixed(2)),
            partialRevenue: Number(partialRevenue.toFixed(2)),
            unpaidRevenue: Number(unpaidRevenue.toFixed(2)),
            expensesTotal: expensesTotalAmount,
            revenue: netRevenue,
        },
        statuses,
        invoices,
        expenses,
    };
};

const fetchInventoryReport = async (range) => {
    const items = await allAsync(
        `
        SELECT
            InventoryItems.id,
            InventoryItems.name,
            InventoryItems.type,
            InventoryItems.unit,
            InventoryItems.unit_cost,
            InventoryItems.description,
            InventoryItems.quantity,
            InventoryItems.reorder_level,
            InventoryItems.created_at,
            InventoryItems.updated_at,
            last_purchase.last_purchase_date,
            COALESCE(usage_summary.total_used, 0) AS total_used,
            CASE WHEN InventoryItems.quantity <= InventoryItems.reorder_level THEN 1 ELSE 0 END AS low_stock
        FROM InventoryItems
        LEFT JOIN (
            SELECT inventory_item_id, MAX(purchase_date) AS last_purchase_date
            FROM SupplierPurchases
            WHERE inventory_item_id IS NOT NULL
            GROUP BY inventory_item_id
        ) AS last_purchase ON last_purchase.inventory_item_id = InventoryItems.id
        LEFT JOIN (
            SELECT 
                JobItems.inventory_item_id, 
                SUM(JobItems.quantity) AS total_used
            FROM JobItems
            INNER JOIN Jobs ON Jobs.id = JobItems.job_id
            WHERE JobItems.inventory_item_id IS NOT NULL
              AND DATE(Jobs.created_at) BETWEEN DATE(?) AND DATE(?)
            GROUP BY JobItems.inventory_item_id
        ) AS usage_summary ON usage_summary.inventory_item_id = InventoryItems.id
        ORDER BY InventoryItems.name ASC
    `,
        [range.startDate, range.endDate]
    );

    const lowStock = items.filter((item) => item.low_stock);
    const mostUsed = [...items]
        .filter((item) => item.total_used > 0)
        .sort((a, b) => b.total_used - a.total_used)
        .slice(0, 10);

    return {
        range,
        totals: {
            itemCount: items.length,
            lowStockCount: lowStock.length,
        },
        lowStock,
        mostUsed,
        items,
    };
};


const renderExpensePdf = (report) =>
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
        const formatPeriodDate = (val) => {
            if (!val) return "N/A";
            const d = new Date(val);
            return isNaN(d.getTime()) ? val : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        };

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
        // HEADER - LOGO + COMPANY DETAILS
        // ═══════════════════════════════════════════════════════════
        const logoSize = 50;
        const logoX = margin;
        
        // Draw logo on left
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, logoX, y, { width: logoSize, height: logoSize });
        }
        
        // Company details next to logo
        const textX = margin + logoSize + 15;
        
        doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", textX, y + 8);
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com", textX, y + 28);
        
        y += logoSize + 10;

        // Divider
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(1.5).stroke();
        y += 15;

        // ═══════════════════════════════════════════════════════════
        // REPORT TITLE & INFO
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(22).fillColor(DARK);
        doc.text("EXPENSE REPORT", margin, y);

        // Period and generated date (right)
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        const periodText = `${formatPeriodDate(report.range.startDate)} - ${formatPeriodDate(report.range.endDate)}`;
        doc.text(`Period: ${periodText}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Generated: ${formatDate(new Date())}`, pageWidth - margin - 180, y + 12, { width: 180, align: "right" });

        y += 40;

        // ═══════════════════════════════════════════════════════════
        // EXPENSE DETAILS TABLE
        // ═══════════════════════════════════════════════════════════
        const tableTop = y;
        const col1 = 70;    // Date
        const col2 = 170;   // Description
        const col3 = 85;    // Category
        const col4 = 90;    // Amount
        const col5 = 80;    // Status
        const rowH = 22;

        // Header with attractive grid
        const headerY = y;
        doc.rect(margin, headerY, contentWidth, rowH).fill(DARK);
        
        // Draw grid lines for header
        const headerCellPositions = [
            { x: margin, width: col1 },
            { x: margin + col1, width: col2 },
            { x: margin + col1 + col2, width: col3 },
            { x: margin + col1 + col2 + col3, width: col4 },
            { x: margin + col1 + col2 + col3 + col4, width: col5 },
        ];
        
        doc.save();
        doc.strokeColor("#1f2937").lineWidth(0.5);
        headerCellPositions.forEach((cell, idx) => {
            if (idx > 0) {
                // Vertical line between header cells
                doc.moveTo(cell.x, headerY)
                    .lineTo(cell.x, headerY + rowH)
                    .stroke();
            }
        });
        // Right border
        doc.moveTo(margin + contentWidth, headerY)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        // Bottom border
        doc.moveTo(margin, headerY + rowH)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        doc.restore();
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
        doc.text("Date", margin + 8, headerY + 7, { width: col1 - 16 });
        doc.text("Description", margin + col1 + 8, headerY + 7, { width: col2 - 16 });
        doc.text("Category", margin + col1 + col2 + 8, headerY + 7, { width: col3 - 16 });
        doc.text("Amount", margin + col1 + col2 + col3 + 8, headerY + 7, { width: col4 - 16, align: "right" });
        doc.text("Status", margin + col1 + col2 + col3 + col4 + 8, headerY + 7, { width: col5 - 16, align: "center" });
        y += rowH;

        // Rows with attractive grid
        const drawRow = (date, desc, category, amount, status, alt) => {
            const rowX = margin;
            const rowY = y;
            
            // Background color for alternating rows
            if (alt) {
                doc.save();
                doc.rect(rowX, rowY, contentWidth, rowH).fill(LIGHT);
                doc.restore();
            }
            
            // Draw grid lines for each cell
            const cellPositions = [
                { x: rowX, width: col1 },
                { x: rowX + col1, width: col2 },
                { x: rowX + col1 + col2, width: col3 },
                { x: rowX + col1 + col2 + col3, width: col4 },
                { x: rowX + col1 + col2 + col3 + col4, width: col5 },
            ];
            
            // Draw vertical grid lines
            doc.save();
            doc.strokeColor(BORDER).lineWidth(0.5);
            cellPositions.forEach((cell, idx) => {
                if (idx > 0) {
                    // Vertical line between cells
                    doc.moveTo(cell.x, rowY)
                        .lineTo(cell.x, rowY + rowH)
                        .stroke();
                }
            });
            // Right border
            doc.moveTo(rowX + contentWidth, rowY)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            // Horizontal lines (top and bottom)
            doc.moveTo(rowX, rowY)
                .lineTo(rowX + contentWidth, rowY)
                .stroke();
            doc.moveTo(rowX, rowY + rowH)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            doc.restore();
            
            // Text content
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(date, rowX + 8, rowY + 7, { width: col1 - 16 });
            doc.text(desc, rowX + col1 + 8, rowY + 7, { width: col2 - 16 });
            doc.text(category, rowX + col1 + col2 + 8, rowY + 7, { width: col3 - 16 });
            doc.text(amount, rowX + col1 + col2 + col3 + 8, rowY + 7, { width: col4 - 16, align: "right" });
            doc.text(status, rowX + col1 + col2 + col3 + col4 + 8, rowY + 7, { width: col5 - 16, align: "center" });
            y += rowH;
        };

        const maxRows = 250;
        const rows = report.expenses.slice(0, maxRows);
        if (!rows.length) {
            doc.font("Helvetica").fontSize(10).fillColor(GRAY);
            doc.text("No expenses to display for the selected period.", margin, y + 10);
        } else {
            rows.forEach((entry, i) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;
                if (y > bottomLimit) {
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
                    
                    // Redraw header on new page with grid
                    y = margin + 40;
                    const newHeaderY = y;
                    doc.rect(margin, newHeaderY, contentWidth, rowH).fill(DARK);
                    
                    // Draw grid lines for header
                    doc.save();
                    doc.strokeColor("#1f2937").lineWidth(0.5);
                    headerCellPositions.forEach((cell, idx) => {
                        if (idx > 0) {
                            doc.moveTo(cell.x, newHeaderY)
                                .lineTo(cell.x, newHeaderY + rowH)
                                .stroke();
                        }
                    });
                    doc.moveTo(margin + contentWidth, newHeaderY)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.moveTo(margin, newHeaderY + rowH)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.restore();
                    
                    doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
                    doc.text("Date", margin + 8, newHeaderY + 7, { width: col1 - 16 });
                    doc.text("Description", margin + col1 + 8, newHeaderY + 7, { width: col2 - 16 });
                    doc.text("Category", margin + col1 + col2 + 8, newHeaderY + 7, { width: col3 - 16 });
                    doc.text("Amount", margin + col1 + col2 + col3 + 8, newHeaderY + 7, { width: col4 - 16, align: "right" });
                    doc.text("Status", margin + col1 + col2 + col3 + col4 + 8, newHeaderY + 7, { width: col5 - 16, align: "center" });
                    y += rowH;
                }

                const description = entry.description || "—";
                const truncatedDesc = description.length > 35 ? description.substring(0, 32) + "…" : description;
                const category = entry.category || "Uncategorized";
                const truncatedCategory = category.length > 20 ? category.substring(0, 17) + "…" : category;
                
                drawRow(
                    formatDate(entry.expense_date),
                    truncatedDesc,
                    truncatedCategory,
                    formatCurrency(entry.amount),
                    (entry.payment_status || "pending").toUpperCase(),
                    i % 2 === 0
                );
            });

            if (report.expenses.length > maxRows) {
                doc.font("Helvetica").fontSize(9).fillColor(GRAY);
                doc.text(`+ ${report.expenses.length - maxRows} more entries not shown`, margin, y + 5);
            }
        }

        doc.end();
    });

const renderJobPdf = (report) =>
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
        const formatPeriodDate = (val) => {
            if (!val) return "N/A";
            const d = new Date(val);
            return isNaN(d.getTime()) ? val : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        };

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
        // HEADER - LOGO + COMPANY DETAILS
        // ═══════════════════════════════════════════════════════════
        const logoSize = 50;
        const logoX = margin;
        
        // Draw logo on left
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, logoX, y, { width: logoSize, height: logoSize });
        }
        
        // Company details next to logo
        const textX = margin + logoSize + 15;
        
        doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", textX, y + 8);
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com", textX, y + 28);
        
        y += logoSize + 10;

        // Divider
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(1.5).stroke();
        y += 15;

        // ═══════════════════════════════════════════════════════════
        // REPORT TITLE & INFO
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(22).fillColor(DARK);
        doc.text("JOB SUMMARY REPORT", margin, y);

        // Period and generated date (right)
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        const periodText = `${formatPeriodDate(report.range.startDate)} - ${formatPeriodDate(report.range.endDate)}`;
        doc.text(`Period: ${periodText}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Generated: ${formatDate(new Date())}`, pageWidth - margin - 180, y + 12, { width: 180, align: "right" });

        y += 40;

        // ═══════════════════════════════════════════════════════════
        // JOB DETAILS TABLE
        // ═══════════════════════════════════════════════════════════
        const tableTop = y;
        const col1 = 55;    // Created
        const col2 = 105;   // Job
        const col3 = 80;    // Customer
        const col4 = 50;    // Plate
        const col5 = 50;    // Status
        const col6 = 50;    // Invoice
        const col7 = 105; // Amount (needs more space for currency)
        const rowH = 22;

        // Header with attractive grid
        const headerY = y;
        doc.rect(margin, headerY, contentWidth, rowH).fill(DARK);
        
        // Draw grid lines for header
        const headerCellPositions = [
            { x: margin, width: col1 },
            { x: margin + col1, width: col2 },
            { x: margin + col1 + col2, width: col3 },
            { x: margin + col1 + col2 + col3, width: col4 },
            { x: margin + col1 + col2 + col3 + col4, width: col5 },
            { x: margin + col1 + col2 + col3 + col4 + col5, width: col6 },
            { x: margin + col1 + col2 + col3 + col4 + col5 + col6, width: col7 },
        ];
        
        doc.save();
        doc.strokeColor("#1f2937").lineWidth(0.5);
        headerCellPositions.forEach((cell, idx) => {
            if (idx > 0) {
                doc.moveTo(cell.x, headerY)
                    .lineTo(cell.x, headerY + rowH)
                    .stroke();
            }
        });
        doc.moveTo(margin + contentWidth, headerY)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        doc.moveTo(margin, headerY + rowH)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        doc.restore();
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
        doc.text("Created", margin + 8, headerY + 7, { width: col1 - 16 });
        doc.text("Job", margin + col1 + 8, headerY + 7, { width: col2 - 16 });
        doc.text("Customer", margin + col1 + col2 + 8, headerY + 7, { width: col3 - 16 });
        doc.text("Plate", margin + col1 + col2 + col3 + 8, headerY + 7, { width: col4 - 16 });
        doc.text("Status", margin + col1 + col2 + col3 + col4 + 8, headerY + 7, { width: col5 - 16, align: "center" });
        doc.text("Invoice", margin + col1 + col2 + col3 + col4 + col5 + 8, headerY + 7, { width: col6 - 16 });
        doc.text("Amount", margin + col1 + col2 + col3 + col4 + col5 + col6 + 8, headerY + 7, { width: col7 - 16, align: "right" });
        y += rowH;

        // Rows with attractive grid
        const drawRow = (created, job, customer, plate, status, invoice, amount, alt) => {
            const rowX = margin;
            const rowY = y;
            
            // Background color for alternating rows
            if (alt) {
                doc.save();
                doc.rect(rowX, rowY, contentWidth, rowH).fill(LIGHT);
                doc.restore();
            }
            
            // Draw grid lines for each cell
            const cellPositions = [
                { x: rowX, width: col1 },
                { x: rowX + col1, width: col2 },
                { x: rowX + col1 + col2, width: col3 },
                { x: rowX + col1 + col2 + col3, width: col4 },
                { x: rowX + col1 + col2 + col3 + col4, width: col5 },
                { x: rowX + col1 + col2 + col3 + col4 + col5, width: col6 },
                { x: rowX + col1 + col2 + col3 + col4 + col5 + col6, width: col7 },
            ];
            
            // Draw vertical grid lines
            doc.save();
            doc.strokeColor(BORDER).lineWidth(0.5);
            cellPositions.forEach((cell, idx) => {
                if (idx > 0) {
                    doc.moveTo(cell.x, rowY)
                        .lineTo(cell.x, rowY + rowH)
                        .stroke();
                }
            });
            // Right border
            doc.moveTo(rowX + contentWidth, rowY)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            // Horizontal lines (top and bottom)
            doc.moveTo(rowX, rowY)
                .lineTo(rowX + contentWidth, rowY)
                .stroke();
            doc.moveTo(rowX, rowY + rowH)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            doc.restore();
            
            // Text content
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(created, rowX + 8, rowY + 7, { width: col1 - 16 });
            doc.text(job, rowX + col1 + 8, rowY + 7, { width: col2 - 16 });
            doc.text(customer, rowX + col1 + col2 + 8, rowY + 7, { width: col3 - 16 });
            doc.text(plate, rowX + col1 + col2 + col3 + 8, rowY + 7, { width: col4 - 16 });
            doc.text(status, rowX + col1 + col2 + col3 + col4 + 8, rowY + 7, { width: col5 - 16, align: "center" });
            doc.text(invoice, rowX + col1 + col2 + col3 + col4 + col5 + 8, rowY + 7, { width: col6 - 16 });
            doc.text(amount, rowX + col1 + col2 + col3 + col4 + col5 + col6 + 8, rowY + 7, { width: col7 - 16, align: "right" });
            y += rowH;
        };

        const maxRows = 250;
        const rows = report.jobs.slice(0, maxRows);
        if (!rows.length) {
            doc.font("Helvetica").fontSize(10).fillColor(GRAY);
            doc.text("No jobs to display for the selected period.", margin, y + 10);
        } else {
            rows.forEach((job, i) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;
                if (y > bottomLimit) {
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
                    
                    // Redraw header on new page with grid
                    y = margin + 40;
                    const newHeaderY = y;
                    doc.rect(margin, newHeaderY, contentWidth, rowH).fill(DARK);
                    
                    // Draw grid lines for header
                    doc.save();
                    doc.strokeColor("#1f2937").lineWidth(0.5);
                    headerCellPositions.forEach((cell, idx) => {
                        if (idx > 0) {
                            doc.moveTo(cell.x, newHeaderY)
                                .lineTo(cell.x, newHeaderY + rowH)
                                .stroke();
                        }
                    });
                    doc.moveTo(margin + contentWidth, newHeaderY)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.moveTo(margin, newHeaderY + rowH)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.restore();
                    
                    doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
                    doc.text("Created", margin + 8, newHeaderY + 7, { width: col1 - 16 });
                    doc.text("Job", margin + col1 + 8, newHeaderY + 7, { width: col2 - 16 });
                    doc.text("Customer", margin + col1 + col2 + 8, newHeaderY + 7, { width: col3 - 16 });
                    doc.text("Plate", margin + col1 + col2 + col3 + 8, newHeaderY + 7, { width: col4 - 16 });
                    doc.text("Status", margin + col1 + col2 + col3 + col4 + 8, newHeaderY + 7, { width: col5 - 16, align: "center" });
                    doc.text("Invoice", margin + col1 + col2 + col3 + col4 + col5 + 8, newHeaderY + 7, { width: col6 - 16 });
                    doc.text("Amount", margin + col1 + col2 + col3 + col4 + col5 + col6 + 8, newHeaderY + 7, { width: col7 - 16, align: "right" });
                    y += rowH;
                }

                const description = job.description || "—";
                const truncatedDesc = description.length > 25 ? description.substring(0, 22) + "…" : description;
                const customer = job.customer_name || "Walk-in";
                const truncatedCustomer = customer.length > 18 ? customer.substring(0, 15) + "…" : customer;
                const plate = job.plate || "—";
                const truncatedPlate = plate.length > 10 ? plate.substring(0, 7) + "…" : plate;
                const invoice = job.invoice_no || "—";
                const truncatedInvoice = invoice.length > 12 ? invoice.substring(0, 9) + "…" : invoice;
                
                drawRow(
                    formatDate(job.created_at),
                    truncatedDesc,
                    truncatedCustomer,
                    truncatedPlate,
                    job.job_status || "—",
                    truncatedInvoice,
                    job.final_total ? formatCurrency(job.final_total) : "—",
                    i % 2 === 0
                );
            });

            if (report.jobs.length > maxRows) {
                doc.font("Helvetica").fontSize(9).fillColor(GRAY);
                doc.text(`+ ${report.jobs.length - maxRows} more entries not shown`, margin, y + 5);
            }
        }

        doc.end();
    });

const renderInventoryPdf = (report) =>
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
        const formatPeriodDate = (val) => {
            if (!val) return "N/A";
            const d = new Date(val);
            return isNaN(d.getTime()) ? val : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        };

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
        // HEADER - LOGO + COMPANY DETAILS
        // ═══════════════════════════════════════════════════════════
        const logoSize = 50;
        const logoX = margin;
        
        // Draw logo on left
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, logoX, y, { width: logoSize, height: logoSize });
        }
        
        // Company details next to logo
        const textX = margin + logoSize + 15;
        
        doc.font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", textX, y + 8);
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text("Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com", textX, y + 28);
        
        y += logoSize + 10;

        // Divider
        doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(PRIMARY).lineWidth(1.5).stroke();
        y += 15;

        // ═══════════════════════════════════════════════════════════
        // REPORT TITLE & INFO
        // ═══════════════════════════════════════════════════════════
        doc.font("Helvetica-Bold").fontSize(22).fillColor(DARK);
        doc.text("INVENTORY REPORT", margin, y);

        // Period and generated date (right)
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        const periodText = `${formatPeriodDate(report.range.startDate)} - ${formatPeriodDate(report.range.endDate)}`;
        doc.text(`Period: ${periodText}`, pageWidth - margin - 180, y, { width: 180, align: "right" });
        doc.text(`Generated: ${formatDate(new Date())}`, pageWidth - margin - 180, y + 12, { width: 180, align: "right" });

        y += 40;

        // ═══════════════════════════════════════════════════════════
        // INVENTORY DETAILS TABLE
        // ═══════════════════════════════════════════════════════════
        const tableTop = y;
        const col1 = 120;   // Item
        const col2 = 50;    // Type
        const col3 = 45;    // Qty
        const col4 = 50;    // Unit
        const col5 = 60;    // Unit Cost
        const col6 = 50;    // Reorder
        const col7 = 45;    // Used
        const col8 = 35;    // Low
        const col9 = 100;   // Notes
        const rowH = 22;

        // Header with attractive grid
        const headerY = y;
        doc.rect(margin, headerY, contentWidth, rowH).fill(DARK);
        
        // Draw grid lines for header
        const headerCellPositions = [
            { x: margin, width: col1 },
            { x: margin + col1, width: col2 },
            { x: margin + col1 + col2, width: col3 },
            { x: margin + col1 + col2 + col3, width: col4 },
            { x: margin + col1 + col2 + col3 + col4, width: col5 },
            { x: margin + col1 + col2 + col3 + col4 + col5, width: col6 },
            { x: margin + col1 + col2 + col3 + col4 + col5 + col6, width: col7 },
            { x: margin + col1 + col2 + col3 + col4 + col5 + col6 + col7, width: col8 },
            { x: margin + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8, width: col9 },
        ];
        
        doc.save();
        doc.strokeColor("#1f2937").lineWidth(0.5);
        headerCellPositions.forEach((cell, idx) => {
            if (idx > 0) {
                doc.moveTo(cell.x, headerY)
                    .lineTo(cell.x, headerY + rowH)
                    .stroke();
            }
        });
        doc.moveTo(margin + contentWidth, headerY)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        doc.moveTo(margin, headerY + rowH)
            .lineTo(margin + contentWidth, headerY + rowH)
            .stroke();
        doc.restore();
        
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
        doc.text("Item", margin + 8, headerY + 7, { width: col1 - 16 });
        doc.text("Type", margin + col1 + 8, headerY + 7, { width: col2 - 16 });
        doc.text("Qty", margin + col1 + col2 + 8, headerY + 7, { width: col3 - 16, align: "center" });
        doc.text("Unit", margin + col1 + col2 + col3 + 8, headerY + 7, { width: col4 - 16 });
        doc.text("Unit Cost", margin + col1 + col2 + col3 + col4 + 8, headerY + 7, { width: col5 - 16, align: "right" });
        doc.text("Reorder", margin + col1 + col2 + col3 + col4 + col5 + 8, headerY + 7, { width: col6 - 16, align: "center" });
        doc.text("Used", margin + col1 + col2 + col3 + col4 + col5 + col6 + 8, headerY + 7, { width: col7 - 16, align: "center" });
        doc.text("Low", margin + col1 + col2 + col3 + col4 + col5 + col6 + col7 + 8, headerY + 7, { width: col8 - 16, align: "center" });
        doc.text("Notes", margin + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8 + 8, headerY + 7, { width: col9 - 16 });
        y += rowH;

        // Rows with attractive grid
        const drawRow = (item, type, qty, unit, unitCost, reorder, used, low, notes, alt) => {
            const rowX = margin;
            const rowY = y;
            
            // Background color for alternating rows
            if (alt) {
                doc.save();
                doc.rect(rowX, rowY, contentWidth, rowH).fill(LIGHT);
                doc.restore();
            }
            
            // Draw grid lines for each cell
            const cellPositions = [
                { x: rowX, width: col1 },
                { x: rowX + col1, width: col2 },
                { x: rowX + col1 + col2, width: col3 },
                { x: rowX + col1 + col2 + col3, width: col4 },
                { x: rowX + col1 + col2 + col3 + col4, width: col5 },
                { x: rowX + col1 + col2 + col3 + col4 + col5, width: col6 },
                { x: rowX + col1 + col2 + col3 + col4 + col5 + col6, width: col7 },
                { x: rowX + col1 + col2 + col3 + col4 + col5 + col6 + col7, width: col8 },
                { x: rowX + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8, width: col9 },
            ];
            
            // Draw vertical grid lines
            doc.save();
            doc.strokeColor(BORDER).lineWidth(0.5);
            cellPositions.forEach((cell, idx) => {
                if (idx > 0) {
                    doc.moveTo(cell.x, rowY)
                        .lineTo(cell.x, rowY + rowH)
                        .stroke();
                }
            });
            // Right border
            doc.moveTo(rowX + contentWidth, rowY)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            // Horizontal lines (top and bottom)
            doc.moveTo(rowX, rowY)
                .lineTo(rowX + contentWidth, rowY)
                .stroke();
            doc.moveTo(rowX, rowY + rowH)
                .lineTo(rowX + contentWidth, rowY + rowH)
                .stroke();
            doc.restore();
            
            // Text content
            doc.font("Helvetica").fontSize(8).fillColor(DARK);
            doc.text(item, rowX + 8, rowY + 7, { width: col1 - 16 });
            doc.text(type, rowX + col1 + 8, rowY + 7, { width: col2 - 16 });
            doc.text(qty, rowX + col1 + col2 + 8, rowY + 7, { width: col3 - 16, align: "center" });
            doc.text(unit, rowX + col1 + col2 + col3 + 8, rowY + 7, { width: col4 - 16 });
            doc.text(unitCost, rowX + col1 + col2 + col3 + col4 + 8, rowY + 7, { width: col5 - 16, align: "right" });
            doc.text(reorder, rowX + col1 + col2 + col3 + col4 + col5 + 8, rowY + 7, { width: col6 - 16, align: "center" });
            doc.text(used, rowX + col1 + col2 + col3 + col4 + col5 + col6 + 8, rowY + 7, { width: col7 - 16, align: "center" });
            doc.text(low, rowX + col1 + col2 + col3 + col4 + col5 + col6 + col7 + 8, rowY + 7, { width: col8 - 16, align: "center" });
            doc.text(notes, rowX + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8 + 8, rowY + 7, { width: col9 - 16 });
            y += rowH;
        };

        const maxRows = 300;
        const rows = report.items.slice(0, maxRows);
        if (!rows.length) {
            doc.font("Helvetica").fontSize(10).fillColor(GRAY);
            doc.text("No inventory records found.", margin, y + 10);
        } else {
            rows.forEach((item, i) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;
                if (y > bottomLimit) {
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
                    
                    // Redraw header on new page with grid
                    y = margin + 40;
                    const newHeaderY = y;
                    doc.rect(margin, newHeaderY, contentWidth, rowH).fill(DARK);
                    
                    // Draw grid lines for header
                    doc.save();
                    doc.strokeColor("#1f2937").lineWidth(0.5);
                    headerCellPositions.forEach((cell, idx) => {
                        if (idx > 0) {
                            doc.moveTo(cell.x, newHeaderY)
                                .lineTo(cell.x, newHeaderY + rowH)
                                .stroke();
                        }
                    });
                    doc.moveTo(margin + contentWidth, newHeaderY)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.moveTo(margin, newHeaderY + rowH)
                        .lineTo(margin + contentWidth, newHeaderY + rowH)
                        .stroke();
                    doc.restore();
                    
                    doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF");
                    doc.text("Item", margin + 8, newHeaderY + 7, { width: col1 - 16 });
                    doc.text("Type", margin + col1 + 8, newHeaderY + 7, { width: col2 - 16 });
                    doc.text("Qty", margin + col1 + col2 + 8, newHeaderY + 7, { width: col3 - 16, align: "center" });
                    doc.text("Unit", margin + col1 + col2 + col3 + 8, newHeaderY + 7, { width: col4 - 16 });
                    doc.text("Unit Cost", margin + col1 + col2 + col3 + col4 + 8, newHeaderY + 7, { width: col5 - 16, align: "right" });
                    doc.text("Reorder", margin + col1 + col2 + col3 + col4 + col5 + 8, newHeaderY + 7, { width: col6 - 16, align: "center" });
                    doc.text("Used", margin + col1 + col2 + col3 + col4 + col5 + col6 + 8, newHeaderY + 7, { width: col7 - 16, align: "center" });
                    doc.text("Low", margin + col1 + col2 + col3 + col4 + col5 + col6 + col7 + 8, newHeaderY + 7, { width: col8 - 16, align: "center" });
                    doc.text("Notes", margin + col1 + col2 + col3 + col4 + col5 + col6 + col7 + col8 + 8, newHeaderY + 7, { width: col9 - 16 });
                    y += rowH;
                }

                const itemName = item.name || "—";
                const truncatedItem = itemName.length > 25 ? itemName.substring(0, 22) + "…" : itemName;
                const itemType = item.type || "—";
                const truncatedType = itemType.length > 10 ? itemType.substring(0, 7) + "…" : itemType;
                const unit = item.unit || "—";
                const truncatedUnit = unit.length > 10 ? unit.substring(0, 7) + "…" : unit;
                const unitCost = item.unit_cost ? formatCurrency(item.unit_cost) : "—";
                const reorder = item.reorder_level ?? "—";
                const used = `${item.total_used}`;
                const low = item.low_stock ? "Yes" : "No";
                const notes = item.description || "—";
                const truncatedNotes = notes.length > 20 ? notes.substring(0, 17) + "…" : notes;
                
                drawRow(
                    truncatedItem,
                    truncatedType,
                    `${item.quantity}`,
                    truncatedUnit,
                    unitCost,
                    `${reorder}`,
                    used,
                    low,
                    truncatedNotes,
                    i % 2 === 0
                );
            });

            if (report.items.length > maxRows) {
                doc.font("Helvetica").fontSize(9).fillColor(GRAY);
                doc.text(`+ ${report.items.length - maxRows} more entries not shown`, margin, y + 5);
            }
        }

        doc.end();
    });


// Excel Generation Functions with Professional Formatting
const renderExpenseExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    setWorkbookMeta(workbook);
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    addSheetBanner(summarySheet, { reportTitle: "EXPENSE REPORT • SUMMARY", range: report.range, columnCount: 3 });
    
    // Totals section (starts after banner)
    let row = 5;
    summarySheet.getRow(row).getCell(1).value = "Total Expenses";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.totals.totalAmount;
    summarySheet.getRow(row).getCell(2).numFmt = CURRENCY_FMT;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };
    
    row++;
    summarySheet.getRow(row).getCell(1).value = "Total Entries";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.expenses.length;
    
    // Category Breakdown
    row += 2;
    summarySheet.getRow(row).getCell(1).value = "Category Breakdown";
    summarySheet.getRow(row).getCell(1).font = { size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    summarySheet.getRow(row).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    summarySheet.mergeCells(`A${row}:C${row}`);
    
    row++;
    const categoryHeader = summarySheet.getRow(row);
    categoryHeader.getCell(1).value = "Category";
    categoryHeader.getCell(2).value = "Count";
    categoryHeader.getCell(3).value = "Total";
    categoryHeader.font = { bold: true };
    categoryHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe2e8f0" } };
    
    report.categories.forEach((cat, idx) => {
        row++;
        const dataRow = summarySheet.getRow(row);
        dataRow.getCell(1).value = cat.category;
        dataRow.getCell(2).value = cat.count;
        dataRow.getCell(3).value = cat.total;
        dataRow.getCell(3).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    
    // Status Breakdown
    row += 2;
    summarySheet.getRow(row).getCell(1).value = "Status Breakdown";
    summarySheet.getRow(row).getCell(1).font = { size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    summarySheet.getRow(row).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    summarySheet.mergeCells(`A${row}:C${row}`);
    
    row++;
    const statusHeader = summarySheet.getRow(row);
    statusHeader.getCell(1).value = "Status";
    statusHeader.getCell(2).value = "Count";
    statusHeader.getCell(3).value = "Total";
    statusHeader.font = { bold: true };
    statusHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe2e8f0" } };
    
    report.statuses.forEach((stat, idx) => {
        row++;
        const dataRow = summarySheet.getRow(row);
        dataRow.getCell(1).value = stat.status || "N/A";
        dataRow.getCell(2).value = stat.count;
        dataRow.getCell(3).value = stat.total || 0;
        dataRow.getCell(3).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 15;
    summarySheet.getColumn(3).width = 18;
    setPrintSetup(summarySheet, { landscape: false });
    applyTableBorders(summarySheet);
    
    // Details Sheet (match Expense PDF table)
    const detailsSheet = workbook.addWorksheet("Expense Details");
    const pdfHeaders = ["Date", "Description", "Category", "Amount", "Status"];
    addSheetBanner(detailsSheet, { reportTitle: "EXPENSE REPORT", range: report.range, columnCount: pdfHeaders.length });
    const headerRow = detailsSheet.getRow(4);
    pdfHeaders.forEach((header, idx) => (headerRow.getCell(idx + 1).value = header));
    styleHeaderRow(headerRow, pdfHeaders.length);
    applySheetChrome(detailsSheet, { headerRow: 4, headerColumnCount: pdfHeaders.length, freezeRow: 4 });
    setPrintSetup(detailsSheet, { landscape: true });

    report.expenses.forEach((exp, idx) => {
        const row = detailsSheet.getRow(idx + 5);
        row.getCell(1).value = exp.expense_date ? asExcelLocalDate(exp.expense_date) : null;
        row.getCell(1).numFmt = "dd/mm/yyyy";
        row.getCell(2).value = exp.description || "—";
        row.getCell(2).alignment = { wrapText: true, vertical: "top" };
        row.getCell(3).value = exp.category || "Uncategorized";
        row.getCell(4).value = exp.amount || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        const statusText = (exp.payment_status || "pending").toUpperCase();
        row.getCell(5).value = statusText;
        statusChip(row.getCell(5), exp.payment_status || "pending");

        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    detailsSheet.getColumn(1).width = 12;
    detailsSheet.getColumn(2).width = 36;
    detailsSheet.getColumn(3).width = 20;
    detailsSheet.getColumn(4).width = 14;
    detailsSheet.getColumn(5).width = 12;
    addTotalsRow(detailsSheet, {
        labelColumn: 3,
        valueColumn: 4,
        startRow: 5,
        endRow: report.expenses.length + 4,
        currency: true,
    });

    // Raw sheet (all fields)
    const rawSheet = workbook.addWorksheet("Expense Raw");
    const rawHeaders = [
        "ID",
        "Expense Date",
        "Created At",
        "Description",
        "Category",
        "Amount",
        "Payment Status",
        "Payment Method",
        "Remarks",
    ];
    addSheetBanner(rawSheet, { reportTitle: "EXPENSE REPORT (RAW)", range: report.range, columnCount: rawHeaders.length });
    const rawHeaderRow = rawSheet.getRow(4);
    rawHeaders.forEach((header, idx) => (rawHeaderRow.getCell(idx + 1).value = header));
    styleHeaderRow(rawHeaderRow, rawHeaders.length);
    applySheetChrome(rawSheet, { headerRow: 4, headerColumnCount: rawHeaders.length, freezeRow: 4 });
    setPrintSetup(rawSheet, { landscape: true });

    report.expenses.forEach((exp, idx) => {
        const row = rawSheet.getRow(idx + 5);
        row.getCell(1).value = exp.id;
        row.getCell(2).value = exp.expense_date ? asExcelLocalDate(exp.expense_date) : null;
        row.getCell(2).numFmt = "dd/mm/yyyy";
        row.getCell(3).value = exp.created_at ? asExcelLocalDate(exp.created_at) : null;
        row.getCell(3).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(4).value = exp.description || "";
        row.getCell(4).alignment = { wrapText: true, vertical: "top" };
        row.getCell(5).value = exp.category || "Uncategorized";
        row.getCell(6).value = exp.amount || 0;
        row.getCell(6).numFmt = CURRENCY_FMT;
        row.getCell(7).value = exp.payment_status || "";
        row.getCell(8).value = exp.payment_method || "";
        row.getCell(9).value = exp.remarks || "";
        row.getCell(9).alignment = { wrapText: true, vertical: "top" };
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 14;
    rawSheet.getColumn(3).width = 18;
    rawSheet.getColumn(4).width = 36;
    rawSheet.getColumn(5).width = 20;
    rawSheet.getColumn(6).width = 14;
    rawSheet.getColumn(7).width = 16;
    rawSheet.getColumn(8).width = 18;
    rawSheet.getColumn(9).width = 30;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(applyTableBorders);
    
    // Open the workbook on the full-detail sheet (so it's not "only summary" when opened)
    workbook.views = [{ activeTab: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderJobExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    setWorkbookMeta(workbook);
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    addSheetBanner(summarySheet, { reportTitle: "JOB SUMMARY REPORT • SUMMARY", range: report.range, columnCount: 2 });
    
    // Totals section (starts after banner)
    let row = 5;
    summarySheet.getRow(row).getCell(1).value = "Total Jobs";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.totals.jobCount;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };
    
    row++;
    summarySheet.getRow(row).getCell(1).value = "Completed Revenue";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.totals.completedRevenue;
    summarySheet.getRow(row).getCell(2).numFmt = CURRENCY_FMT;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };
    
    // Status Breakdown
    row += 2;
    summarySheet.getRow(row).getCell(1).value = "Status Breakdown";
    summarySheet.getRow(row).getCell(1).font = { size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    summarySheet.getRow(row).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    summarySheet.mergeCells(`A${row}:B${row}`);
    
    row++;
    const statusHeader = summarySheet.getRow(row);
    statusHeader.getCell(1).value = "Status";
    statusHeader.getCell(2).value = "Count";
    statusHeader.font = { bold: true };
    statusHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe2e8f0" } };
    
    report.statuses.forEach((stat, idx) => {
        row++;
        const dataRow = summarySheet.getRow(row);
        dataRow.getCell(1).value = stat.status;
        dataRow.getCell(2).value = stat.count;
        if (idx % 2 === 0) {
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 15;
    setPrintSetup(summarySheet, { landscape: false });
    applyTableBorders(summarySheet);
    
    // Details Sheet (Job PDF columns + key dates)
    const detailsSheet = workbook.addWorksheet("Job Details");
    const pdfHeaders = ["Created", "Updated", "Status Changed", "Invoice Date", "Job", "Customer", "Plate", "Status", "Invoice", "Amount"];
    addSheetBanner(detailsSheet, { reportTitle: "JOB SUMMARY REPORT", range: report.range, columnCount: pdfHeaders.length });
    const headerRow = detailsSheet.getRow(4);
    pdfHeaders.forEach((h, idx) => (headerRow.getCell(idx + 1).value = h));
    styleHeaderRow(headerRow, pdfHeaders.length);
    applySheetChrome(detailsSheet, { headerRow: 4, headerColumnCount: pdfHeaders.length, freezeRow: 4 });
    setPrintSetup(detailsSheet, { landscape: true });

    report.jobs.forEach((job, idx) => {
        const row = detailsSheet.getRow(idx + 5);
        row.getCell(1).value = job.created_at ? asExcelLocalDate(job.created_at) : null;
        row.getCell(1).numFmt = "dd/mm/yyyy";
        row.getCell(2).value = job.updated_at ? asExcelLocalDate(job.updated_at) : null;
        row.getCell(2).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(3).value = job.status_changed_at ? asExcelLocalDate(job.status_changed_at) : null;
        row.getCell(3).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(4).value = job.invoice_date ? asExcelLocalDate(job.invoice_date) : null;
        row.getCell(4).numFmt = "dd/mm/yyyy";
        row.getCell(5).value = job.description || "—";
        row.getCell(5).alignment = { wrapText: true, vertical: "top" };
        row.getCell(6).value = job.customer_name || "Walk-in";
        row.getCell(7).value = job.plate || "—";
        row.getCell(8).value = job.job_status || "";
        statusChip(row.getCell(8), job.job_status || "");
        row.getCell(9).value = job.invoice_no || "—";
        row.getCell(10).value = job.final_total || 0;
        row.getCell(10).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    detailsSheet.getColumn(1).width = 12;
    detailsSheet.getColumn(2).width = 18;
    detailsSheet.getColumn(3).width = 18;
    detailsSheet.getColumn(4).width = 12;
    detailsSheet.getColumn(5).width = 40;
    detailsSheet.getColumn(6).width = 22;
    detailsSheet.getColumn(7).width = 12;
    detailsSheet.getColumn(8).width = 12;
    detailsSheet.getColumn(9).width = 16;
    detailsSheet.getColumn(10).width = 14;
    addTotalsRow(detailsSheet, {
        labelColumn: 9,
        valueColumn: 10,
        startRow: 5,
        endRow: report.jobs.length + 4,
        currency: true,
    });

    // Raw sheet (keep all useful fields)
    const rawSheet = workbook.addWorksheet("Job Raw");
    const rawHeaders = [
        "ID",
        "Created",
        "Updated",
        "Status Changed",
        "Description",
        "Category",
        "Customer",
        "Plate",
        "Status",
        "Invoice Date",
        "Invoice No",
        "Invoice Status",
        "Amount",
    ];
    addSheetBanner(rawSheet, { reportTitle: "JOB SUMMARY REPORT (RAW)", range: report.range, columnCount: rawHeaders.length });
    const rawHeaderRow = rawSheet.getRow(4);
    rawHeaders.forEach((h, idx) => (rawHeaderRow.getCell(idx + 1).value = h));
    styleHeaderRow(rawHeaderRow, rawHeaders.length);
    applySheetChrome(rawSheet, { headerRow: 4, headerColumnCount: rawHeaders.length, freezeRow: 4 });
    setPrintSetup(rawSheet, { landscape: true });

    report.jobs.forEach((job, idx) => {
        const row = rawSheet.getRow(idx + 5);
        row.getCell(1).value = job.id;
        row.getCell(2).value = job.created_at ? asExcelLocalDate(job.created_at) : null;
        row.getCell(2).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(3).value = job.updated_at ? asExcelLocalDate(job.updated_at) : null;
        row.getCell(3).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(4).value = job.status_changed_at ? asExcelLocalDate(job.status_changed_at) : null;
        row.getCell(4).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(5).value = job.description || "";
        row.getCell(5).alignment = { wrapText: true, vertical: "top" };
        row.getCell(6).value = job.category || "";
        row.getCell(7).value = job.customer_name || "";
        row.getCell(8).value = job.plate || "";
        row.getCell(9).value = job.job_status || "";
        row.getCell(10).value = job.invoice_date ? asExcelLocalDate(job.invoice_date) : null;
        row.getCell(10).numFmt = "dd/mm/yyyy";
        row.getCell(11).value = job.invoice_no || "";
        row.getCell(12).value = job.payment_status || "";
        statusChip(row.getCell(12), job.payment_status || "");
        row.getCell(13).value = job.final_total || 0;
        row.getCell(13).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 18;
    rawSheet.getColumn(3).width = 18;
    rawSheet.getColumn(4).width = 18;
    rawSheet.getColumn(5).width = 40;
    rawSheet.getColumn(6).width = 18;
    rawSheet.getColumn(7).width = 22;
    rawSheet.getColumn(8).width = 12;
    rawSheet.getColumn(9).width = 12;
    rawSheet.getColumn(10).width = 12;
    rawSheet.getColumn(11).width = 16;
    rawSheet.getColumn(12).width = 14;
    rawSheet.getColumn(13).width = 14;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(applyTableBorders);
    
    // Open the workbook on the full-detail sheet (so it's not "only summary" when opened)
    workbook.views = [{ activeTab: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderInventoryExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    setWorkbookMeta(workbook);
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    addSheetBanner(summarySheet, { reportTitle: "INVENTORY REPORT • SUMMARY", range: report.range, columnCount: 5 });
    
    // Totals section (starts after banner)
    let row = 5;
    summarySheet.getRow(row).getCell(1).value = "Total Items";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.totals.itemCount;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };
    
    row++;
    summarySheet.getRow(row).getCell(1).value = "Low Stock Items";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = report.totals.lowStockCount;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };
    
    // Top Usage Items
    row += 2;
    summarySheet.getRow(row).getCell(1).value = "Top Usage Items";
    summarySheet.getRow(row).getCell(1).font = { size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    summarySheet.getRow(row).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    summarySheet.mergeCells(`A${row}:E${row}`);
    
    row++;
    const usageHeader = summarySheet.getRow(row);
    usageHeader.getCell(1).value = "Item Name";
    usageHeader.getCell(2).value = "Type";
    usageHeader.getCell(3).value = "Quantity";
    usageHeader.getCell(4).value = "Used";
    usageHeader.getCell(5).value = "Status";
    usageHeader.font = { bold: true };
    usageHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe2e8f0" } };
    
    report.mostUsed.forEach((item, idx) => {
        row++;
        const dataRow = summarySheet.getRow(row);
        dataRow.getCell(1).value = item.name;
        dataRow.getCell(2).value = item.type || "N/A";
        dataRow.getCell(3).value = item.quantity;
        dataRow.getCell(4).value = item.total_used;
        dataRow.getCell(5).value = item.quantity <= item.reorder_level ? "Low Stock" : "OK";
        if (item.quantity <= item.reorder_level) {
            dataRow.getCell(5).font = { color: { argb: "FFFF0000" }, bold: true };
        }
        if (idx % 2 === 0) {
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(3).width = 12;
    summarySheet.getColumn(4).width = 12;
    summarySheet.getColumn(5).width = 15;
    setPrintSetup(summarySheet, { landscape: false });
    applyTableBorders(summarySheet);
    
    // Details Sheet (match Inventory PDF table: Item, Type, Qty, Unit, Unit Cost, Reorder, Used, Low, Notes)
    const detailsSheet = workbook.addWorksheet("Inventory Details");
    const pdfHeaders = [
        "Item",
        "Type",
        "Qty",
        "Unit",
        "Unit Cost",
        "Reorder",
        "Low",
        "Notes",
        "Created",
        "Updated",
    ];
    addSheetBanner(detailsSheet, { reportTitle: "INVENTORY REPORT", range: report.range, columnCount: pdfHeaders.length });
    const headerRow = detailsSheet.getRow(4);
    pdfHeaders.forEach((h, idx) => (headerRow.getCell(idx + 1).value = h));
    styleHeaderRow(headerRow, pdfHeaders.length);
    applySheetChrome(detailsSheet, { headerRow: 4, headerColumnCount: pdfHeaders.length, freezeRow: 4 });
    setPrintSetup(detailsSheet, { landscape: true });

    report.items.forEach((item, idx) => {
        const row = detailsSheet.getRow(idx + 5);
        row.getCell(1).value = item.name || "";
        row.getCell(2).value = item.type || "";
        row.getCell(3).value = item.quantity ?? 0;
        row.getCell(4).value = item.unit || "";
        row.getCell(5).value = item.unit_cost ?? null;
        // If unit_cost exists, apply currency format
        if (item.unit_cost !== null && item.unit_cost !== undefined && item.unit_cost !== "") {
            row.getCell(5).numFmt = '"LKR "#,##0.00';
        }
        row.getCell(6).value = item.reorder_level ?? 0;
        row.getCell(7).value = item.low_stock ? "Yes" : "No";
        statusChip(row.getCell(7), item.low_stock ? "unpaid" : "paid"); // red/green chip
        row.getCell(8).value = item.description || "";
        row.getCell(8).alignment = { wrapText: true, vertical: "top" };
        row.getCell(9).value = item.created_at ? asExcelLocalDate(item.created_at) : null;
        row.getCell(9).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(10).value = item.updated_at ? asExcelLocalDate(item.updated_at) : null;
        row.getCell(10).numFmt = "dd/mm/yyyy h:mm AM/PM";
        if (item.low_stock) {
            row.getCell(7).font = { color: { argb: "FFFF0000" }, bold: true };
        }
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    detailsSheet.getColumn(1).width = 34;
    detailsSheet.getColumn(2).width = 16;
    detailsSheet.getColumn(3).width = 10;
    detailsSheet.getColumn(4).width = 12;
    detailsSheet.getColumn(5).width = 14;
    detailsSheet.getColumn(6).width = 12;
    detailsSheet.getColumn(7).width = 10;
    detailsSheet.getColumn(8).width = 30;
    detailsSheet.getColumn(9).width = 18;
    detailsSheet.getColumn(10).width = 18;

    // Raw sheet (all fields)
    const rawSheet = workbook.addWorksheet("Inventory Raw");
    const rawHeaders = [
        "ID",
        "Name",
        "Type",
        "Unit",
        "Unit Cost",
        "Description",
        "Quantity",
        "Reorder Level",
        "Low Stock",
        "Created At",
        "Updated At",
    ];
    addSheetBanner(rawSheet, { reportTitle: "INVENTORY REPORT (RAW)", range: report.range, columnCount: rawHeaders.length });
    const rawHeaderRow = rawSheet.getRow(4);
    rawHeaders.forEach((h, idx) => (rawHeaderRow.getCell(idx + 1).value = h));
    styleHeaderRow(rawHeaderRow, rawHeaders.length);
    applySheetChrome(rawSheet, { headerRow: 4, headerColumnCount: rawHeaders.length, freezeRow: 4 });
    setPrintSetup(rawSheet, { landscape: true });

    report.items.forEach((item, idx) => {
        const row = rawSheet.getRow(idx + 5);
        row.getCell(1).value = item.id;
        row.getCell(2).value = item.name || "";
        row.getCell(3).value = item.type || "";
        row.getCell(4).value = item.unit || "";
        row.getCell(5).value = item.unit_cost ?? null;
        if (item.unit_cost !== null && item.unit_cost !== undefined && item.unit_cost !== "") {
            row.getCell(5).numFmt = '"LKR "#,##0.00';
        }
        row.getCell(6).value = item.description || "";
        row.getCell(7).value = item.quantity ?? 0;
        row.getCell(8).value = item.reorder_level ?? 0;
        row.getCell(9).value = item.low_stock ? "Yes" : "No";
        statusChip(row.getCell(9), item.low_stock ? "unpaid" : "paid");
        row.getCell(10).value = item.created_at ? asExcelLocalDate(item.created_at) : null;
        row.getCell(10).numFmt = "dd/mm/yyyy h:mm AM/PM";
        row.getCell(11).value = item.updated_at ? asExcelLocalDate(item.updated_at) : null;
        row.getCell(11).numFmt = "dd/mm/yyyy h:mm AM/PM";
        if (item.low_stock) {
            row.getCell(9).font = { color: { argb: "FFFF0000" }, bold: true };
        }
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 34;
    rawSheet.getColumn(3).width = 16;
    rawSheet.getColumn(4).width = 12;
    rawSheet.getColumn(5).width = 14;
    rawSheet.getColumn(6).width = 30;
    rawSheet.getColumn(7).width = 12;
    rawSheet.getColumn(8).width = 14;
    rawSheet.getColumn(9).width = 12;
    rawSheet.getColumn(10).width = 18;
    rawSheet.getColumn(11).width = 18;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(applyTableBorders);
    
    // Open the workbook on the full-detail sheet (so it's not "only summary" when opened)
    workbook.views = [{ activeTab: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderRevenueExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    setWorkbookMeta(workbook);
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    addSheetBanner(summarySheet, { reportTitle: "REVENUE REPORT • SUMMARY", range: report.range, columnCount: 3 });
    
    // (Banner already includes Period + Generated)
    // Totals section (match the PDF: Net Revenue, Invoices Total, Expenses Total)
    const invoicesTotal =
        report?.totals?.invoicesTotal ?? report?.totals?.totalRevenue ?? 0;
    const expensesTotal = report?.totals?.expensesTotal ?? 0;
    const netRevenue =
        report?.totals?.revenue ?? Number(invoicesTotal) - Number(expensesTotal);
    const invoiceCount =
        report?.totals?.invoiceCount ?? (Array.isArray(report?.invoices) ? report.invoices.length : 0);

    let row = 5;
    summarySheet.getRow(row).getCell(1).value = "Net Revenue";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = netRevenue;
    summarySheet.getRow(row).getCell(2).numFmt = CURRENCY_FMT;
    summarySheet.getRow(row).getCell(2).font = { bold: true, size: 12 };

    row++;
    summarySheet.getRow(row).getCell(1).value = "Invoices Total";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = invoicesTotal;
    summarySheet.getRow(row).getCell(2).numFmt = CURRENCY_FMT;

    row++;
    summarySheet.getRow(row).getCell(1).value = "Expenses Total";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = expensesTotal;
    summarySheet.getRow(row).getCell(2).numFmt = CURRENCY_FMT;

    row++;
    summarySheet.getRow(row).getCell(1).value = "Invoice Count";
    summarySheet.getRow(row).getCell(1).font = { bold: true };
    summarySheet.getRow(row).getCell(2).value = invoiceCount;
    
    // Payment Status Breakdown
    row += 2;
    summarySheet.getRow(row).getCell(1).value = "Payment Status Breakdown";
    summarySheet.getRow(row).getCell(1).font = { size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    summarySheet.getRow(row).getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF475569" } };
    summarySheet.mergeCells(`A${row}:C${row}`);
    
    row++;
    const statusHeader = summarySheet.getRow(row);
    statusHeader.getCell(1).value = "Status";
    statusHeader.getCell(2).value = "Count";
    statusHeader.getCell(3).value = "Total";
    statusHeader.font = { bold: true };
    statusHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe2e8f0" } };
    
    report.statuses.forEach((stat, idx) => {
        row++;
        const dataRow = summarySheet.getRow(row);
        dataRow.getCell(1).value = stat.status || "N/A";
        dataRow.getCell(2).value = stat.count;
        dataRow.getCell(3).value = stat.total || 0;
        dataRow.getCell(3).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(3).width = 18;
    setPrintSetup(summarySheet, { landscape: false });
    applyTableBorders(summarySheet);
    
    // Details Sheet: Invoices (match Revenue PDF table: Date, Invoice No, Customer, Amount, Status)
    const detailsSheet = workbook.addWorksheet("Invoices");
    
    const detailHeaders = ["Date", "Invoice No", "Customer", "Amount", "Status"];
    addSheetBanner(detailsSheet, { reportTitle: "REVENUE REPORT • INVOICES", range: report.range, columnCount: detailHeaders.length });
    const headerRow = detailsSheet.getRow(4);
    detailHeaders.forEach((h, idx) => (headerRow.getCell(idx + 1).value = h));
    styleHeaderRow(headerRow, detailHeaders.length);
    applySheetChrome(detailsSheet, { headerRow: 4, headerColumnCount: detailHeaders.length, freezeRow: 4 });
    setPrintSetup(detailsSheet, { landscape: true });
    
    report.invoices.forEach((inv, idx) => {
        const row = detailsSheet.getRow(idx + 5);
        row.getCell(1).value = inv.invoice_date ? asExcelLocalDate(inv.invoice_date) : null;
        row.getCell(1).numFmt = "dd/mm/yyyy";
        row.getCell(2).value = inv.invoice_no || "N/A";
        row.getCell(3).value = inv.customer_name || "N/A";
        row.getCell(4).value = inv.final_total || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        row.getCell(5).value = (inv.payment_status || "unpaid").toUpperCase();
        statusChip(row.getCell(5), inv.payment_status || "unpaid");
        
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    addTotalsRow(detailsSheet, {
        labelColumn: 3,
        valueColumn: 4,
        startRow: 5,
        endRow: report.invoices.length + 4,
        currency: true,
    });
    
    // Set column widths
    detailsSheet.getColumn(1).width = 12;
    detailsSheet.getColumn(2).width = 18;
    detailsSheet.getColumn(3).width = 26;
    detailsSheet.getColumn(4).width = 14;
    detailsSheet.getColumn(5).width = 12;

    // Details Sheet: Expenses (match Revenue PDF table: Date, Description, Category, Amount, Status)
    const expensesSheet = workbook.addWorksheet("Expenses");
    const expenseHeaders = ["Date", "Description", "Category", "Amount", "Status"];
    addSheetBanner(expensesSheet, { reportTitle: "REVENUE REPORT • EXPENSES", range: report.range, columnCount: expenseHeaders.length });
    const expensesHeaderRow = expensesSheet.getRow(4);
    expenseHeaders.forEach((h, idx) => (expensesHeaderRow.getCell(idx + 1).value = h));
    styleHeaderRow(expensesHeaderRow, expenseHeaders.length);
    applySheetChrome(expensesSheet, { headerRow: 4, headerColumnCount: expenseHeaders.length, freezeRow: 4 });
    setPrintSetup(expensesSheet, { landscape: true });

    (report.expenses || []).forEach((exp, idx) => {
        const row = expensesSheet.getRow(idx + 5);
        row.getCell(1).value = exp.expense_date ? asExcelLocalDate(exp.expense_date) : null;
        row.getCell(1).numFmt = "dd/mm/yyyy";
        row.getCell(2).value = exp.description || "—";
        row.getCell(2).alignment = { wrapText: true, vertical: "top" };
        row.getCell(3).value = exp.category || "Uncategorized";
        row.getCell(4).value = exp.amount || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        row.getCell(5).value = (exp.payment_status || "pending").toUpperCase();
        statusChip(row.getCell(5), exp.payment_status || "pending");

        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });
    addTotalsRow(expensesSheet, {
        labelColumn: 3,
        valueColumn: 4,
        startRow: 5,
        endRow: (report.expenses || []).length + 4,
        currency: true,
    });

    expensesSheet.getColumn(1).width = 12;
    expensesSheet.getColumn(2).width = 36;
    expensesSheet.getColumn(3).width = 20;
    expensesSheet.getColumn(4).width = 14;
    expensesSheet.getColumn(5).width = 12;

    // Raw sheets (full fields)
    const invoicesRawSheet = workbook.addWorksheet("Invoices Raw");
    const invoicesRawHeaders = ["ID", "Date", "Invoice No", "Customer", "Job Description", "Status", "Amount"];
    addSheetBanner(invoicesRawSheet, { reportTitle: "REVENUE REPORT • INVOICES (RAW)", range: report.range, columnCount: invoicesRawHeaders.length });
    const invRawHeaderRow = invoicesRawSheet.getRow(4);
    invoicesRawHeaders.forEach((h, idx) => (invRawHeaderRow.getCell(idx + 1).value = h));
    styleHeaderRow(invRawHeaderRow, invoicesRawHeaders.length);
    applySheetChrome(invoicesRawSheet, { headerRow: 4, headerColumnCount: invoicesRawHeaders.length, freezeRow: 4 });
    setPrintSetup(invoicesRawSheet, { landscape: true });

    (report.invoices || []).forEach((inv, idx) => {
        const row = invoicesRawSheet.getRow(idx + 5);
        row.getCell(1).value = inv.id ?? null;
        row.getCell(2).value = inv.invoice_date ? asExcelLocalDate(inv.invoice_date) : null;
        row.getCell(2).numFmt = "dd/mm/yyyy";
        row.getCell(3).value = inv.invoice_no || "";
        row.getCell(4).value = inv.customer_name || "";
        row.getCell(5).value = inv.job_description || "";
        row.getCell(6).value = inv.payment_status || "";
        row.getCell(7).value = inv.final_total || 0;
        row.getCell(7).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    invoicesRawSheet.getColumn(1).width = 8;
    invoicesRawSheet.getColumn(2).width = 12;
    invoicesRawSheet.getColumn(3).width = 18;
    invoicesRawSheet.getColumn(4).width = 26;
    invoicesRawSheet.getColumn(5).width = 40;
    invoicesRawSheet.getColumn(6).width = 12;
    invoicesRawSheet.getColumn(7).width = 14;

    const expensesRawSheet = workbook.addWorksheet("Expenses Raw");
    const expensesRawHeaders = ["ID", "Date", "Description", "Category", "Amount", "Payment Status", "Payment Method", "Remarks"];
    addSheetBanner(expensesRawSheet, { reportTitle: "REVENUE REPORT • EXPENSES (RAW)", range: report.range, columnCount: expensesRawHeaders.length });
    const expRawHeaderRow = expensesRawSheet.getRow(4);
    expensesRawHeaders.forEach((h, idx) => (expRawHeaderRow.getCell(idx + 1).value = h));
    styleHeaderRow(expRawHeaderRow, expensesRawHeaders.length);
    applySheetChrome(expensesRawSheet, { headerRow: 4, headerColumnCount: expensesRawHeaders.length, freezeRow: 4 });
    setPrintSetup(expensesRawSheet, { landscape: true });

    (report.expenses || []).forEach((exp, idx) => {
        const row = expensesRawSheet.getRow(idx + 5);
        row.getCell(1).value = exp.id ?? null;
        row.getCell(2).value = exp.expense_date ? asExcelLocalDate(exp.expense_date) : null;
        row.getCell(2).numFmt = "dd/mm/yyyy";
        row.getCell(3).value = exp.description || "";
        row.getCell(4).value = exp.category || "";
        row.getCell(5).value = exp.amount || 0;
        row.getCell(5).numFmt = CURRENCY_FMT;
        row.getCell(6).value = exp.payment_status || "";
        row.getCell(7).value = exp.payment_method || "";
        row.getCell(8).value = exp.remarks || "";
        row.getCell(8).alignment = { wrapText: true, vertical: "top" };
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_ALT_ROW } };
        }
    });

    expensesRawSheet.getColumn(1).width = 8;
    expensesRawSheet.getColumn(2).width = 12;
    expensesRawSheet.getColumn(3).width = 36;
    expensesRawSheet.getColumn(4).width = 20;
    expensesRawSheet.getColumn(5).width = 14;
    expensesRawSheet.getColumn(6).width = 16;
    expensesRawSheet.getColumn(7).width = 18;
    expensesRawSheet.getColumn(8).width = 30;
    
    // Add borders
    [summarySheet, detailsSheet, expensesSheet, invoicesRawSheet, expensesRawSheet].forEach(applyTableBorders);
    
    // Open the workbook on the first full-detail sheet ("Invoices") instead of Summary
    workbook.views = [{ activeTab: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

router.get("/daily", async (req, res) => {
    const { date = new Date().toISOString().slice(0, 10) } = req.query;

    try {
        const revenueRow = await getAsync(
            `
            SELECT COALESCE(SUM(final_total), 0) AS revenue
            FROM Invoices
            WHERE DATE(invoice_date) = DATE(?)
        `,
            [date]
        );

        const expenseRow = await getAsync(
            `
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM Expenses
            WHERE DATE(expense_date) = DATE(?)
        `,
            [date]
        );

        const jobsSummary = await getAsync(
            `
            SELECT
                COUNT(*) AS total_jobs,
                SUM(CASE WHEN job_status = 'Completed' THEN 1 ELSE 0 END) AS completed_jobs,
                SUM(CASE WHEN job_status = 'Pending' THEN 1 ELSE 0 END) AS pending_jobs
            FROM Jobs
            WHERE DATE(created_at) = DATE(?)
        `,
            [date]
        );

        res.json({
            date,
            revenue: revenueRow.revenue,
            expenses: expenseRow.expenses,
            net: revenueRow.revenue - expenseRow.expenses,
            jobs: jobsSummary,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/monthly", async (req, res) => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = req.query;

    try {
        const revenueRow = await getAsync(
            `
            SELECT COALESCE(SUM(final_total), 0) AS revenue
            FROM Invoices
            WHERE strftime('%m', invoice_date) = printf('%02d', ?) AND strftime('%Y', invoice_date) = ?
        `,
            [month, year]
        );

        const expenseRow = await getAsync(
            `
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM Expenses
            WHERE strftime('%m', expense_date) = printf('%02d', ?) AND strftime('%Y', expense_date) = ?
        `,
            [month, year]
        );

        const jobs = await allAsync(
            `
            SELECT job_status, COUNT(*) AS count
            FROM Jobs
            WHERE strftime('%m', created_at) = printf('%02d', ?) AND strftime('%Y', created_at) = ?
            GROUP BY job_status
        `,
            [month, year]
        );

        res.json({
            month: Number(month),
            year: Number(year),
            revenue: revenueRow.revenue,
            expenses: expenseRow.expenses,
            net: revenueRow.revenue - expenseRow.expenses,
            jobs,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/customer/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const customer = await getAsync("SELECT * FROM Customers WHERE id = ?", [id]);
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }

        const jobs = await allAsync(
            `
            SELECT Jobs.*, Vehicles.make, Vehicles.model, Vehicles.license_plate
            FROM Jobs
            LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
            WHERE Jobs.customer_id = ?
            ORDER BY Jobs.created_at DESC
        `,
            [id]
        );

        const invoices = await allAsync(
            `
            SELECT Invoices.*
            FROM Invoices
            INNER JOIN Jobs ON Jobs.id = Invoices.job_id
            WHERE Jobs.customer_id = ?
            ORDER BY invoice_date DESC
        `,
            [id]
        );

        res.json({
            customer,
            jobs,
            invoices,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/expenses", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchExpenseReport(range);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/expenses/pdf", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchExpenseReport(range);
        const buffer = await renderExpensePdf(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated PDF buffer is empty");
        }
        
        // Ensure CORS headers are set (override middleware if needed)
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=expense-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/expenses/excel", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchExpenseReport(range);
        const buffer = await renderExpenseExcel(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated Excel buffer is empty");
        }
        
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=expense-report-${range.startDate}-to-${range.endDate}.xlsx`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("Excel generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/revenue", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchRevenueReport(range);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/revenue/pdf", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchRevenueReport(range);
        const buffer = await renderRevenuePdf(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated PDF buffer is empty");
        }
        
        // Ensure CORS headers are set (override middleware if needed)
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=revenue-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        console.error("Error stack:", error.stack);
        res.status(500).json({ error: error.message });
    }
});

router.get("/revenue/excel", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchRevenueReport(range);
        const buffer = await renderRevenueExcel(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated Excel buffer is empty");
        }
        
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=revenue-report-${range.startDate}-to-${range.endDate}.xlsx`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("Excel generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/jobs", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchJobReport(range);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/jobs/pdf", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchJobReport(range);
        const buffer = await renderJobPdf(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated PDF buffer is empty");
        }
        
        // Ensure CORS headers are set (override middleware if needed)
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=job-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/jobs/excel", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchJobReport(range);
        const buffer = await renderJobExcel(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated Excel buffer is empty");
        }
        
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=job-report-${range.startDate}-to-${range.endDate}.xlsx`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("Excel generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/inventory", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchInventoryReport(range);
        res.json(report);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/inventory/pdf", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchInventoryReport(range);
        const buffer = await renderInventoryPdf(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated PDF buffer is empty");
        }
        
        // Ensure CORS headers are set (override middleware if needed)
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=inventory-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("PDF generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get("/inventory/excel", async (req, res) => {
    try {
        const range = deriveDateRange(req.query);
        const report = await fetchInventoryReport(range);
        const buffer = await renderInventoryExcel(report);
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Generated Excel buffer is empty");
        }
        
        res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=inventory-report-${range.startDate}-to-${range.endDate}.xlsx`);
        res.setHeader("Content-Length", buffer.length);
        
        res.status(200).send(buffer);
    } catch (error) {
        console.error("Excel generation error:", error);
        res.status(500).json({ error: error.message });
    }
});

const renderRevenuePdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const formatCurrency = (value) =>
            `LKR ${Number(value || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
        const formatDate = (value) => {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime())
                ? value
                : parsed.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
        };

        const setFont = ({ size = 10, bold = false, color = "#111827" } = {}) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
        };

        // Header band
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.save();
        doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 58).fill("#0f172a");
        doc.restore();
        doc.moveDown(0.2);
        setFont({ size: 22, bold: true, color: "#ffffff" });
        doc.text("Revenue Report", doc.page.margins.left + 8, doc.page.margins.top + 12);
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}`, {
            align: "left",
            lineGap: 2,
        });
        doc.text(
            `Generated: ${new Date().toLocaleDateString("en-GB", {
                year: "numeric",
                month: "short",
                day: "2-digit",
            })}`
        );
        doc.moveDown(2);

        // Summary band
        const cardWidth = (pageWidth - 12) / 3;
        const cardHeight = 74;
        const startY = doc.y;
        const drawCard = (x, title, value, caption) => {
            doc.save();
            doc.roundedRect(x, startY, cardWidth, cardHeight, 8).fill("#f8fafc");
            doc.restore();
            setFont({ size: 10, color: "#6b7280" });
            doc.text(title, x + 12, startY + 10);
            setFont({ size: 16, bold: true });
            doc.text(value, x + 12, startY + 28);
            setFont({ size: 9, color: "#6b7280" });
            doc.text(caption, x + 12, startY + 48);
        };

        drawCard(
            doc.page.margins.left,
            "Net Revenue",
            formatCurrency(report.totals.revenue),
            `Invoices - Expenses`
        );

        drawCard(
            doc.page.margins.left + cardWidth + 6,
            "Invoices Total",
            formatCurrency(report.totals.invoicesTotal),
            `${report.invoices.length} invoice${report.invoices.length === 1 ? "" : "s"}`
        );

        drawCard(
            doc.page.margins.left + (cardWidth + 6) * 2,
            "Expenses Total",
            formatCurrency(report.totals.expensesTotal),
            `${report.expenses.length} expense${report.expenses.length === 1 ? "" : "s"}`
        );

        doc.moveDown(6);

        const sectionTitle = (label) => {
            setFont({ size: 12, bold: true });
            doc.text(label, { continued: false });
            doc.moveDown(0.4);
        };

        // Invoices table
        sectionTitle("Invoices");
        if (!report.invoices.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No invoices recorded in this period.");
        } else {
            const widths = [70, 120, 140, 90, 70];
            const headers = ["Date", "Invoice No", "Customer", "Amount", "Status"];
            const startX = doc.page.margins.left;
            setFont({ size: 9, bold: true, color: "#475569" });
            headers.forEach((title, idx) => {
                const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                doc.text(title, startX + offset, doc.y, { width: widths[idx] });
            });
            doc.moveDown(0.3);
            doc.strokeColor("#e2e8f0")
                .moveTo(startX, doc.y)
                .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
                .stroke();
            doc.moveDown(0.2);
            setFont({ size: 9, color: "#111827" });
            const maxInvoiceRows = 60;
            const invoiceRows = report.invoices.slice(0, maxInvoiceRows);
            invoiceRows.forEach((entry, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [
                    formatDate(entry.invoice_date),
                    entry.invoice_no || "—",
                    entry.customer_name || "Walk-in",
                    formatCurrency(entry.final_total),
                    (entry.payment_status || "unpaid").toUpperCase(),
                ];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });

            if (report.invoices.length > maxInvoiceRows) {
                setFont({ size: 9, color: "#6b7280" });
                doc.text(`+ ${report.invoices.length - maxInvoiceRows} more invoices not shown`, startX, doc.y);
            }
        }

        doc.addPage();

        // Expenses table
        sectionTitle("Expenses");
        if (!report.expenses.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No expenses recorded in this period.");
        } else {
            const widths = [70, 170, 100, 90, 70];
            const headers = ["Date", "Description", "Category", "Amount", "Status"];
            const startX = doc.page.margins.left;
            setFont({ size: 9, bold: true, color: "#475569" });
            headers.forEach((title, idx) => {
                const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                doc.text(title, startX + offset, doc.y, { width: widths[idx] });
            });
            doc.moveDown(0.3);
            doc.strokeColor("#e2e8f0")
                .moveTo(startX, doc.y)
                .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
                .stroke();
            doc.moveDown(0.2);
            setFont({ size: 9, color: "#111827" });
            const maxExpenseRows = 60;
            const expenseRows = report.expenses.slice(0, maxExpenseRows);
            expenseRows.forEach((entry, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [
                    formatDate(entry.expense_date),
                    entry.description || "—",
                    entry.category || "Uncategorized",
                    formatCurrency(entry.amount),
                    (entry.payment_status || "pending").toUpperCase(),
                ];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });

            if (report.expenses.length > maxExpenseRows) {
                setFont({ size: 9, color: "#6b7280" });
                doc.text(`+ ${report.expenses.length - maxExpenseRows} more expenses not shown`, startX, doc.y);
            }
        }

        doc.end();
    });

// Dashboard stats endpoint
router.get("/dashboard", async (req, res) => {
    const now = new Date();
    const { month = now.getMonth() + 1, year = now.getFullYear() } = req.query;

    try {
        // Total Revenue - sum of invoice final_total for the month
        const revenueRow = await getAsync(
            `
            SELECT COALESCE(SUM(final_total), 0) AS revenue
            FROM Invoices
            WHERE strftime('%m', invoice_date) = printf('%02d', ?) AND strftime('%Y', invoice_date) = ?
        `,
            [month, year]
        );

        // Total Expenses - sum of expenses for the month
        const expenseRow = await getAsync(
            `
            SELECT COALESCE(SUM(amount), 0) AS expenses
            FROM Expenses
            WHERE strftime('%m', expense_date) = printf('%02d', ?) AND strftime('%Y', expense_date) = ?
        `,
            [month, year]
        );

        // Active Jobs - count of jobs with status 'Pending' or 'In Progress' for the month
        const activeJobsRow = await getAsync(
            `
            SELECT COUNT(*) AS count
            FROM Jobs
            WHERE job_status IN ('Pending', 'In Progress')
            AND strftime('%m', created_at) = printf('%02d', ?) AND strftime('%Y', created_at) = ?
        `,
            [month, year]
        );

        // Job Status Breakdown - count of jobs by status for the month
        const jobStatuses = await allAsync(
            `
            SELECT job_status AS status, COUNT(*) AS count
            FROM Jobs
            WHERE strftime('%m', created_at) = printf('%02d', ?) AND strftime('%Y', created_at) = ?
            GROUP BY job_status
        `,
            [month, year]
        );

        // Weekly Revenue and Expenses breakdown for the month
        // Always divide month into exactly 4 weeks
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const totalDays = lastDay.getDate();
        const daysPerWeek = Math.ceil(totalDays / 4);
        const weeks = [];
        
        for (let weekNum = 0; weekNum < 4; weekNum++) {
            const weekStart = new Date(firstDay);
            weekStart.setDate(weekStart.getDate() + (weekNum * daysPerWeek));
            
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + daysPerWeek - 1);
            
            // Ensure week end doesn't exceed last day of month
            if (weekEnd > lastDay) {
                weekEnd.setTime(lastDay.getTime());
            }
            
            const weekStartStr = weekStart.toISOString().slice(0, 10);
            const weekEndStr = weekEnd.toISOString().slice(0, 10);
            
            // Get revenue for this week
            const weekRevenue = await getAsync(
                `
                SELECT COALESCE(SUM(final_total), 0) AS total
                FROM Invoices
                WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
            `,
                [weekStartStr, weekEndStr]
            );
            
            // Get expenses for this week
            const weekExpenses = await getAsync(
                `
                SELECT COALESCE(SUM(amount), 0) AS total
                FROM Expenses
                WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
            `,
                [weekStartStr, weekEndStr]
            );
            
            weeks.push({
                week: weekNum + 1,
                weekStart: weekStartStr,
                weekEnd: weekEndStr,
                revenue: Number(weekRevenue?.total || 0),
                expenses: Number(weekExpenses?.total || 0),
            });
        }

        const totalRevenue = Number(revenueRow.revenue || 0);
        const totalExpenses = Number(expenseRow.expenses || 0);
        const netProfit = totalRevenue - totalExpenses;
        const activeJobs = Number(activeJobsRow.count || 0);

        res.json({
            month: Number(month),
            year: Number(year),
            totalRevenue,
            totalExpenses,
            netProfit,
            activeJobs,
            jobStatuses: jobStatuses.map((row) => ({
                status: row.status,
                count: Number(row.count || 0),
            })),
            weeklyData: weeks,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;