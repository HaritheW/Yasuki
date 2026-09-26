const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const BRAND_RED = "#B91C1C";
const NAVY = "#1E3A5F";
const DARK = "#0F172A";
const SLATE = "#334155";
const GRAY = "#64748B";
const LIGHT = "#F8FAFC";
const CARD_BG = "#F8FAFC";
const BORDER = "#CBD5E1";
const HEADER_BG = "#1E293B";
const TOTAL_BG = "#EEF2FF";

const formatCurrency = (val) =>
    `LKR ${Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatAmount = (val) =>
    Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatQuantity = (val) =>
    Number(val ?? 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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

const cleanItemName = (itemName) => {
    if (!itemName || typeof itemName !== "string") return itemName;
    return itemName
        .replace(/\s*\(\d+(?:\.\d+)?\s*×\s*\)/gi, "")
        .replace(/\s*\(\d+(?:\.\d+)?\s*x\s*\)/gi, "")
        .trim();
};

const statusMeta = (status) => {
    const normalized = String(status ?? "unpaid").toLowerCase();
    if (normalized === "paid") return { label: "Paid", bg: "#059669", fg: "#FFFFFF" };
    if (normalized === "partial") return { label: "Partial", bg: "#D97706", fg: "#FFFFFF" };
    if (normalized === "unpaid") return { label: "Unpaid", bg: "#DC2626", fg: "#FFFFFF" };
    return {
        label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
        bg: SLATE,
        fg: "#FFFFFF",
    };
};

const createContext = (doc, invoice) => {
    const items = invoice.items ?? [];
    const charges = invoice.charges ?? [];
    const extras = invoice.extras ?? [];
    const reductions = invoice.reductions ?? [];
    const isGenuine = (i) => String(i.genuine_or_non_genuine || "").toLowerCase().trim() === "genuine";
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

    const margin = 42;
    const footerSpace = 58;
    const pageHeight = doc.page.height;
    const rowHBase = 20;
    const partsRows = Math.max(1, items.length) + 3;
    const extraRows = Math.max(1, extras.length) + 1;
    const labourRows = Math.max(1, charges.length) + 1;
    const estimatedHeight =
        margin +
        162 +
        108 +
        18 * 3 +
        rowHBase * (3 + partsRows + extraRows + labourRows) +
        12 +
        12 +
        14 +
        112 +
        48;
    const availableHeight = pageHeight - margin - footerSpace - 10;
    const fitScale = Math.min(1, Math.max(0.58, availableHeight / estimatedHeight));
    const rowH = Math.max(13, Math.round(rowHBase * fitScale));

    return {
        doc,
        invoice,
        items,
        charges,
        extras,
        reductions,
        isGenuine,
        genuineLabel: (i) => (isGenuine(i) ? "Genuine" : "Non Genuine"),
        labourTotal,
        extraTotal,
        genuineTotal,
        nonGenuineTotal,
        partsTotal,
        subtotal,
        totalReductions,
        totalDue,
        invoiceNo: invoice.invoice_no ?? `INV-${String(invoice.id).padStart(5, "0")}`,
        status: statusMeta(invoice.payment_status),
        plate,
        mileageText,
        vehicleModel: [invoice.vehicle_make, invoice.vehicle_model].filter(Boolean).join(" ") || "—",
        vehicleDetails: vehicleBits.length ? vehicleBits.join(" ") : "—",
        logoPath: path.join(__dirname, "../assets/logo.jpg"),
        brandLogosPath: path.join(__dirname, "../assets/Brand logos.png"),
        margin,
        pageWidth: doc.page.width,
        pageHeight,
        contentWidth: doc.page.width - margin * 2,
        fitScale,
        rowH,
        titleGap: Math.max(12, Math.round(18 * fitScale)),
        afterTableGap: Math.max(6, Math.round(12 * fitScale)),
        afterExtraGap: Math.max(7, Math.round(14 * fitScale)),
        afterNotesGap: Math.max(10, Math.round(20 * fitScale)),
        tableHeaderFont: Math.max(6.5, 7.5 * fitScale),
        tableFont: Math.max(6.5, 8 * fitScale),
        footerSpace,
        y: margin,
    };
};

const drawWatermark = (ctx) => {
    const { doc, logoPath, pageWidth, pageHeight } = ctx;
    if (!fs.existsSync(logoPath)) return;
    doc.save();
    doc.opacity(0.06);
    doc.image(logoPath, (pageWidth - 340) / 2, (pageHeight - 190) / 2, { width: 340 });
    doc.restore();
    doc.opacity(1);
};

const drawSectionTitle = (ctx, title) => {
    const { doc, margin, titleGap } = ctx;
    doc.rect(margin, ctx.y + 2, 3, 11).fill(NAVY);
    doc.font("Helvetica-Bold").fontSize(Math.max(8, 10 * ctx.fitScale)).fillColor(NAVY);
    doc.text(title, margin + 10, ctx.y);
    ctx.y += titleGap;
};

const drawTableHeader = (ctx, columns) => {
    const { doc, margin, contentWidth, rowH, tableHeaderFont } = ctx;
    doc.rect(margin, ctx.y, contentWidth, rowH).fill(HEADER_BG);
    doc.font("Helvetica-Bold").fontSize(tableHeaderFont).fillColor("#FFFFFF");
    const textY = ctx.y + Math.max(3, (rowH - tableHeaderFont) / 2);
    columns.forEach((col) => {
        doc.text(col.label, col.x, textY, { width: col.w, align: col.align || "left" });
    });
    ctx.y += rowH;
};

const drawTableRow = (ctx, columns, { bold = false, fill = null } = {}) => {
    const { doc, margin, contentWidth, rowH, tableFont } = ctx;
    if (fill) {
        doc.rect(margin, ctx.y, contentWidth, rowH).fill(fill);
    }
    doc.rect(margin, ctx.y, contentWidth, rowH).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(tableFont).fillColor(DARK);
    const textY = ctx.y + Math.max(3, (rowH - tableFont) / 2);
    columns.forEach((col) => {
        doc.text(String(col.text ?? ""), col.x, textY, { width: col.w, align: col.align || "left" });
    });
    ctx.y += rowH;
};

const drawInvoiceHeader = (ctx) => {
    const { doc, margin, contentWidth, pageWidth, logoPath, brandLogosPath, invoiceNo, invoice, status, fitScale } = ctx;
    const logoSize = Math.max(36, Math.round(50 * fitScale));

    if (fs.existsSync(logoPath)) {
        try {
            doc.image(logoPath, margin, ctx.y, { width: logoSize, height: logoSize });
        } catch (err) {
            console.error("Error loading company logo:", err.message);
        }
    }

    const brandX = margin + logoSize + 12;
    const brandW = contentWidth - logoSize - 12;
    doc.font("Helvetica-Bold").fontSize(15).fillColor(BRAND_RED);
    doc.text("NEW YASUKI AUTO MOTORS (PVT) Ltd.", brandX, ctx.y + 6, { width: brandW });
    doc.font("Helvetica").fontSize(8).fillColor(BRAND_RED);
    doc.text(
        "Piskal Waththa, Wilgoda, Kurunegala  |  071 844 6200  |  076 744 6200  |  yasukiauto@gmail.com",
        brandX,
        ctx.y + 28,
        { width: brandW }
    );
    ctx.y += logoSize + Math.max(5, Math.round(8 * fitScale));

    if (fs.existsSync(brandLogosPath)) {
        try {
            const brandH = Math.max(22, Math.round(30 * fitScale));
            doc.image(brandLogosPath, margin, ctx.y, { width: contentWidth, height: brandH });
            ctx.y += brandH + Math.max(6, Math.round(8 * fitScale));
        } catch (err) {
            console.error("Error loading brand logos image:", err.message);
            ctx.y += 8;
        }
    }

    doc.moveTo(margin, ctx.y).lineTo(pageWidth - margin, ctx.y).strokeColor(BRAND_RED).lineWidth(2).stroke();
    ctx.y += Math.max(8, Math.round(14 * fitScale));

    doc.font("Helvetica-Bold").fontSize(Math.max(16, 20 * fitScale)).fillColor(NAVY);
    doc.text("INVOICE", margin, ctx.y);

    const metaX = pageWidth - margin - 200;
    doc.font("Helvetica").fontSize(8).fillColor(GRAY);
    doc.text(`Invoice #: ${invoiceNo}`, metaX, ctx.y, { width: 200, align: "right" });
    doc.text(`Date: ${formatDate(invoice.invoice_date)}`, metaX, ctx.y + 12, { width: 200, align: "right" });

    const badgeW = 62;
    const badgeX = pageWidth - margin - badgeW;
    doc.roundedRect(badgeX, ctx.y + 26, badgeW, 16, 3).fill(status.bg);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(status.fg);
    doc.text(status.label, badgeX, ctx.y + 29, { width: badgeW, align: "center" });
    ctx.y += Math.max(36, Math.round(52 * fitScale));
};

const drawCustomerVehicleCard = (ctx) => {
    const { doc, margin, contentWidth, invoice, plate, mileageText, vehicleModel, vehicleDetails } = ctx;
    const gap = 12;
    const cardW = (contentWidth - gap) / 2;
    const pad = 10;
    const leftX = margin;
    const rightX = margin + cardW + gap;

    const billLines = [
        invoice.customer_name ?? "Walk-in Customer",
        invoice.customer_phone || "—",
        invoice.customer_email || "—",
        invoice.customer_address || "—",
    ];
    const vehicleLines = [
        ["Vehicle number", plate],
        ["Vehicle model", vehicleModel],
        ["Mileage", mileageText],
        ["Vehicle details", vehicleDetails],
    ];

    const leftText = billLines.join("\n");
    doc.font("Helvetica").fontSize(8);
    const leftBodyH = doc.heightOfString(leftText, { width: cardW - pad * 2 });
    const cardH = Math.max(Math.round(92 * ctx.fitScale), 28 + leftBodyH + 8);

    const drawCardShell = (x, title) => {
        doc.roundedRect(x, ctx.y, cardW, cardH, 6).fill(CARD_BG);
        doc.roundedRect(x, ctx.y, cardW, cardH, 6).strokeColor(BORDER).lineWidth(0.8).stroke();
        doc.rect(x, ctx.y, 4, cardH).fill(NAVY);
        doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY);
        doc.text(title, x + pad + 4, ctx.y + 8, { width: cardW - pad * 2 });
    };

    drawCardShell(leftX, "BILL TO");
    drawCardShell(rightX, "VEHICLE INFORMATION");

    let leftY = ctx.y + 24;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(DARK);
    doc.text(billLines[0], leftX + pad + 4, leftY, { width: cardW - pad * 2 - 4 });
    leftY += 14;
    doc.font("Helvetica").fontSize(8).fillColor(SLATE);
    billLines.slice(1).forEach((line) => {
        doc.text(line, leftX + pad + 4, leftY, { width: cardW - pad * 2 - 4 });
        leftY += 12;
    });

    let rightY = ctx.y + 24;
    vehicleLines.forEach(([label, value]) => {
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text(label, rightX + pad + 4, rightY, { width: 78 });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text(value, rightX + pad + 82, rightY - 1, { width: cardW - pad * 2 - 86 });
        rightY += 14;
    });

    ctx.y += cardH + Math.max(8, Math.round(16 * ctx.fitScale));
};

const drawLabourTable = (ctx) => {
    const { margin, contentWidth, charges, labourTotal } = ctx;
    const colNo = 48;
    const colAmt = 100;
    const colDesc = contentWidth - colNo - colAmt;

    drawSectionTitle(ctx, "WORKSHOP CHARGES");
    drawTableHeader(ctx, [
        { label: "ITEM NO.", x: margin + 6, w: colNo - 6 },
        { label: "DESCRIPTION", x: margin + colNo + 6, w: colDesc - 12 },
        { label: "AMOUNT", x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
    ]);

    if (charges.length === 0) {
        drawTableRow(ctx, [
            { text: "—", x: margin + 6, w: colNo - 6 },
            { text: "No workshop charges", x: margin + colNo + 6, w: colDesc - 12 },
            { text: formatAmount(0), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
        ]);
    } else {
        charges.forEach((entry, index) => {
            drawTableRow(ctx, [
                { text: String(index + 1), x: margin + 6, w: colNo - 6 },
                { text: cleanItemName(entry.label ?? "Charge"), x: margin + colNo + 6, w: colDesc - 12 },
                { text: formatAmount(entry.amount ?? 0), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
            ]);
        });
    }

    drawTableRow(
        ctx,
        [
            { text: "", x: margin + 6, w: colNo - 6 },
            { text: "Labour Total", x: margin + colNo + 6, w: colDesc - 12 },
            { text: formatAmount(labourTotal), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
        ],
        { bold: true, fill: TOTAL_BG }
    );
    ctx.y += ctx.afterTableGap;
};

const drawPartsTable = (ctx) => {
    const { margin, contentWidth, items, genuineLabel, genuineTotal, nonGenuineTotal, partsTotal } = ctx;
    const colNo = 40;
    const colType = 78;
    const colQty = 58;
    const colTotal = 90;
    const colDesc = contentWidth - colNo - colType - colQty - colTotal;
    const typeX = margin + colNo + colDesc;
    const qtyX = typeX + colType;
    const totalX = qtyX + colQty;

    drawSectionTitle(ctx, "WORKSHOP PARTS & MATERIALS");
    drawTableHeader(ctx, [
        { label: "IT.NO.", x: margin + 6, w: colNo - 6 },
        { label: "DESCRIPTION", x: margin + colNo + 6, w: colDesc - 12 },
        { label: "TYPE", x: typeX, w: colType, align: "center" },
        { label: "QUANTITY", x: qtyX, w: colQty, align: "right" },
        { label: "TOTAL", x: totalX, w: colTotal - 6, align: "right" },
    ]);

    if (items.length === 0) {
        drawTableRow(ctx, [
            { text: "—", x: margin + 6, w: colNo - 6 },
            { text: "No parts used", x: margin + colNo + 6, w: colDesc - 12 },
            { text: "—", x: typeX, w: colType, align: "center" },
            { text: "—", x: qtyX, w: colQty, align: "right" },
            { text: formatAmount(0), x: totalX, w: colTotal - 6, align: "right" },
        ]);
    } else {
        items.forEach((item, index) => {
            const qty = Number(item.quantity);
            const qtyVal = !isNaN(qty) && qty > 0 ? qty : 1;
            const desc = (item.item_name != null ? item.item_name : item.Item_name) ?? "Item";
            drawTableRow(ctx, [
                { text: String(index + 1), x: margin + 6, w: colNo - 6 },
                { text: cleanItemName(desc), x: margin + colNo + 6, w: colDesc - 12 },
                { text: genuineLabel(item), x: typeX, w: colType, align: "center" },
                { text: formatQuantity(qtyVal), x: qtyX, w: colQty, align: "right" },
                { text: formatAmount(item.line_total ?? 0), x: totalX, w: colTotal - 6, align: "right" },
            ]);
        });
    }

    const summaryRow = (label, amount, bold = false) =>
        drawTableRow(
            ctx,
            [
                { text: "", x: margin + 6, w: colNo - 6 },
                { text: label, x: margin + colNo + 6, w: colDesc + colType + colQty - 12, align: "right" },
                { text: formatAmount(amount), x: totalX, w: colTotal - 6, align: "right" },
            ],
            { bold, fill: TOTAL_BG }
        );

    summaryRow("Genuine Spare Parts Total", genuineTotal);
    summaryRow("Non Genuine Spare Parts Total", nonGenuineTotal);
    summaryRow("Workshop Parts & Materials Total", partsTotal, true);
    ctx.y += ctx.afterTableGap;
};

const drawExtraServicesTable = (ctx) => {
    const { margin, contentWidth, extras, extraTotal } = ctx;
    const colNo = 48;
    const colAmt = 100;
    const colDesc = contentWidth - colNo - colAmt;

    drawSectionTitle(ctx, "EXTRA");
    drawTableHeader(ctx, [
        { label: "ITEM NO.", x: margin + 6, w: colNo - 6 },
        { label: "DESCRIPTION", x: margin + colNo + 6, w: colDesc - 12 },
        { label: "AMOUNT", x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
    ]);

    if (extras.length === 0) {
        drawTableRow(ctx, [
            { text: "—", x: margin + 6, w: colNo - 6 },
            { text: "No extras", x: margin + colNo + 6, w: colDesc - 12 },
            { text: formatAmount(0), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
        ]);
    } else {
        extras.forEach((entry, index) => {
            drawTableRow(ctx, [
                { text: String(index + 1), x: margin + 6, w: colNo - 6 },
                { text: cleanItemName(entry.label ?? "Extra"), x: margin + colNo + 6, w: colDesc - 12 },
                { text: formatAmount(entry.amount ?? 0), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
            ]);
        });
    }

    drawTableRow(
        ctx,
        [
            { text: "", x: margin + 6, w: colNo - 6 },
            { text: "Extra Total", x: margin + colNo + 6, w: colDesc - 12 },
            { text: formatAmount(extraTotal), x: margin + colNo + colDesc, w: colAmt - 6, align: "right" },
        ],
        { bold: true, fill: TOTAL_BG }
    );
    ctx.y += ctx.afterExtraGap;
};

const drawNotesAndPaymentSummary = (ctx) => {
    const { doc, margin, pageWidth, contentWidth, invoice, subtotal, totalReductions, totalDue } = ctx;
    const gap = 12;
    const boxW = 240;
    const boxX = pageWidth - margin - boxW;
    const notesW = contentWidth - boxW - gap;
    const notes = String(invoice.notes ?? "").trim();
    const notesBody = notes || "—";

    doc.font("Helvetica").fontSize(8);
    const notesBodyH = doc.heightOfString(notesBody, { width: notesW - 24 });
    const boxH = Math.max(Math.round(92 * ctx.fitScale), 32 + notesBodyH);

    doc.roundedRect(margin, ctx.y, notesW, boxH, 6).fill(CARD_BG);
    doc.roundedRect(margin, ctx.y, notesW, boxH, 6).strokeColor(BORDER).lineWidth(0.8).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(NAVY);
    doc.text("NOTES", margin + 12, ctx.y + 8);
    doc.font("Helvetica").fontSize(8).fillColor(SLATE);
    doc.text(notesBody, margin + 12, ctx.y + 22, { width: notesW - 24 });

    doc.roundedRect(boxX, ctx.y, boxW, boxH, 6).fill(CARD_BG);
    doc.roundedRect(boxX, ctx.y, boxW, boxH, 6).strokeColor(BORDER).lineWidth(0.8).stroke();

    const line = (label, value, y) => {
        doc.font("Helvetica").fontSize(8).fillColor(GRAY);
        doc.text(label, boxX + 12, y, { width: 100 });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
        doc.text(value, boxX + 112, y, { width: boxW - 124, align: "right" });
    };

    line("Subtotal", formatCurrency(subtotal), ctx.y + 10);
    line("Discounts", formatCurrency(totalReductions), ctx.y + 26);

    const totalBarH = 26;
    const totalBarX = boxX + 12;
    const totalBarW = boxW - 24;
    const totalBarY = ctx.y + boxH - totalBarH - 10;
    doc.roundedRect(totalBarX, totalBarY, totalBarW, totalBarH, 4).fill(NAVY);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#E2E8F0");
    doc.text("Grand Total", totalBarX + 10, totalBarY + 8, { width: 78 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF");
    doc.text(formatCurrency(totalDue), totalBarX + 86, totalBarY + 7, {
        width: totalBarW - 98,
        align: "right",
    });

    ctx.y += boxH + ctx.afterNotesGap;
};

const drawSignatureSection = (ctx) => {
    const { doc, margin, contentWidth, fitScale } = ctx;
    const labels = ["Prepared By", "Checked By", "Approved By", "Customer Signature"];
    const colW = contentWidth / labels.length;

    labels.forEach((label, index) => {
        const x = margin + index * colW;
        const lineY = ctx.y + Math.max(16, Math.round(22 * fitScale));
        doc.moveTo(x + 6, lineY).lineTo(x + colW - 10, lineY).strokeColor(BORDER).lineWidth(0.8).stroke();
        doc.font("Helvetica").fontSize(7).fillColor(GRAY);
        doc.text(label, x + 6, lineY + 4, { width: colW - 16, align: "center" });
    });
    ctx.y += Math.max(32, Math.round(48 * fitScale));
};

const drawInvoiceFooter = (ctx) => {
    const { doc, margin, pageWidth, contentWidth, pageHeight, footerSpace } = ctx;
    const y = pageHeight - margin - footerSpace;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor(NAVY).lineWidth(1.2).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(BRAND_RED);
    doc.text("Thank you for choosing New Yasuki Auto Motors!", margin, y + 6, {
        width: contentWidth,
        align: "center",
    });
    doc.font("Helvetica").fontSize(7).fillColor(GRAY);
    doc.text("We have the best-equipped automobile accident repair center in Kurunegala Sri Lanka", margin, y + 18, {
        width: contentWidth,
        align: "center",
    });
    doc.text("Authorized dealer for: TOYOTA / NISSAN / SUZUKI / KIA / MICRO / MAHINDRA / CHERRY", margin, y + 28, {
        width: contentWidth,
        align: "center",
    });
    doc.text("Email: yasukiauto@gmail.com", margin, y + 38, { width: contentWidth, align: "center" });
};

const generateInvoicePdfBuffer = (invoice) =>
    new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 42, size: "A4" });
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        const ctx = createContext(doc, invoice);

        const decoratePage = () => {
            drawWatermark(ctx);
            drawInvoiceFooter(ctx);
        };

        decoratePage();

        drawInvoiceHeader(ctx);
        drawCustomerVehicleCard(ctx);
        drawPartsTable(ctx);
        drawExtraServicesTable(ctx);
        drawLabourTable(ctx);
        drawNotesAndPaymentSummary(ctx);
        drawSignatureSection(ctx);

        doc.end();
    });

module.exports = {
    generateInvoicePdfBuffer,
};
