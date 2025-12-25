const express = require("express");
const PDFDocument = require("pdfkit");
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
            SELECT inventory_item_id, SUM(quantity) AS total_used
            FROM JobItems
            WHERE inventory_item_id IS NOT NULL
              AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
            GROUP BY inventory_item_id
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
        const doc = new PDFDocument({ margin: 40, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        // Colors
        const PRIMARY = "#B91C1C";
        const DARK = "#111827";
        const GRAY = "#6B7280";
        const LIGHT = "#F9FAFB";
        const BORDER = "#E5E7EB";
        const CHART_COLORS = ["#B91C1C", "#2563EB", "#059669", "#D97706", "#7C3AED", "#DB2777", "#0891B2", "#65A30D"];

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

        const margin = 40;
        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - margin * 2;

        // Watermark logo
        const logoPath = path.join(__dirname, "../assets/logo.jpg");
        if (fs.existsSync(logoPath)) {
                doc.save();
            doc.opacity(0.08);
            doc.image(logoPath, (pageWidth - 350) / 2, (doc.page.height - 200) / 2, { width: 350 });
                doc.restore();
            doc.opacity(1);
        }

        // Header
        doc.font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", margin, 35, { width: contentWidth, align: "center" });
        
            doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK);
        doc.text("EXPENSE REPORT", margin, doc.y, { width: contentWidth, align: "center" });
        
            doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}  |  Generated: ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })}`, { align: "center" });
        
        doc.moveDown(0.5);
        doc.moveTo(margin, doc.y).lineTo(pageWidth - margin, doc.y).strokeColor(BORDER).stroke();
        doc.moveDown(0.8);

        // Helper function to draw centered table
        const drawCenteredTable = (title, headers, widths, data, rowHeight = 16) => {
            const tableWidth = widths.reduce((a, b) => a + b, 0);
            const tableX = margin + (contentWidth - tableWidth) / 2;
            const headerHeight = 20;
            
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text(title, margin, doc.y, { width: contentWidth, align: "center" });
        doc.moveDown(0.3);
            
            const startY = doc.y;
            
            doc.rect(tableX, startY, tableWidth, headerHeight).fill(DARK);
            
            let hx = tableX;
            headers.forEach((hTitle, idx) => {
                doc.rect(hx, startY, widths[idx], headerHeight).strokeColor("#374151").lineWidth(1).stroke();
                doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
                doc.text(hTitle, hx + 4, startY + 5, { width: widths[idx] - 8 });
                hx += widths[idx];
            });
            doc.y = startY + headerHeight;
            
            data.forEach((rowData, rowIndex) => {
                const rowY = doc.y;
                
                if (rowIndex % 2 === 0) {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill(LIGHT);
        } else {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill("#ffffff");
                }
                
                let cx = tableX;
                rowData.forEach((val, colIdx) => {
                    doc.rect(cx, rowY, widths[colIdx], rowHeight).strokeColor(BORDER).lineWidth(0.5).stroke();
                    doc.font("Helvetica").fontSize(7).fillColor(DARK);
                    doc.text(val, cx + 4, rowY + 4, { width: widths[colIdx] - 8 });
                    cx += widths[colIdx];
                });
                
                doc.y = rowY + rowHeight;
            });
            
            doc.rect(tableX, startY, tableWidth, headerHeight + data.length * rowHeight).strokeColor(DARK).lineWidth(1).stroke();
            doc.moveDown(0.6);
        };

        // Expense Details table
        const maxRows = 15;
        const expenseRows = report.expenses.slice(0, maxRows);
        
        if (expenseRows.length) {
            const detailHeaders = ["Date", "Description", "Category", "Amount", "Status"];
            const detailWidths = [65, 145, 95, 80, 50];
            const detailData = expenseRows.map(entry => [
                formatDate(entry.expense_date),
                (entry.description || "—").substring(0, 24),
                (entry.category || "Uncategorized").substring(0, 14),
                formatCurrency(entry.amount),
                (entry.payment_status || "pending").substring(0, 6).toUpperCase()
            ]);
            drawCenteredTable("Expense Details", detailHeaders, detailWidths, detailData);

            if (report.expenses.length > maxRows) {
                doc.font("Helvetica").fontSize(7).fillColor(GRAY);
                doc.text(`+ ${report.expenses.length - maxRows} more entries not shown`, { align: "center" });
            }
        }

        doc.end();
    });

const renderJobPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const PRIMARY = "#B91C1C";
        const DARK = "#111827";
        const GRAY = "#6B7280";
        const LIGHT = "#F9FAFB";
        const BORDER = "#E5E7EB";
        const CHART_COLORS = ["#059669", "#D97706", "#B91C1C", "#2563EB", "#7C3AED", "#DB2777"];
        const margin = 40;
        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - margin * 2;

        const formatDate = (value) => {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
        };
        const formatCurrency = (value) => `LKR ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Professional pie chart drawing function
        // Watermark
        const logoPath = path.join(__dirname, "../assets/logo.jpg");
        if (fs.existsSync(logoPath)) {
            doc.save();
            doc.opacity(0.08);
            doc.image(logoPath, (pageWidth - 350) / 2, (doc.page.height - 200) / 2, { width: 350 });
            doc.restore();
            doc.opacity(1);
        }

        // Header
        doc.font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", margin, 35, { width: contentWidth, align: "center" });
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK);
        doc.text("JOB REPORT", margin, doc.y, { width: contentWidth, align: "center" });
        doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}  |  Generated: ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })}`, { align: "center" });
        doc.moveDown(0.5);
        doc.moveTo(margin, doc.y).lineTo(pageWidth - margin, doc.y).strokeColor(BORDER).stroke();
        doc.moveDown(0.8);

        // Helper function to draw centered table
        const drawCenteredTable = (title, headers, widths, data, rowHeight = 16) => {
            const tableWidth = widths.reduce((a, b) => a + b, 0);
            const tableX = margin + (contentWidth - tableWidth) / 2;
            const headerHeight = 20;
            
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text(title, margin, doc.y, { width: contentWidth, align: "center" });
            doc.moveDown(0.3);
            
            const startY = doc.y;
            
            doc.rect(tableX, startY, tableWidth, headerHeight).fill(DARK);
            
            let hx = tableX;
            headers.forEach((hTitle, idx) => {
                doc.rect(hx, startY, widths[idx], headerHeight).strokeColor("#374151").lineWidth(1).stroke();
                doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
                doc.text(hTitle, hx + 4, startY + 5, { width: widths[idx] - 8 });
                hx += widths[idx];
            });
            doc.y = startY + headerHeight;
            
            data.forEach((rowData, rowIndex) => {
                const rowY = doc.y;
                
                if (rowIndex % 2 === 0) {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill(LIGHT);
        } else {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill("#ffffff");
                }
                
                let cx = tableX;
                rowData.forEach((val, colIdx) => {
                    doc.rect(cx, rowY, widths[colIdx], rowHeight).strokeColor(BORDER).lineWidth(0.5).stroke();
                    doc.font("Helvetica").fontSize(7).fillColor(DARK);
                    doc.text(val, cx + 4, rowY + 4, { width: widths[colIdx] - 8 });
                    cx += widths[colIdx];
                });
                
                doc.y = rowY + rowHeight;
            });
            
            doc.rect(tableX, startY, tableWidth, headerHeight + data.length * rowHeight).strokeColor(DARK).lineWidth(1).stroke();
            doc.moveDown(0.6);
        };

        // Job Details table
        const maxRows = 15;
        const jobRows = report.jobs.slice(0, maxRows);
        
        if (jobRows.length) {
            const detailHeaders = ["Date", "Description", "Customer", "Plate", "Status", "Amount"];
            const detailWidths = [65, 130, 95, 55, 55, 70];
            const detailData = jobRows.map(job => [
                formatDate(job.created_at),
                (job.description || "—").substring(0, 20),
                (job.customer_name || "Walk-in").substring(0, 14),
                (job.plate || "—").substring(0, 8),
                job.job_status.substring(0, 8),
                job.final_total ? formatCurrency(job.final_total) : "—",
            ]);
            drawCenteredTable("Job Details", detailHeaders, detailWidths, detailData);

            if (report.jobs.length > maxRows) {
                doc.font("Helvetica").fontSize(7).fillColor(GRAY);
                doc.text(`+ ${report.jobs.length - maxRows} more entries not shown`, { align: "center" });
            }
        } else {
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text("Job Details", { align: "center" });
            doc.moveDown(0.3);
            doc.font("Helvetica").fontSize(9).fillColor(GRAY);
            doc.text("No jobs to display for this period.", { align: "center" });
        }

        doc.end();
    });

const renderInventoryPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const PRIMARY = "#B91C1C";
        const DARK = "#111827";
        const GRAY = "#6B7280";
        const LIGHT = "#F9FAFB";
        const BORDER = "#E5E7EB";
        const WARNING = "#F59E0B";
        const SUCCESS = "#059669";
        const CHART_COLORS = ["#2563EB", "#059669", "#D97706", "#B91C1C", "#7C3AED", "#DB2777"];
        const margin = 40;
        const pageWidth = doc.page.width;
        const contentWidth = pageWidth - margin * 2;

        // Watermark
        const logoPath = path.join(__dirname, "../assets/logo.jpg");
        if (fs.existsSync(logoPath)) {
                    doc.save();
            doc.opacity(0.08);
            doc.image(logoPath, (pageWidth - 350) / 2, (doc.page.height - 200) / 2, { width: 350 });
                    doc.restore();
            doc.opacity(1);
        }

        // Header
        doc.font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY);
        doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", margin, 35, { width: contentWidth, align: "center" });
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(20).fillColor(DARK);
        doc.text("INVENTORY REPORT", margin, doc.y, { width: contentWidth, align: "center" });
        doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(9).fillColor(GRAY);
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}  |  Generated: ${new Date().toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" })}`, { align: "center" });
        doc.moveDown(0.5);
        doc.moveTo(margin, doc.y).lineTo(pageWidth - margin, doc.y).strokeColor(BORDER).stroke();
        doc.moveDown(0.8);

        // Helper function to draw centered table
        const drawCenteredTable = (title, headers, widths, data, rowHeight = 16, highlightCol = -1) => {
            const tableWidth = widths.reduce((a, b) => a + b, 0);
            const tableX = margin + (contentWidth - tableWidth) / 2;
            const headerHeight = 20;
            
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text(title, margin, doc.y, { width: contentWidth, align: "center" });
            doc.moveDown(0.3);
            
            const startY = doc.y;
            
            doc.rect(tableX, startY, tableWidth, headerHeight).fill(DARK);
            
            let hx = tableX;
            headers.forEach((hTitle, idx) => {
                doc.rect(hx, startY, widths[idx], headerHeight).strokeColor("#374151").lineWidth(1).stroke();
                doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
                doc.text(hTitle, hx + 4, startY + 5, { width: widths[idx] - 8 });
                hx += widths[idx];
            });
            doc.y = startY + headerHeight;
            
            data.forEach((rowData, rowIndex) => {
                const rowY = doc.y;
                
                if (rowIndex % 2 === 0) {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill(LIGHT);
                } else {
                    doc.rect(tableX, rowY, tableWidth, rowHeight).fill("#ffffff");
                }
                
                let cx = tableX;
                rowData.forEach((val, colIdx) => {
                    doc.rect(cx, rowY, widths[colIdx], rowHeight).strokeColor(BORDER).lineWidth(0.5).stroke();
                    const isWarningCell = highlightCol === colIdx && val === "LOW";
                    doc.font("Helvetica").fontSize(7).fillColor(isWarningCell ? WARNING : DARK);
                    doc.text(val, cx + 4, rowY + 4, { width: widths[colIdx] - 8 });
                    cx += widths[colIdx];
                });
                
                doc.y = rowY + rowHeight;
            });
            
            doc.rect(tableX, startY, tableWidth, headerHeight + data.length * rowHeight).strokeColor(DARK).lineWidth(1).stroke();
            doc.moveDown(0.6);
        };

        // Inventory Details table
        const maxRows = 15;
        const inventoryRows = report.items.slice(0, maxRows);
        
        if (inventoryRows.length) {
            const detailHeaders = ["Item Name", "Qty", "Reorder", "Used", "Status"];
            const detailWidths = [175, 50, 60, 50, 50];
            const detailData = inventoryRows.map(item => [
                item.name.substring(0, 26),
                `${item.quantity}`,
                `${item.reorder_level}`,
                `${item.total_used}`,
                item.low_stock ? "LOW" : "OK"
            ]);
            drawCenteredTable("Inventory Details", detailHeaders, detailWidths, detailData, 16, 4);

            if (report.items.length > maxRows) {
                doc.font("Helvetica").fontSize(7).fillColor(GRAY);
                doc.text(`+ ${report.items.length - maxRows} more items not shown`, { align: "center" });
            }
        } else {
            doc.font("Helvetica-Bold").fontSize(10).fillColor(DARK);
            doc.text("Inventory Details", { align: "center" });
            doc.moveDown(0.3);
            doc.font("Helvetica").fontSize(9).fillColor(GRAY);
            doc.text("No inventory records found.", { align: "center" });
        }

        doc.end();
    });

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

router.get("/inventory", async (_req, res) => {
    try {
        const inventory = await allAsync(
            `
            SELECT
                InventoryItems.*,
                COALESCE(usage_summary.total_used, 0) AS total_used,
                CASE WHEN quantity <= reorder_level THEN 1 ELSE 0 END AS low_stock
            FROM InventoryItems
            LEFT JOIN (
                SELECT inventory_item_id, SUM(quantity) AS total_used
                FROM JobItems
                WHERE inventory_item_id IS NOT NULL
                GROUP BY inventory_item_id
            ) AS usage_summary ON usage_summary.inventory_item_id = InventoryItems.id
            ORDER BY InventoryItems.name ASC
        `
        );

        res.json(inventory);
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
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=expense-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.send(buffer);
    } catch (error) {
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
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=job-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.send(buffer);
    } catch (error) {
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
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=inventory-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;