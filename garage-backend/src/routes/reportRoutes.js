const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
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

    // If explicit startDate and endDate are provided, use them (most accurate)
    const explicitStart = normalizeDateString(query.startDate || query.from);
    const explicitEnd = normalizeDateString(query.endDate || query.to);
    
    if (explicitStart && explicitEnd) {
        let label = `Custom ${explicitStart} → ${explicitEnd}`;
        
        // Generate appropriate label based on timeframe
        if (timeframe === "daily") {
            label = `Daily • ${explicitStart}`;
        } else if (timeframe === "monthly") {
            const startDate = new Date(explicitStart);
            const endDate = new Date(explicitEnd);
            const startMonth = startDate.getMonth() + 1;
            const startYear = startDate.getFullYear();
            const endMonth = endDate.getMonth() + 1;
            const endYear = endDate.getFullYear();
            
            if (startMonth === endMonth && startYear === endYear) {
                label = `Month ${pad2(startMonth)}/${startYear}`;
            } else {
                label = `${pad2(startMonth)}/${startYear} → ${pad2(endMonth)}/${endYear}`;
            }
        } else if (timeframe === "yearly") {
            const year = new Date(explicitStart).getFullYear();
            label = `Year ${year}`;
        }
        
        return {
            startDate: explicitStart,
            endDate: explicitEnd,
            label,
        };
    }

    // Fallback to timeframe-specific logic if explicit dates not provided
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
        const fallbackEnd = today.toISOString().slice(0, 10);
        const fallbackStart = new Date(today);
        fallbackStart.setDate(fallbackStart.getDate() - 29);

        return {
            startDate: explicitStart || fallbackStart.toISOString().slice(0, 10),
            endDate: explicitEnd || fallbackEnd,
            label: `Custom ${explicitStart || "N/A"} → ${explicitEnd || "N/A"}`,
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
        SELECT id, description, category, amount, expense_date, payment_status, payment_method, remarks
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
            Jobs.category,
            Customers.name AS customer_name,
            Vehicles.license_plate AS plate,
            Invoices.invoice_no,
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
    // Get base revenue (final_total) - this already has advances deducted
    const summary = await getAsync(
        `
        SELECT
            COALESCE(SUM(final_total), 0) AS baseRevenue,
            COUNT(*) AS invoiceCount,
            COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN final_total ELSE 0 END), 0) AS paidRevenue,
            COALESCE(SUM(CASE WHEN payment_status = 'partial' THEN final_total ELSE 0 END), 0) AS partialRevenue,
            COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN final_total ELSE 0 END), 0) AS unpaidRevenue
        FROM Invoices
        WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    // Get total advances for invoices in the date range
    const advancesRow = await getAsync(
        `
        SELECT COALESCE(SUM(InvoiceExtraItems.amount), 0) AS advances
        FROM InvoiceExtraItems
        INNER JOIN Invoices ON InvoiceExtraItems.invoice_id = Invoices.id
        WHERE InvoiceExtraItems.type = 'deduction' 
        AND LOWER(InvoiceExtraItems.label) = 'advance'
        AND DATE(Invoices.invoice_date) BETWEEN DATE(?) AND DATE(?)
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
        SELECT id, description, category, amount, expense_date, payment_status, payment_method, remarks
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY expense_date DESC, id DESC
    `,
        [range.startDate, range.endDate]
    );

    const baseRevenue = Number(summary?.baseRevenue || 0);
    const advances = Number(advancesRow?.advances || 0);
    const totalRevenue = baseRevenue + advances; // Total Revenue including advances (matching dashboard)
    const invoiceCount = Number(summary?.invoiceCount || 0);
    const paidRevenue = Number(summary?.paidRevenue || 0);
    const partialRevenue = Number(summary?.partialRevenue || 0);
    const unpaidRevenue = Number(summary?.unpaidRevenue || 0);
    const expensesTotalAmount = Number((expensesTotal?.total || 0).toFixed(2));
    // Net Profit = Total Revenue (including advances) - All Expenses (matching dashboard)
    const netProfit = Number((totalRevenue - expensesTotalAmount).toFixed(2));

    return {
        range,
        totals: {
            baseRevenue: Number(baseRevenue.toFixed(2)),
            advances: Number(advances.toFixed(2)),
            totalRevenue: Number(totalRevenue.toFixed(2)),
            invoicesTotal: Number(totalRevenue.toFixed(2)), // Alias for backward compatibility
            invoiceCount,
            averageInvoice: invoiceCount ? Number((totalRevenue / invoiceCount).toFixed(2)) : 0,
            paidRevenue: Number(paidRevenue.toFixed(2)),
            partialRevenue: Number(partialRevenue.toFixed(2)),
            unpaidRevenue: Number(unpaidRevenue.toFixed(2)),
            expensesTotal: expensesTotalAmount,
            netProfit: netProfit,
            revenue: netProfit, // Alias for backward compatibility
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
            InventoryItems.quantity,
            InventoryItems.reorder_level,
            COALESCE(usage_summary.total_used, 0) AS total_used,
            CASE WHEN InventoryItems.quantity <= InventoryItems.reorder_level THEN 1 ELSE 0 END AS low_stock
        FROM InventoryItems
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
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        const pdf = attachPdfScaffold(doc, { title: "Expense Report", range: report.range });

        const setFont = pdf.setFont;
        const formatCurrency = pdfFormatCurrency;
        const formatDate = pdfFormatDate;
        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

        doc.moveDown(0.4);

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
            "Total Expenses",
            formatCurrency(report.totals.totalAmount),
            `${report.expenses.length} entr${report.expenses.length === 1 ? "y" : "ies"}`
        );

        const topCategory = report.categories[0];
        drawCard(
            doc.page.margins.left + cardWidth + 6,
            "Top Category",
            topCategory ? `${topCategory.category}` : "None",
            topCategory ? formatCurrency(topCategory.total) : "No spend recorded"
        );

        const paidStatus = report.statuses.find((s) => (s.status || "").toLowerCase() === "paid");
        drawCard(
            doc.page.margins.left + (cardWidth + 6) * 2,
            "Paid Amount",
            paidStatus ? formatCurrency(paidStatus.total) : formatCurrency(0),
            paidStatus ? `${paidStatus.count} paid` : "No paid expenses"
        );

        doc.moveDown(6);

        const sectionTitle = (label) => {
            setFont({ size: 12, bold: true });
            doc.text(label, { continued: false });
            doc.moveDown(0.4);
        };

        // Categories table
        sectionTitle("By Category");
        if (!report.categories.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No expenses recorded in this period.");
        } else {
            const widths = [200, 80, 80];
            const headers = ["Category", "Entries", "Amount"];
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
            report.categories.forEach((row, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [
                    row.category,
                    `${row.count}`,
                    formatCurrency(row.total),
                ];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });
        }

        doc.moveDown(0.8);

        // Status table
        sectionTitle("By Payment Status");
        if (!report.statuses.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No payment status data for this period.");
        } else {
            const widths = [140, 80, 100];
            const headers = ["Status", "Entries", "Amount"];
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
            report.statuses.forEach((row, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [
                    (row.status || "unspecified").toUpperCase(),
                    `${row.count}`,
                    formatCurrency(row.total),
                ];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });
        }

        pdf.addPage();

        // Detail table
        sectionTitle("Expense Details");

        const header = ["Date", "Description", "Category", "Amount", "Status"];
        const columnWidths = [70, 170, 100, 90, 70];
        const startX = doc.page.margins.left;
        const drawExpenseHeader = () => {
        setFont({ size: 9, bold: true, color: "#475569" });
        header.forEach((title, idx) => {
            doc.text(title, startX + columnWidths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                width: columnWidths[idx],
            });
        });
        doc.moveDown(0.3);
            doc.strokeColor("#e2e8f0")
                .moveTo(startX, doc.y)
                .lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), doc.y)
                .stroke();
        doc.moveDown(0.2);
            setFont({ size: 9, color: "#0f172a" });
        };

        drawExpenseHeader();

        const maxRows = 250;
        const rows = report.expenses.slice(0, maxRows);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No expenses to display for the selected period.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((entry, idx) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 28;
                if (doc.y > bottomLimit) {
                    pdf.addPage();
                    sectionTitle("Expense Details (continued)");
                    drawExpenseHeader();
                }

                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, columnWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }

                const values = [
                    formatDate(entry.expense_date),
                    pdfTruncate(entry.description || "—", 32),
                    pdfTruncate(entry.category || "Uncategorized", 18),
                    formatCurrency(entry.amount),
                    (entry.payment_status || "pending").toUpperCase(),
                ];
                values.forEach((val, colIdx) => {
                    doc.text(val, startX + columnWidths.slice(0, colIdx).reduce((a, b) => a + b, 0) + 4, rowStartY, {
                        width: columnWidths[colIdx] - 8,
                    });
                });
                doc.moveDown(0.8);
            });

            if (report.expenses.length > maxRows) {
                setFont({ size: 9, color: "#6b7280" });
                doc.text(`+ ${report.expenses.length - maxRows} more entries not shown`, startX, doc.y);
            }
        }

        pdf.finish();
    });

const renderJobPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        const pdf = attachPdfScaffold(doc, { title: "Job Report", range: report.range });
        const setFont = pdf.setFont;
        const formatDate = pdfFormatDate;
        const formatCurrency = pdfFormatCurrency;

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.moveDown(0.4);

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

        const completed = report.statuses.find((s) => s.status === "Completed");
        const pending = report.statuses.find((s) => s.status === "Pending");

        drawCard(
            doc.page.margins.left,
            "Total Jobs",
            `${report.totals.jobCount}`,
            `${completed ? `${completed.count} completed • ` : ""}${report.range.startDate} → ${report.range.endDate}`
        );
        drawCard(
            doc.page.margins.left + cardWidth + 6,
            "Revenue (invoiced)",
            formatCurrency(report.totals.completedRevenue),
            "Sum of invoices in period"
        );
        drawCard(
            doc.page.margins.left + (cardWidth + 6) * 2,
            "Pending Jobs",
            pending ? `${pending.count}` : "0",
            pending ? "Awaiting completion" : "No pending jobs"
        );

        doc.moveDown(6);
        const sectionTitle = (label) => {
            setFont({ size: 12, bold: true });
            doc.text(label);
            doc.moveDown(0.4);
        };

        // Status table
        sectionTitle("By Status");
        if (!report.statuses.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No jobs recorded in this period.");
        } else {
            const widths = [200, 80];
            const startX = doc.page.margins.left;
            setFont({ size: 9, bold: true, color: "#475569" });
            ["Status", "Count"].forEach((title, idx) => {
                doc.text(title, startX + widths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                    width: widths[idx],
                });
            });
            doc.moveDown(0.3);
            doc.strokeColor("#e2e8f0")
                .moveTo(startX, doc.y)
                .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
                .stroke();
            doc.moveDown(0.2);
            setFont({ size: 9, color: "#111827" });
            report.statuses.forEach((row, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [row.status, `${row.count}`];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });
        }

        pdf.addPage();
        sectionTitle("Job Details");
        const header = ["Created", "Job", "Customer", "Plate", "Status", "Invoice", "Amount"];
        const colWidths = [70, 130, 110, 60, 70, 70, 70];
        const startX = doc.page.margins.left;
        const drawJobHeader = () => {
        setFont({ size: 9, bold: true, color: "#475569" });
        header.forEach((title, idx) => {
            doc.text(title, startX + colWidths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                width: colWidths[idx],
            });
        });
        doc.moveDown(0.3);
        doc.strokeColor("#e2e8f0")
            .moveTo(startX, doc.y)
            .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y)
            .stroke();
        doc.moveDown(0.2);
            setFont({ size: 9, color: "#0f172a" });
        };

        drawJobHeader();

        const rows = report.jobs.slice(0, 250);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No jobs to display for the selected period.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((job, idx) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 28;
                if (doc.y > bottomLimit) {
                    pdf.addPage();
                    sectionTitle("Job Details (continued)");
                    drawJobHeader();
                }

                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, colWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }
                const values = [
                    formatDate(job.created_at),
                    pdfTruncate(job.description || "—", 26),
                    pdfTruncate(job.customer_name || "Walk-in", 18),
                    pdfTruncate(job.plate || "—", 10),
                    job.job_status,
                    pdfTruncate(job.invoice_no || "—", 12),
                    job.final_total ? formatCurrency(job.final_total) : "—",
                ];
                values.forEach((val, colIdx) => {
                    doc.text(val, startX + colWidths.slice(0, colIdx).reduce((a, b) => a + b, 0) + 4, rowStartY, {
                        width: colWidths[colIdx] - 8,
                    });
                });
                doc.moveDown(0.8);
            });

            if (report.jobs.length > rows.length) {
                setFont({ size: 9, color: "#6b7280" });
                doc.text(`+ ${report.jobs.length - rows.length} more entries not shown`, startX, doc.y);
            }
        }

        pdf.finish();
    });

const renderInventoryPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        const pdf = attachPdfScaffold(doc, { title: "Inventory Report", range: report.range });
        const setFont = pdf.setFont;

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.moveDown(0.4);

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
            "Total Items",
            `${report.totals.itemCount}`,
            "Tracked inventory records"
        );
        drawCard(
            doc.page.margins.left + cardWidth + 6,
            "Low Stock",
            `${report.totals.lowStockCount}`,
            report.lowStock.length ? "Needs reorder" : "All above reorder level"
        );
        drawCard(
            doc.page.margins.left + (cardWidth + 6) * 2,
            "Most Used",
            report.mostUsed[0] ? pdfTruncate(report.mostUsed[0].name, 18) : "No usage",
            report.mostUsed[0] ? `Used ${report.mostUsed[0].total_used}` : "No usage this period"
        );

        doc.moveDown(6);
        const sectionTitle = (label) => {
            setFont({ size: 12, bold: true });
            doc.text(label);
            doc.moveDown(0.4);
        };

        // Most used
        sectionTitle("Top Usage");
        if (!report.mostUsed.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No usage recorded in this period.");
        } else {
            const widths = [200, 80, 80];
            const startX = doc.page.margins.left;
            setFont({ size: 9, bold: true, color: "#475569" });
            ["Item", "Used", "Type"].forEach((title, idx) => {
                doc.text(title, startX + widths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                    width: widths[idx],
                });
            });
            doc.moveDown(0.3);
            doc.strokeColor("#e2e8f0")
                .moveTo(startX, doc.y)
                .lineTo(startX + widths.reduce((a, b) => a + b, 0), doc.y)
                .stroke();
            doc.moveDown(0.2);
            setFont({ size: 9, color: "#111827" });
            report.mostUsed.forEach((row, index) => {
                const offsetY = doc.y;
                const bg = index % 2 === 0 ? "#f8fafc" : "#ffffff";
                doc.save();
                doc.rect(startX, offsetY - 2, widths.reduce((a, b) => a + b, 0), 18).fill(bg);
                doc.restore();
                const values = [pdfTruncate(row.name, 34), `${row.total_used}`, pdfTruncate(row.type, 14)];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });
        }

        pdf.addPage();
        sectionTitle("Inventory Details");
        const header = ["Item", "Qty", "Reorder", "Used", "Low"];
        const colWidths = [180, 60, 70, 70, 50];
        const startX = doc.page.margins.left;
        const drawInventoryHeader = () => {
        setFont({ size: 9, bold: true, color: "#475569" });
        header.forEach((title, idx) => {
            doc.text(title, startX + colWidths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                width: colWidths[idx],
            });
        });
        doc.moveDown(0.3);
        doc.strokeColor("#e2e8f0")
            .moveTo(startX, doc.y)
            .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), doc.y)
            .stroke();
        doc.moveDown(0.2);
            setFont({ size: 9, color: "#0f172a" });
        };

        drawInventoryHeader();

        const rows = report.items.slice(0, 300);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No inventory records found.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((item, idx) => {
                const bottomLimit = doc.page.height - doc.page.margins.bottom - 28;
                if (doc.y > bottomLimit) {
                    pdf.addPage();
                    sectionTitle("Inventory Details (continued)");
                    drawInventoryHeader();
                }

                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, colWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }
                const values = [
                    pdfTruncate(item.name, 40),
                    `${item.quantity}`,
                    `${item.reorder_level}`,
                    `${item.total_used}`,
                    item.low_stock ? "Yes" : "No",
                ];
                values.forEach((val, colIdx) => {
                    doc.text(val, startX + colWidths.slice(0, colIdx).reduce((a, b) => a + b, 0) + 4, rowStartY, {
                        width: colWidths[colIdx] - 8,
                    });
                });
                doc.moveDown(0.8);
            });

            if (report.items.length > rows.length) {
                setFont({ size: 9, color: "#6b7280" });
                doc.text(`+ ${report.items.length - rows.length} more entries not shown`, startX, doc.y);
            }
        }

        pdf.finish();
    });


// Excel Generation Functions with Professional Formatting
const renderExpenseExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    
    // Title
    const titleRow = summarySheet.getRow(1);
    titleRow.getCell(1).value = "Expense Report Summary";
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
    titleRow.height = 25;
    summarySheet.mergeCells("A1:C1");
    
    // Period info
    summarySheet.getRow(3).getCell(1).value = "Period:";
    summarySheet.getRow(3).getCell(2).value = `${report.range.startDate} to ${report.range.endDate}`;
    summarySheet.getRow(4).getCell(1).value = "Generated:";
    summarySheet.getRow(4).getCell(2).value = new Date().toISOString().slice(0, 10);
    
    // Totals section
    let row = 6;
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
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
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
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 15;
    summarySheet.getColumn(3).width = 18;
    
    // Details Sheet (match Expense PDF table)
    const detailsSheet = workbook.addWorksheet("Expense Details");
    const pdfHeaders = ["Date", "Description", "Category", "Amount", "Status"];
    const headerRow = detailsSheet.getRow(1);
    pdfHeaders.forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 20;

    report.expenses.forEach((exp, idx) => {
        const row = detailsSheet.getRow(idx + 2);
        row.getCell(1).value = exp.expense_date ? new Date(exp.expense_date) : null;
        row.getCell(1).numFmt = "mm/dd/yyyy";
        row.getCell(2).value = exp.description || "—";
        row.getCell(3).value = exp.category || "Uncategorized";
        row.getCell(4).value = exp.amount || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        row.getCell(5).value = (exp.payment_status || "pending").toUpperCase();

        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    detailsSheet.getColumn(1).width = 12;
    detailsSheet.getColumn(2).width = 36;
    detailsSheet.getColumn(3).width = 20;
    detailsSheet.getColumn(4).width = 14;
    detailsSheet.getColumn(5).width = 12;

    // Raw sheet (all fields)
    const rawSheet = workbook.addWorksheet("Expense Raw");
    const rawHeaders = ["ID", "Date", "Description", "Category", "Amount", "Payment Status", "Payment Method", "Remarks"];
    const rawHeaderRow = rawSheet.getRow(1);
    rawHeaders.forEach((header, idx) => {
        const cell = rawHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    rawHeaderRow.height = 20;

    report.expenses.forEach((exp, idx) => {
        const row = rawSheet.getRow(idx + 2);
        row.getCell(1).value = exp.id;
        row.getCell(2).value = exp.expense_date ? new Date(exp.expense_date) : null;
        row.getCell(2).numFmt = "mm/dd/yyyy";
        row.getCell(3).value = exp.description || "";
        row.getCell(4).value = exp.category || "Uncategorized";
        row.getCell(5).value = exp.amount || 0;
        row.getCell(5).numFmt = CURRENCY_FMT;
        row.getCell(6).value = exp.payment_status || "";
        row.getCell(7).value = exp.payment_method || "";
        row.getCell(8).value = exp.remarks || "";
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 12;
    rawSheet.getColumn(3).width = 36;
    rawSheet.getColumn(4).width = 20;
    rawSheet.getColumn(5).width = 14;
    rawSheet.getColumn(6).width = 16;
    rawSheet.getColumn(7).width = 18;
    rawSheet.getColumn(8).width = 30;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(sheet => {
        sheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderJobExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    
    // Title
    const titleRow = summarySheet.getRow(1);
    titleRow.getCell(1).value = "Job Report Summary";
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
    titleRow.height = 25;
    summarySheet.mergeCells("A1:C1");
    
    // Period info
    summarySheet.getRow(3).getCell(1).value = "Period:";
    summarySheet.getRow(3).getCell(2).value = `${report.range.startDate} to ${report.range.endDate}`;
    summarySheet.getRow(4).getCell(1).value = "Generated:";
    summarySheet.getRow(4).getCell(2).value = new Date().toISOString().slice(0, 10);
    
    // Totals section
    let row = 6;
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
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 15;
    
    // Details Sheet (match Job PDF table: Created, Job, Customer, Plate, Status, Invoice, Amount)
    const detailsSheet = workbook.addWorksheet("Job Details");
    const pdfHeaders = ["Created", "Job", "Customer", "Plate", "Status", "Invoice", "Amount"];
    const headerRow = detailsSheet.getRow(1);
    pdfHeaders.forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 20;

    report.jobs.forEach((job, idx) => {
        const row = detailsSheet.getRow(idx + 2);
        row.getCell(1).value = job.created_at ? new Date(job.created_at) : null;
        row.getCell(1).numFmt = "mm/dd/yyyy";
        row.getCell(2).value = job.description || "—";
        row.getCell(3).value = job.customer_name || "Walk-in";
        row.getCell(4).value = job.plate || "—";
        row.getCell(5).value = job.job_status || "";
        row.getCell(6).value = job.invoice_no || "—";
        row.getCell(7).value = job.final_total || 0;
        row.getCell(7).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    detailsSheet.getColumn(1).width = 12;
    detailsSheet.getColumn(2).width = 40;
    detailsSheet.getColumn(3).width = 22;
    detailsSheet.getColumn(4).width = 12;
    detailsSheet.getColumn(5).width = 12;
    detailsSheet.getColumn(6).width = 16;
    detailsSheet.getColumn(7).width = 14;

    // Raw sheet (keep all useful fields)
    const rawSheet = workbook.addWorksheet("Job Raw");
    const rawHeaders = ["ID", "Created", "Description", "Category", "Customer", "Plate", "Status", "Invoice No", "Invoice Status", "Amount"];
    const rawHeaderRow = rawSheet.getRow(1);
    rawHeaders.forEach((header, idx) => {
        const cell = rawHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    rawHeaderRow.height = 20;

    report.jobs.forEach((job, idx) => {
        const row = rawSheet.getRow(idx + 2);
        row.getCell(1).value = job.id;
        row.getCell(2).value = job.created_at ? new Date(job.created_at) : null;
        row.getCell(2).numFmt = "mm/dd/yyyy";
        row.getCell(3).value = job.description || "";
        row.getCell(4).value = job.category || "";
        row.getCell(5).value = job.customer_name || "";
        row.getCell(6).value = job.plate || "";
        row.getCell(7).value = job.job_status || "";
        row.getCell(8).value = job.invoice_no || "";
        row.getCell(9).value = job.payment_status || "";
        row.getCell(10).value = job.final_total || 0;
        row.getCell(10).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 12;
    rawSheet.getColumn(3).width = 40;
    rawSheet.getColumn(4).width = 18;
    rawSheet.getColumn(5).width = 22;
    rawSheet.getColumn(6).width = 12;
    rawSheet.getColumn(7).width = 12;
    rawSheet.getColumn(8).width = 16;
    rawSheet.getColumn(9).width = 14;
    rawSheet.getColumn(10).width = 14;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(sheet => {
        sheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderInventoryExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    
    // Title
    const titleRow = summarySheet.getRow(1);
    titleRow.getCell(1).value = "Inventory Report Summary";
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
    titleRow.height = 25;
    summarySheet.mergeCells("A1:E1");
    
    // Period info
    summarySheet.getRow(3).getCell(1).value = "Period:";
    summarySheet.getRow(3).getCell(2).value = `${report.range.startDate} to ${report.range.endDate}`;
    summarySheet.getRow(4).getCell(1).value = "Generated:";
    summarySheet.getRow(4).getCell(2).value = new Date().toISOString().slice(0, 10);
    
    // Totals section
    let row = 6;
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
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(3).width = 12;
    summarySheet.getColumn(4).width = 12;
    summarySheet.getColumn(5).width = 15;
    
    // Details Sheet (match Inventory PDF table: Item, Qty, Reorder, Used, Low)
    const detailsSheet = workbook.addWorksheet("Inventory Details");
    const pdfHeaders = ["Item", "Qty", "Reorder", "Used", "Low"];
    const headerRow = detailsSheet.getRow(1);
    pdfHeaders.forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 20;

    report.items.forEach((item, idx) => {
        const row = detailsSheet.getRow(idx + 2);
        row.getCell(1).value = item.name || "";
        row.getCell(2).value = item.quantity ?? 0;
        row.getCell(3).value = item.reorder_level ?? 0;
        row.getCell(4).value = item.total_used ?? 0;
        row.getCell(5).value = item.low_stock ? "Yes" : "No";
        if (item.low_stock) {
            row.getCell(5).font = { color: { argb: "FFFF0000" }, bold: true };
        }
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    detailsSheet.getColumn(1).width = 34;
    detailsSheet.getColumn(2).width = 12;
    detailsSheet.getColumn(3).width = 12;
    detailsSheet.getColumn(4).width = 12;
    detailsSheet.getColumn(5).width = 10;

    // Raw sheet (all fields)
    const rawSheet = workbook.addWorksheet("Inventory Raw");
    const rawHeaders = ["ID", "Name", "Type", "Quantity", "Reorder Level", "Used", "Low Stock"];
    const rawHeaderRow = rawSheet.getRow(1);
    rawHeaders.forEach((header, idx) => {
        const cell = rawHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    rawHeaderRow.height = 20;

    report.items.forEach((item, idx) => {
        const row = rawSheet.getRow(idx + 2);
        row.getCell(1).value = item.id;
        row.getCell(2).value = item.name || "";
        row.getCell(3).value = item.type || "";
        row.getCell(4).value = item.quantity ?? 0;
        row.getCell(5).value = item.reorder_level ?? 0;
        row.getCell(6).value = item.total_used ?? 0;
        row.getCell(7).value = item.low_stock ? "Yes" : "No";
        if (item.low_stock) {
            row.getCell(7).font = { color: { argb: "FFFF0000" }, bold: true };
        }
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    rawSheet.getColumn(1).width = 8;
    rawSheet.getColumn(2).width = 34;
    rawSheet.getColumn(3).width = 16;
    rawSheet.getColumn(4).width = 12;
    rawSheet.getColumn(5).width = 14;
    rawSheet.getColumn(6).width = 12;
    rawSheet.getColumn(7).width = 12;
    
    // Add borders
    [summarySheet, detailsSheet, rawSheet].forEach(sheet => {
        sheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });
    });
    
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
};

const renderRevenueExcel = async (report) => {
    const workbook = new ExcelJS.Workbook();
    const CURRENCY_FMT = '"LKR "#,##0.00';
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet("Summary");
    
    // Title
    const titleRow = summarySheet.getRow(1);
    titleRow.getCell(1).value = "Revenue Report Summary";
    titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
    titleRow.height = 25;
    summarySheet.mergeCells("A1:C1");
    
    // Period info
    summarySheet.getRow(3).getCell(1).value = "Period:";
    summarySheet.getRow(3).getCell(2).value = `${report.range.startDate} to ${report.range.endDate}`;
    summarySheet.getRow(4).getCell(1).value = "Generated:";
    summarySheet.getRow(4).getCell(2).value = new Date().toISOString().slice(0, 10);
    
    // Totals section (match the PDF: Net Revenue, Invoices Total, Expenses Total)
    const invoicesTotal =
        report?.totals?.invoicesTotal ?? report?.totals?.totalRevenue ?? 0;
    const expensesTotal = report?.totals?.expensesTotal ?? 0;
    const netRevenue =
        report?.totals?.revenue ?? Number(invoicesTotal) - Number(expensesTotal);
    const invoiceCount =
        report?.totals?.invoiceCount ?? (Array.isArray(report?.invoices) ? report.invoices.length : 0);

    let row = 6;
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
            dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });
    
    // Set column widths
    summarySheet.getColumn(1).width = 25;
    summarySheet.getColumn(2).width = 18;
    summarySheet.getColumn(3).width = 18;
    
    // Details Sheet: Invoices (match Revenue PDF table: Date, Invoice No, Customer, Amount, Status)
    const detailsSheet = workbook.addWorksheet("Invoices");
    
    const detailHeaders = ["Date", "Invoice No", "Customer", "Amount", "Status"];
    const headerRow = detailsSheet.getRow(1);
    detailHeaders.forEach((header, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    headerRow.height = 20;
    
    report.invoices.forEach((inv, idx) => {
        const row = detailsSheet.getRow(idx + 2);
        row.getCell(1).value = inv.invoice_date ? new Date(inv.invoice_date) : null;
        row.getCell(1).numFmt = "mm/dd/yyyy";
        row.getCell(2).value = inv.invoice_no || "N/A";
        row.getCell(3).value = inv.customer_name || "N/A";
        row.getCell(4).value = inv.final_total || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        row.getCell(5).value = (inv.payment_status || "unpaid").toUpperCase();
        
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
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
    const expensesHeaderRow = expensesSheet.getRow(1);
    expenseHeaders.forEach((header, idx) => {
        const cell = expensesHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    expensesHeaderRow.height = 20;

    (report.expenses || []).forEach((exp, idx) => {
        const row = expensesSheet.getRow(idx + 2);
        row.getCell(1).value = exp.expense_date ? new Date(exp.expense_date) : null;
        row.getCell(1).numFmt = "mm/dd/yyyy";
        row.getCell(2).value = exp.description || "—";
        row.getCell(3).value = exp.category || "Uncategorized";
        row.getCell(4).value = exp.amount || 0;
        row.getCell(4).numFmt = CURRENCY_FMT;
        row.getCell(5).value = (exp.payment_status || "pending").toUpperCase();

        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
    });

    expensesSheet.getColumn(1).width = 12;
    expensesSheet.getColumn(2).width = 36;
    expensesSheet.getColumn(3).width = 20;
    expensesSheet.getColumn(4).width = 14;
    expensesSheet.getColumn(5).width = 12;

    // Raw sheets (full fields)
    const invoicesRawSheet = workbook.addWorksheet("Invoices Raw");
    const invoicesRawHeaders = ["ID", "Date", "Invoice No", "Customer", "Job Description", "Status", "Amount"];
    const invRawHeaderRow = invoicesRawSheet.getRow(1);
    invoicesRawHeaders.forEach((header, idx) => {
        const cell = invRawHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    invRawHeaderRow.height = 20;

    (report.invoices || []).forEach((inv, idx) => {
        const row = invoicesRawSheet.getRow(idx + 2);
        row.getCell(1).value = inv.id ?? null;
        row.getCell(2).value = inv.invoice_date ? new Date(inv.invoice_date) : null;
        row.getCell(2).numFmt = "mm/dd/yyyy";
        row.getCell(3).value = inv.invoice_no || "";
        row.getCell(4).value = inv.customer_name || "";
        row.getCell(5).value = inv.job_description || "";
        row.getCell(6).value = inv.payment_status || "";
        row.getCell(7).value = inv.final_total || 0;
        row.getCell(7).numFmt = CURRENCY_FMT;
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
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
    const expRawHeaderRow = expensesRawSheet.getRow(1);
    expensesRawHeaders.forEach((header, idx) => {
        const cell = expRawHeaderRow.getCell(idx + 1);
        cell.value = header;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0f172a" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    expRawHeaderRow.height = 20;

    (report.expenses || []).forEach((exp, idx) => {
        const row = expensesRawSheet.getRow(idx + 2);
        row.getCell(1).value = exp.id ?? null;
        row.getCell(2).value = exp.expense_date ? new Date(exp.expense_date) : null;
        row.getCell(2).numFmt = "mm/dd/yyyy";
        row.getCell(3).value = exp.description || "";
        row.getCell(4).value = exp.category || "";
        row.getCell(5).value = exp.amount || 0;
        row.getCell(5).numFmt = CURRENCY_FMT;
        row.getCell(6).value = exp.payment_status || "";
        row.getCell(7).value = exp.payment_method || "";
        row.getCell(8).value = exp.remarks || "";
        if (idx % 2 === 0) {
            row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
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
    [summarySheet, detailsSheet, expensesSheet, invoicesRawSheet, expensesRawSheet].forEach(sheet => {
        sheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" },
                };
            });
        });
    });
    
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
        res.setHeader("Content-Disposition", `attachment; filename=profit-report-${range.startDate}-to-${range.endDate}.pdf`);
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

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        
        // Get values from report
        const netProfit = report.totals.netProfit ?? report.totals.revenue ?? 0;
        const totalRevenue = report.totals.totalRevenue ?? report.totals.invoicesTotal ?? 0;
        const baseRevenue = report.totals.baseRevenue ?? report.totals.invoicesTotal ?? 0;
        const advances = report.totals.advances ?? 0;
        const expensesTotal = report.totals.expensesTotal ?? 0;
        const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(2) : "0.00";

        // Header band with gradient effect
        doc.save();
        doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 70).fill("#0f172a");
        doc.restore();
        doc.moveDown(0.2);
        setFont({ size: 24, bold: true, color: "#ffffff" });
        doc.text("Profit Report", doc.page.margins.left + 8, doc.page.margins.top + 15);
        setFont({ size: 11, color: "#e2e8f0" });
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}`, {
            align: "left",
            lineGap: 2,
        });
        doc.text(
            `Generated: ${new Date().toLocaleDateString("en-GB", {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            })}`
        );
        doc.moveDown(2.5);

        // Net Profit - Prominent card (larger)
        const netProfitCardWidth = pageWidth;
        const netProfitCardHeight = 90;
        const netProfitY = doc.y;
        const profitColor = netProfit >= 0 ? "#10b981" : "#ef4444";
        doc.save();
        doc.roundedRect(doc.page.margins.left, netProfitY, netProfitCardWidth, netProfitCardHeight, 10)
            .fill(netProfit >= 0 ? "#ecfdf5" : "#fef2f2");
        doc.restore();
        setFont({ size: 11, color: "#6b7280" });
        doc.text("NET PROFIT", doc.page.margins.left + 16, netProfitY + 12);
        setFont({ size: 28, bold: true, color: profitColor });
        doc.text(formatCurrency(netProfit), doc.page.margins.left + 16, netProfitY + 30);
        setFont({ size: 10, color: "#6b7280" });
        doc.text(`Profit Margin: ${profitMargin}% • Total Revenue - Total Expenses`, doc.page.margins.left + 16, netProfitY + 65);
        doc.moveDown(6);

        // Summary cards row
        const cardWidth = (pageWidth - 16) / 4;
        const cardHeight = 80;
        const startY = doc.y;
        
        const drawCard = (x, title, value, caption, color = "#111827") => {
            doc.save();
            doc.roundedRect(x, startY, cardWidth, cardHeight, 8).fill("#f8fafc");
            doc.restore();
            setFont({ size: 9, color: "#6b7280" });
            doc.text(title, x + 10, startY + 8, { width: cardWidth - 20 });
            setFont({ size: 14, bold: true, color: color });
            doc.text(value, x + 10, startY + 24, { width: cardWidth - 20 });
            setFont({ size: 8, color: "#6b7280" });
            doc.text(caption, x + 10, startY + 45, { width: cardWidth - 20 });
        };

        drawCard(
            doc.page.margins.left,
            "Total Revenue",
            formatCurrency(totalRevenue),
            `Including advances`,
            "#10b981"
        );

        drawCard(
            doc.page.margins.left + cardWidth + 4,
            "Base Revenue",
            formatCurrency(baseRevenue),
            `From invoices`,
            "#111827"
        );

        drawCard(
            doc.page.margins.left + (cardWidth + 4) * 2,
            "Advances",
            formatCurrency(advances),
            advances > 0 ? `Received` : `None`,
            "#059669"
        );

        drawCard(
            doc.page.margins.left + (cardWidth + 4) * 3,
            "Total Expenses",
            formatCurrency(expensesTotal),
            `${report.expenses.length} expense${report.expenses.length === 1 ? "" : "s"}`,
            "#ef4444"
        );

        doc.moveDown(6.5);

        // Revenue Breakdown Section
        const sectionTitle = (label) => {
            setFont({ size: 13, bold: true, color: "#0f172a" });
            doc.text(label, { continued: false });
            doc.moveDown(0.5);
        };

        // Revenue Breakdown
        sectionTitle("Revenue Breakdown");
        const breakdownY = doc.y;
        const breakdownWidth = pageWidth;
        const breakdownHeight = 120;
        doc.save();
        doc.roundedRect(doc.page.margins.left, breakdownY, breakdownWidth, breakdownHeight, 8)
            .fill("#f8fafc");
        doc.restore();
        
        const breakdownStartX = doc.page.margins.left + 12;
        let breakdownCurrentY = breakdownY + 12;
        
        setFont({ size: 10, color: "#475569" });
        doc.text("Base Revenue (Invoices):", breakdownStartX, breakdownCurrentY);
        setFont({ size: 11, bold: true, color: "#111827" });
        doc.text(formatCurrency(baseRevenue), breakdownStartX + 180, breakdownCurrentY);
        
        breakdownCurrentY += 20;
        if (advances > 0) {
            setFont({ size: 10, color: "#475569" });
            doc.text("Advances Received:", breakdownStartX, breakdownCurrentY);
            setFont({ size: 11, bold: true, color: "#059669" });
            doc.text(`+ ${formatCurrency(advances)}`, breakdownStartX + 180, breakdownCurrentY);
            breakdownCurrentY += 20;
        }
        
        doc.strokeColor("#cbd5e1")
            .moveTo(breakdownStartX, breakdownCurrentY)
            .lineTo(breakdownStartX + breakdownWidth - 24, breakdownCurrentY)
            .stroke();
        breakdownCurrentY += 15;
        
        setFont({ size: 11, bold: true, color: "#0f172a" });
        doc.text("Total Revenue:", breakdownStartX, breakdownCurrentY);
        setFont({ size: 14, bold: true, color: "#10b981" });
        doc.text(formatCurrency(totalRevenue), breakdownStartX + 180, breakdownCurrentY);
        
        breakdownCurrentY += 25;
        setFont({ size: 9, color: "#64748b" });
        doc.text("Payment Status Breakdown:", breakdownStartX, breakdownCurrentY);
        breakdownCurrentY += 15;
        
        if (report.statuses && report.statuses.length > 0) {
            report.statuses.forEach((status, idx) => {
                const statusX = breakdownStartX + (idx % 3) * 180;
                const statusY = breakdownCurrentY + Math.floor(idx / 3) * 18;
                setFont({ size: 9, color: "#475569" });
                doc.text(`${(status.status || "unknown").toUpperCase()}:`, statusX, statusY);
                setFont({ size: 9, bold: true, color: "#111827" });
                doc.text(
                    `${status.count} • ${formatCurrency(status.total)}`,
                    statusX + 70,
                    statusY
                );
            });
        } else {
            setFont({ size: 9, color: "#94a3b8" });
            doc.text("No payment status data available", breakdownStartX, breakdownCurrentY);
        }
        
        doc.y = breakdownY + breakdownHeight + 20;

        // Profit Calculation Section
        sectionTitle("Profit Calculation");
        const calcY = doc.y;
        const calcWidth = pageWidth;
        const calcHeight = 100;
        doc.save();
        doc.roundedRect(doc.page.margins.left, calcY, calcWidth, calcHeight, 8)
            .fill("#fef3c7");
        doc.restore();
        
        const calcStartX = doc.page.margins.left + 12;
        let calcCurrentY = calcY + 12;
        
        setFont({ size: 10, color: "#92400e" });
        doc.text("Total Revenue:", calcStartX, calcCurrentY);
        setFont({ size: 11, bold: true, color: "#10b981" });
        doc.text(formatCurrency(totalRevenue), calcStartX + 180, calcCurrentY);
        
        calcCurrentY += 20;
        setFont({ size: 10, color: "#92400e" });
        doc.text("Total Expenses:", calcStartX, calcCurrentY);
        setFont({ size: 11, bold: true, color: "#ef4444" });
        doc.text(`- ${formatCurrency(expensesTotal)}`, calcStartX + 180, calcCurrentY);
        
        calcCurrentY += 20;
        doc.strokeColor("#fbbf24")
            .lineWidth(2)
            .moveTo(calcStartX, calcCurrentY)
            .lineTo(calcStartX + calcWidth - 24, calcCurrentY)
            .stroke();
        calcCurrentY += 15;
        
        setFont({ size: 12, bold: true, color: "#92400e" });
        doc.text("Net Profit:", calcStartX, calcCurrentY);
        setFont({ size: 16, bold: true, color: profitColor });
        doc.text(formatCurrency(netProfit), calcStartX + 180, calcCurrentY);
        
        calcCurrentY += 20;
        setFont({ size: 9, color: "#92400e" });
        doc.text(`Profit Margin: ${profitMargin}%`, calcStartX, calcCurrentY);
        
        doc.y = calcY + calcHeight + 20;

        // Check if we need a new page
        if (doc.y > doc.page.height - doc.page.margins.bottom - 200) {
            doc.addPage();
        }

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

        // Final Summary Footer
        if (doc.y > doc.page.height - doc.page.margins.bottom - 120) {
            doc.addPage();
        }
        doc.moveDown(2);
        
        const footerY = doc.y;
        const footerHeight = 100;
        doc.save();
        doc.roundedRect(doc.page.margins.left, footerY, pageWidth, footerHeight, 8)
            .fill("#0f172a");
        doc.restore();
        
        const footerStartX = doc.page.margins.left + 16;
        let footerCurrentY = footerY + 16;
        
        setFont({ size: 14, bold: true, color: "#ffffff" });
        doc.text("Report Summary", footerStartX, footerCurrentY);
        footerCurrentY += 25;
        
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Net Profit:", footerStartX, footerCurrentY);
        setFont({ size: 12, bold: true, color: profitColor });
        doc.text(formatCurrency(netProfit), footerStartX + 120, footerCurrentY);
        
        footerCurrentY += 18;
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Total Revenue:", footerStartX, footerCurrentY);
        setFont({ size: 11, bold: true, color: "#10b981" });
        doc.text(formatCurrency(totalRevenue), footerStartX + 120, footerCurrentY);
        
        footerCurrentY += 18;
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Total Expenses:", footerStartX, footerCurrentY);
        setFont({ size: 11, bold: true, color: "#ef4444" });
        doc.text(formatCurrency(expensesTotal), footerStartX + 120, footerCurrentY);
        
        const footerRightX = doc.page.margins.left + pageWidth / 2 + 20;
        footerCurrentY = footerY + 16;
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Profit Margin:", footerRightX, footerCurrentY);
        setFont({ size: 12, bold: true, color: profitColor });
        doc.text(`${profitMargin}%`, footerRightX + 100, footerCurrentY);
        
        footerCurrentY += 18;
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Total Invoices:", footerRightX, footerCurrentY);
        setFont({ size: 11, bold: true, color: "#ffffff" });
        doc.text(`${report.totals.invoiceCount || report.invoices.length}`, footerRightX + 100, footerCurrentY);
        
        footerCurrentY += 18;
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text("Total Expenses Count:", footerRightX, footerCurrentY);
        setFont({ size: 11, bold: true, color: "#ffffff" });
        doc.text(`${report.expenses.length}`, footerRightX + 100, footerCurrentY);

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

        // Total Advances - sum of advance deductions for invoices in the month
        const advancesRow = await getAsync(
            `
            SELECT COALESCE(SUM(InvoiceExtraItems.amount), 0) AS advances
            FROM InvoiceExtraItems
            INNER JOIN Invoices ON InvoiceExtraItems.invoice_id = Invoices.id
            WHERE InvoiceExtraItems.type = 'deduction' 
            AND LOWER(InvoiceExtraItems.label) = 'advance'
            AND strftime('%m', Invoices.invoice_date) = printf('%02d', ?) 
            AND strftime('%Y', Invoices.invoice_date) = ?
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
            
            // Get base revenue for this week
            const weekRevenueBase = await getAsync(
                `
                SELECT COALESCE(SUM(final_total), 0) AS total
                FROM Invoices
                WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
            `,
                [weekStartStr, weekEndStr]
            );

            // Get advances for this week
            const weekAdvances = await getAsync(
                `
                SELECT COALESCE(SUM(InvoiceExtraItems.amount), 0) AS total
                FROM InvoiceExtraItems
                INNER JOIN Invoices ON InvoiceExtraItems.invoice_id = Invoices.id
                WHERE InvoiceExtraItems.type = 'deduction' 
                AND LOWER(InvoiceExtraItems.label) = 'advance'
                AND DATE(Invoices.invoice_date) BETWEEN DATE(?) AND DATE(?)
            `,
                [weekStartStr, weekEndStr]
            );

            const weekRevenue = {
                total: Number(weekRevenueBase?.total || 0) + Number(weekAdvances?.total || 0)
            };
            
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

        const baseRevenue = Number(revenueRow.revenue || 0);
        const advances = Number(advancesRow.advances || 0);
        const totalRevenue = baseRevenue + advances;
        const totalExpenses = Number(expenseRow.expenses || 0);
        // Net Profit = Total Revenue (including advances) - All Expenses
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