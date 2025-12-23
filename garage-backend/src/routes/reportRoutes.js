const express = require("express");
const PDFDocument = require("pdfkit");
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

const fetchRevenueReport = async (range) => {
    const invoicesTotal = await getAsync(
        `
        SELECT COALESCE(SUM(final_total), 0) AS total
        FROM Invoices
        WHERE DATE(invoice_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    const expensesTotal = await getAsync(
        `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
    `,
        [range.startDate, range.endDate]
    );

    const invoices = await allAsync(
        `
        SELECT
            Invoices.id,
            Invoices.invoice_no,
            Invoices.invoice_date,
            Invoices.final_total,
            Invoices.payment_status,
            Customers.name AS customer_name
        FROM Invoices
        LEFT JOIN Jobs ON Jobs.id = Invoices.job_id
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        WHERE DATE(Invoices.invoice_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY Invoices.invoice_date DESC, Invoices.id DESC
    `,
        [range.startDate, range.endDate]
    );

    const expenses = await allAsync(
        `
        SELECT id, description, category, amount, expense_date, payment_status
        FROM Expenses
        WHERE DATE(expense_date) BETWEEN DATE(?) AND DATE(?)
        ORDER BY expense_date DESC, id DESC
    `,
        [range.startDate, range.endDate]
    );

    const invoicesTotalAmount = Number((invoicesTotal?.total || 0).toFixed(2));
    const expensesTotalAmount = Number((expensesTotal?.total || 0).toFixed(2));
    const revenue = Number((invoicesTotalAmount - expensesTotalAmount).toFixed(2));

    return {
        range,
        totals: {
            invoicesTotal: invoicesTotalAmount,
            expensesTotal: expensesTotalAmount,
            revenue,
        },
        invoices,
        expenses,
    };
};

const renderExpensePdf = (report) =>
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
        doc.text("Expense Report", doc.page.margins.left + 8, doc.page.margins.top + 12);
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

        doc.addPage();

        // Detail table
        sectionTitle("Expense Details");

        const header = ["Date", "Description", "Category", "Amount", "Status"];
        const columnWidths = [70, 170, 100, 90, 70];
        const startX = doc.page.margins.left;
        setFont({ size: 9, bold: true, color: "#475569" });
        header.forEach((title, idx) => {
            doc.text(title, startX + columnWidths.slice(0, idx).reduce((a, b) => a + b, 0), doc.y, {
                width: columnWidths[idx],
            });
        });
        doc.moveDown(0.3);
        doc.strokeColor("#e2e8f0").moveTo(startX, doc.y).lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), doc.y).stroke();
        doc.moveDown(0.2);

        const maxRows = 120;
        const rows = report.expenses.slice(0, maxRows);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No expenses to display for the selected period.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((entry, idx) => {
                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, columnWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }
                const values = [
                    formatDate(entry.expense_date),
                    entry.description || "—",
                    entry.category || "Uncategorized",
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

        doc.end();
    });

const renderJobPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const formatDate = (value) => {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime())
                ? value
                : parsed.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
        };
        const formatCurrency = (value) =>
            `LKR ${Number(value || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            })}`;
        const setFont = ({ size = 10, bold = false, color = "#111827" } = {}) =>
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.save();
        doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 58).fill("#0f172a");
        doc.restore();
        setFont({ size: 22, bold: true, color: "#ffffff" });
        doc.text("Job Report", doc.page.margins.left + 8, doc.page.margins.top + 12);
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}`);
        doc.text(
            `Generated: ${new Date().toLocaleDateString("en-GB", {
                year: "numeric",
                month: "short",
                day: "2-digit",
            })}`
        );
        doc.moveDown(2);

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

        doc.addPage();
        sectionTitle("Job Details");
        const header = ["Created", "Job", "Customer", "Plate", "Status", "Invoice", "Amount"];
        const colWidths = [70, 130, 110, 60, 70, 70, 70];
        const startX = doc.page.margins.left;
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

        const rows = report.jobs.slice(0, 120);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No jobs to display for the selected period.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((job, idx) => {
                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, colWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }
                const values = [
                    formatDate(job.created_at),
                    job.description || "—",
                    job.customer_name || "Walk-in",
                    job.plate || "—",
                    job.job_status,
                    job.invoice_no || "—",
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

        doc.end();
    });

const renderInventoryPdf = (report) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const setFont = ({ size = 10, bold = false, color = "#111827" } = {}) =>
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        doc.save();
        doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 58).fill("#0f172a");
        doc.restore();
        setFont({ size: 22, bold: true, color: "#ffffff" });
        doc.text("Inventory Report", doc.page.margins.left + 8, doc.page.margins.top + 12);
        setFont({ size: 10, color: "#e2e8f0" });
        doc.text(`Period: ${report.range.startDate} → ${report.range.endDate}`);
        doc.text(
            `Generated: ${new Date().toLocaleDateString("en-GB", {
                year: "numeric",
                month: "short",
                day: "2-digit",
            })}`
        );
        doc.moveDown(2);

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
            report.mostUsed[0] ? report.mostUsed[0].name : "No usage",
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
                const values = [row.name, `${row.total_used}`, row.type];
                values.forEach((val, idx) => {
                    const offset = widths.slice(0, idx).reduce((a, b) => a + b, 0);
                    doc.text(val, startX + offset + 4, offsetY, { width: widths[idx] - 8 });
                });
                doc.moveDown(0.8);
            });
        }

        doc.addPage();
        sectionTitle("Inventory Details");
        const header = ["Item", "Qty", "Reorder", "Used", "Low"];
        const colWidths = [180, 60, 70, 70, 50];
        const startX = doc.page.margins.left;
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

        const rows = report.items.slice(0, 160);
        if (!rows.length) {
            setFont({ size: 10, color: "#6b7280" });
            doc.text("No inventory records found.");
        } else {
            setFont({ size: 9, color: "#0f172a" });
            rows.forEach((item, idx) => {
                const rowStartY = doc.y;
                if (idx % 2 === 0) {
                    doc.save();
                    doc.rect(startX, rowStartY - 2, colWidths.reduce((a, b) => a + b, 0), 18).fill("#f8fafc");
                    doc.restore();
                }
                const values = [
                    item.name,
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
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=revenue-report-${range.startDate}-to-${range.endDate}.pdf`);
        res.send(buffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;