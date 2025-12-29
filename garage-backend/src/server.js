require("dotenv").config();
const express = require("express");
const app = express();
const customerRoutes = require("./routes/customerRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const technicianRoutes = require("./routes/technicianRoutes");
const jobRoutes = require("./routes/jobRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const reportRoutes = require("./routes/reportRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const { purgeOldNotifications } = require("./utils/notifications");

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";
const ALLOWED_METHODS = "GET,POST,PUT,DELETE,PATCH,OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.header("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.json());

// Debug endpoint (no secrets) to verify SMTP env values are loaded correctly.
// Only enabled when NODE_ENV !== "production".
app.get("/debug/smtp", (req, res) => {
    if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
        return res.sendStatus(404);
    }

    res.json({
        SMTP_HOST: process.env.SMTP_HOST || null,
        SMTP_PORT: process.env.SMTP_PORT || null,
        SMTP_SECURE: process.env.SMTP_SECURE || null,
        SMTP_USER: process.env.SMTP_USER || null,
        MAIL_FROM: process.env.MAIL_FROM || null,
        SMTP_PASS_SET: Boolean(process.env.SMTP_PASS && process.env.SMTP_PASS.trim().length > 0),
    });
});

// Routes
app.use("/customers", customerRoutes);
app.use("/vehicles", vehicleRoutes);
app.use("/technicians", technicianRoutes);
app.use("/jobs", jobRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/invoices", invoiceRoutes);
app.use("/expenses", expenseRoutes);
app.use("/suppliers", supplierRoutes);
app.use("/reports", reportRoutes);
app.use("/notifications", notificationRoutes);

const NOTIFICATION_RETENTION_DAYS = 60;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const scheduleNotificationPurge = () => {
    const purge = async () => {
        try {
            const removed = await purgeOldNotifications(NOTIFICATION_RETENTION_DAYS);
            if (removed > 0) {
                console.log(`Purged ${removed} notifications older than ${NOTIFICATION_RETENTION_DAYS} days`);
            }
        } catch (error) {
            console.error("Notification purge failed:", error.message);
        }
    };

    purge();
    setInterval(purge, ONE_DAY_MS);
};

scheduleNotificationPurge();

// Start server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
