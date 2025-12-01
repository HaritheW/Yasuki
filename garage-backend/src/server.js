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

const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "*";
const ALLOWED_METHODS = "GET,POST,PUT,DELETE,OPTIONS";
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

// Start server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
