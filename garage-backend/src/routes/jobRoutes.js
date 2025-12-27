const express = require("express");
const router = express.Router();
const db = require("../../database/db");
const { createNotification, notifyLowStockIfNeeded } = require("../utils/notifications");

const VALID_JOB_STATUSES = ["Pending", "In Progress", "Completed", "Cancelled"];
const VALID_ITEM_TYPES = ["consumable", "non-consumable", "bulk"];

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

const computeInvoiceTotals = (charges = [], reductions = []) => {
    const itemsTotal = charges.reduce((sum, item) => {
        const quantity = Number(item.quantity ?? 1);
        const unitPrice = Number(item.unit_price ?? 0);
        return sum + quantity * unitPrice;
    }, 0);

    const totalCharges = reductions
        .filter((extra) => extra.type === "charge")
        .reduce((sum, charge) => sum + Number(charge.amount ?? 0), 0);

    const totalDeductions = reductions
        .filter((extra) => extra.type === "deduction")
        .reduce((sum, deduction) => sum + Number(deduction.amount ?? 0), 0);

    const finalTotal = itemsTotal + totalCharges - totalDeductions;

    return {
        itemsTotal: Number(itemsTotal.toFixed(2)),
        totalCharges: Number(totalCharges.toFixed(2)),
        totalDeductions: Number(totalDeductions.toFixed(2)),
        finalTotal: Number(finalTotal.toFixed(2)),
    };
};

const createInvoiceForJob = async ({ jobId, charges = [], extras = [], status = "unpaid", notes = null }) => {
    const invoiceNo = await generateInvoiceNumber();
    const totals = computeInvoiceTotals(charges, extras);

    // Validate and plan inventory deductions for consumables (avoid negative stock).
    const consumableUsage = new Map();
    for (const charge of charges) {
        const inventoryId = charge?.inventory_item_id ?? null;
        const type = (charge?.type ?? "consumable").toLowerCase();
        const qty = Number(charge?.quantity ?? 1) || 0;
        if (!inventoryId || type !== "consumable" || qty <= 0) continue;
        consumableUsage.set(inventoryId, (consumableUsage.get(inventoryId) || 0) + qty);
    }

    if (consumableUsage.size) {
        for (const [inventoryId, plannedQty] of consumableUsage.entries()) {
            const item = await getAsync(
                `SELECT id, name, quantity FROM InventoryItems WHERE id = ?`,
                [inventoryId]
            );
            if (!item) {
                const notFoundError = new Error(`Inventory item ${inventoryId} not found`);
                notFoundError.status = 404;
                throw notFoundError;
            }
            const available = Number(item.quantity ?? 0);
            if (plannedQty > available) {
                const err = new Error(
                    `Insufficient stock for ${item.name || `item #${inventoryId}`}. Available ${available}, needed ${plannedQty}.`
                );
                err.status = 400;
                throw err;
            }
        }
    }

    const insertInvoiceResult = await runAsync(
        `
        INSERT INTO Invoices (
            job_id, invoice_no, invoice_date, items_total,
            total_charges, total_deductions, final_total, payment_status, notes
        )
        VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)
    `,
        [
            jobId,
            invoiceNo,
            totals.itemsTotal,
            totals.totalCharges,
            totals.totalDeductions,
            totals.finalTotal,
            status,
            notes,
        ]
    );

    const invoiceId = insertInvoiceResult.lastID;
    const consumableMovements = [];

    for (const charge of charges) {
        await runAsync(
            `
            INSERT INTO InvoiceItems (invoice_id, inventory_item_id, item_name, quantity, unit_price, line_total, type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            [
                invoiceId,
                charge.inventory_item_id ?? null,
                charge.item_name,
                charge.quantity ?? 1,
                charge.unit_price ?? 0,
                (charge.quantity ?? 1) * (charge.unit_price ?? 0),
                charge.type ?? "consumable",
            ]
        );

        const inventoryId = charge?.inventory_item_id ?? null;
        const type = (charge?.type ?? "consumable").toLowerCase();
        const qty = Number(charge?.quantity ?? 1) || 0;
        if (inventoryId && type === "consumable" && qty > 0) {
            await runAsync(
                `
                UPDATE InventoryItems
                SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `,
                [qty, inventoryId]
            );
            consumableMovements.push({
                itemId: inventoryId,
                itemName: charge.item_name || `Item #${inventoryId}`,
                quantity: qty,
            });
        }
    }

    for (const extra of extras) {
        await runAsync(
            `
            INSERT INTO InvoiceExtraItems (invoice_id, label, type, amount)
            VALUES (?, ?, ?, ?)
        `,
            [invoiceId, extra.label, extra.type, extra.amount]
        );
    }

    const invoice = await getAsync("SELECT * FROM Invoices WHERE id = ?", [invoiceId]);

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
            message: `${summary} deducted for invoice ${invoiceNo}.`,
            type: "stock-usage",
        });
    }

    return {
        ...invoice,
        charges,
        extras,
    };
};

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

const parseOptionalAmount = (value, fieldName) => {
    if (value === undefined || value === null || value === "") return null;
    return parseAmount(value, fieldName);
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

const normalizeIdArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === "") return [];
    return [value];
};

const fetchJobDetails = async (jobId) => {
    const job = await getAsync(
        `
        SELECT
            Jobs.*,
            Customers.name AS customer_name,
            Vehicles.make AS vehicle_make,
            Vehicles.model AS vehicle_model,
            Vehicles.year AS vehicle_year,
            Vehicles.license_plate AS vehicle_license_plate
        FROM Jobs
        LEFT JOIN Customers ON Customers.id = Jobs.customer_id
        LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
        WHERE Jobs.id = ?
    `,
        [jobId]
    );
    if (!job) return null;

    const vehicle = job.vehicle_id
        ? await getAsync("SELECT * FROM Vehicles WHERE id = ?", [job.vehicle_id])
        : null;

    const technicians = await allAsync(
        `
        SELECT Technicians.*
        FROM JobTechnicians
        INNER JOIN Technicians ON Technicians.id = JobTechnicians.technician_id
        WHERE JobTechnicians.job_id = ?
    `,
        [jobId]
    );

    const items = await allAsync(
        `
        SELECT JobItems.*, InventoryItems.name AS inventory_name
        FROM JobItems
        LEFT JOIN InventoryItems ON InventoryItems.id = JobItems.inventory_item_id
        WHERE JobItems.job_id = ?
    `,
        [jobId]
    );

    const invoice = await getAsync(
        `
        SELECT id, invoice_no, final_total, payment_status
        FROM Invoices
        WHERE job_id = ?
    `,
        [jobId]
    );

    return {
        ...job,
        vehicle_make: job.vehicle_make ?? (vehicle ? vehicle.make : null),
        vehicle_model: job.vehicle_model ?? (vehicle ? vehicle.model : null),
        vehicle_year: job.vehicle_year ?? (vehicle ? vehicle.year : null),
        vehicle_license_plate:
            job.vehicle_license_plate ?? (vehicle ? vehicle.license_plate : null),
        vehicle,
        technicians,
        items,
        invoice,
    };
};

const prepareJobItems = async (jobId, items = []) => {
    const preparedItems = [];

    for (const item of items) {
        const {
            inventory_item_id,
            item_name,
            item_type,
            quantity = 1,
            unit_price,
            price,
        } = item;

        if (!item_name && !inventory_item_id) {
            const validationError = new Error("Each job item requires an item_name or inventory_item_id");
            validationError.status = 400;
            throw validationError;
        }

        const normalizedQuantity = parseQuantity(quantity, "quantity");
        const normalizedUnitPrice = parseAmount(unit_price ?? price, "unit_price");
        const lineTotal = Number((normalizedQuantity * normalizedUnitPrice).toFixed(2));

        let resolvedName = item_name;
        let resolvedType = item_type;

        if (inventory_item_id) {
            const inventoryItem = await getAsync(
                "SELECT * FROM InventoryItems WHERE id = ?",
                [inventory_item_id]
            );

            if (!inventoryItem) {
                const notFoundError = new Error(`Inventory item ${inventory_item_id} not found`);
                notFoundError.status = 404;
                throw notFoundError;
            }

            resolvedName = resolvedName || inventoryItem.name;
            resolvedType = resolvedType || inventoryItem.type;
        } else {
            const fallbackType = resolvedType || "consumable";
            if (!VALID_ITEM_TYPES.includes(fallbackType)) {
                const typeError = new Error(
                    "item_type must be one of 'consumable', 'non-consumable', or 'bulk'"
                );
                typeError.status = 400;
                throw typeError;
            }
            resolvedType = fallbackType;
        }

        if (!VALID_ITEM_TYPES.includes(resolvedType)) {
            const typeError = new Error(
                "item_type must be one of 'consumable', 'non-consumable', or 'bulk'"
            );
            typeError.status = 400;
            throw typeError;
        }

        const result = await runAsync(
            `
            INSERT INTO JobItems (job_id, inventory_item_id, item_name, item_type, quantity, unit_price, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            [
                jobId,
                inventory_item_id || null,
                resolvedName,
                resolvedType,
                normalizedQuantity,
                normalizedUnitPrice,
                lineTotal,
            ]
        );

        preparedItems.push({
            id: result.lastID,
            job_id: jobId,
            inventory_item_id: inventory_item_id || null,
            item_name: resolvedName,
            item_type: resolvedType,
            quantity: normalizedQuantity,
            unit_price: normalizedUnitPrice,
            line_total: lineTotal,
        });
    }

    return preparedItems;
};

const prepareInvoicePayloadFromJob = async (jobId, jobMeta = {}) => {
    const charges = await allAsync(
        `
        SELECT
            inventory_item_id,
            item_name,
            quantity,
            unit_price,
            line_total,
            item_type
        FROM JobItems
        WHERE job_id = ?
    `,
        [jobId]
    );

    let meta = jobMeta;
    if (meta.initial_amount === undefined || meta.advance_amount === undefined) {
        const snapshot = await getAsync(
            `
            SELECT initial_amount, advance_amount
            FROM Jobs
            WHERE id = ?
        `,
            [jobId]
        );
        meta = snapshot || {};
    }

    const extras = [];
    if (meta.advance_amount && Number(meta.advance_amount) > 0) {
        extras.push({ label: "Advance", amount: Number(meta.advance_amount), type: "deduction" });
    }

    return {
        charges: charges.map((item) => {
            const quantity = Number(item.quantity ?? 1) || 1;
            const unitPriceRaw = item.unit_price ?? (item.line_total ?? 0) / quantity;
            const unitPrice = Number(unitPriceRaw) || 0;
            const lineTotal = Number(item.line_total ?? quantity * unitPrice) || quantity * unitPrice;
            return {
                inventory_item_id: item.inventory_item_id,
                item_name: item.item_name,
                quantity,
                unit_price: unitPrice,
                line_total: lineTotal,
                type: item.item_type ?? "consumable",
            };
        }),
        extras,
    };
};

// Create job
router.post("/", async (req, res) => {
    const {
        customer_id,
        vehicle_id,
        vehicle,
        description,
        notes,
        initial_amount,
        advance_amount,
        mileage,
        job_status = "Pending",
        technician_ids = [],
        items = [],
        category,
    } = req.body;

    if (!customer_id || !description) {
        return res.status(400).json({ error: "customer_id and description are required" });
    }

    if (!VALID_JOB_STATUSES.includes(job_status)) {
        return res.status(400).json({ error: "Invalid job status value" });
    }

    try {
        await runAsync("BEGIN TRANSACTION");

        let resolvedVehicleId = vehicle_id || null;
        if (!resolvedVehicleId && vehicle) {
            const { make, model, year, license_plate } = vehicle;
            if (!make || !model) {
                throw new Error("Vehicle make and model are required when creating a new vehicle");
            }
            const vehicleResult = await runAsync(
                `
                INSERT INTO Vehicles (customer_id, make, model, year, license_plate)
                VALUES (?, ?, ?, ?, ?)
            `,
                [customer_id, make, model, year, license_plate]
            );
            resolvedVehicleId = vehicleResult.lastID;
        }

        const initialAmount = parseOptionalAmount(initial_amount, "initial_amount");
        const advanceAmount = parseOptionalAmount(advance_amount, "advance_amount");
        const mileageValue = parseOptionalAmount(mileage, "mileage");
        const normalizedCategory =
            typeof category === "string" && category.trim().length
                ? category.trim().slice(0, 100)
                : null;

        const jobResult = await runAsync(
            `
            INSERT INTO Jobs (
                customer_id,
                vehicle_id,
                description,
                notes,
                category,
                initial_amount,
                advance_amount,
                mileage,
                job_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
                customer_id,
                resolvedVehicleId,
                description,
                notes,
                normalizedCategory,
                initialAmount,
                advanceAmount,
                mileageValue,
                job_status,
            ]
        );

        const jobId = jobResult.lastID;

        const technicianIds = normalizeIdArray(technician_ids);

        for (const technicianId of technicianIds) {
            await runAsync(
                `
                INSERT INTO JobTechnicians (job_id, technician_id)
                VALUES (?, ?)
            `,
                [jobId, technicianId]
            );
        }

        await prepareJobItems(jobId, items);

        await runAsync("COMMIT");

        await createNotification({
            title: "Job created",
            message: `Job #${jobId} created for customer #${customer_id}.`,
            type: "job",
        });

        const jobDetails = await fetchJobDetails(jobId);
        res.status(201).json(jobDetails);
    } catch (error) {
        try {
            await runAsync("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError.message);
        }
        console.error("Create job error:", error.message);
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: error.message });
    }
});

// List jobs with filters
router.get("/", async (req, res) => {
    const { status, startDate, endDate, customerId } = req.query;
    const clauses = [];
    const params = [];

    if (status && VALID_JOB_STATUSES.includes(status)) {
        clauses.push("job_status = ?");
        params.push(status);
    }

    if (startDate) {
        clauses.push("DATE(created_at) >= DATE(?)");
        params.push(startDate);
    }

    if (endDate) {
        clauses.push("DATE(created_at) <= DATE(?)");
        params.push(endDate);
    }

    if (customerId) {
        clauses.push("customer_id = ?");
        params.push(customerId);
    }

    const whereClause = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";

    try {
        const jobs = await allAsync(
            `
            SELECT
                Jobs.*,
                Customers.name AS customer_name,
                Vehicles.make AS vehicle_make,
                Vehicles.model AS vehicle_model,
                Vehicles.year AS vehicle_year,
                Vehicles.license_plate AS vehicle_license_plate
            FROM Jobs
            LEFT JOIN Customers ON Customers.id = Jobs.customer_id
            LEFT JOIN Vehicles ON Vehicles.id = Jobs.vehicle_id
            ${whereClause}
            ORDER BY Jobs.created_at DESC
        `,
            params
        );

        if (!jobs.length) {
            return res.json([]);
        }

        const jobIds = jobs.map((job) => job.id);
        const placeholders = jobIds.map(() => "?").join(", ");

        const technicianRows = await allAsync(
            `
            SELECT
                JobTechnicians.job_id,
                Technicians.id,
                Technicians.name,
                Technicians.status
            FROM JobTechnicians
            INNER JOIN Technicians ON Technicians.id = JobTechnicians.technician_id
            WHERE JobTechnicians.job_id IN (${placeholders})
            ORDER BY Technicians.name ASC
        `,
            jobIds
        );

        const techniciansByJob = technicianRows.reduce((acc, row) => {
            if (!acc[row.job_id]) {
                acc[row.job_id] = [];
            }
            acc[row.job_id].push({
                id: row.id,
                name: row.name,
                status: row.status,
            });
            return acc;
        }, {});

        const jobsWithTechnicians = jobs.map((job) => ({
            ...job,
            technicians: techniciansByJob[job.id] ?? [],
        }));

        res.json(jobsWithTechnicians);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get job by ID
router.get("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const jobDetails = await fetchJobDetails(id);
        if (!jobDetails) {
            return res.status(404).json({ error: "Job not found" });
        }
        res.json(jobDetails);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update job
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const {
        job_status,
        notes,
        description,
        initial_amount,
        advance_amount,
        mileage,
        technician_ids,
        items,
        create_invoice,
        category,
    } = req.body;

    if (job_status && !VALID_JOB_STATUSES.includes(job_status)) {
        return res.status(400).json({ error: "Invalid job status value" });
    }

    try {
        const existingJob = await fetchJobDetails(id);
        if (!existingJob) {
            return res.status(404).json({ error: "Job not found" });
        }

        await runAsync("BEGIN TRANSACTION");

        const nextStatus =
            job_status !== undefined ? job_status : existingJob.job_status;
        const statusChanged = nextStatus !== existingJob.job_status;
        const nextNotes = notes !== undefined ? notes : existingJob.notes;
        const categoryProvided = Object.prototype.hasOwnProperty.call(req.body, "category");
        const nextCategory = categoryProvided
            ? typeof category === "string" && category.trim().length
                ? category.trim().slice(0, 100)
                : null
            : existingJob.category;
        const descriptionProvided = Object.prototype.hasOwnProperty.call(req.body, "description");
        let nextDescription = existingJob.description;
        if (descriptionProvided) {
            const trimmedDescription = typeof description === "string" ? description.trim() : "";
            if (!trimmedDescription) {
                await runAsync("ROLLBACK");
                return res
                    .status(400)
                    .json({ error: "Description is required when updating a job." });
            }
            nextDescription = trimmedDescription;
        }

        const initialAmountProvided = Object.prototype.hasOwnProperty.call(
            req.body,
            "initial_amount"
        );
        const advanceAmountProvided = Object.prototype.hasOwnProperty.call(
            req.body,
            "advance_amount"
        );

        const nextInitialAmount = initialAmountProvided
            ? parseOptionalAmount(initial_amount, "initial_amount")
            : existingJob.initial_amount;
        const nextAdvanceAmount = advanceAmountProvided
            ? parseOptionalAmount(advance_amount, "advance_amount")
            : existingJob.advance_amount;

        const mileageProvided = Object.prototype.hasOwnProperty.call(req.body, "mileage");
        const nextMileage = mileageProvided
            ? parseOptionalAmount(mileage, "mileage")
            : existingJob.mileage;

        if (technician_ids !== undefined) {
            const technicianIds = normalizeIdArray(technician_ids);
            await runAsync("DELETE FROM JobTechnicians WHERE job_id = ?", [id]);
            for (const technicianId of technicianIds) {
                await runAsync(
                    `
                    INSERT INTO JobTechnicians (job_id, technician_id)
                    VALUES (?, ?)
                `,
                    [id, technicianId]
                );
            }
        }

        if (Array.isArray(items)) {
            await runAsync("DELETE FROM JobItems WHERE job_id = ?", [id]);
            await prepareJobItems(id, items);
        }

        let createdInvoice = null;
        if (
            create_invoice &&
            nextStatus === "Completed" &&
            !existingJob.invoice_created &&
            nextInitialAmount !== null
        ) {
            const payload = await prepareInvoicePayloadFromJob(id, {
                initial_amount: nextInitialAmount,
                advance_amount: nextAdvanceAmount,
            });
            const invoice = await createInvoiceForJob({
                jobId: id,
                charges: payload.charges,
                extras: payload.extras,
                status: "unpaid",
                notes: nextNotes,
            });
            createdInvoice = invoice;
            await runAsync("UPDATE Jobs SET invoice_created = 1 WHERE id = ?", [id]);
        }

        await runAsync(
            `
            UPDATE Jobs
            SET job_status = ?,
                notes = ?,
                description = ?,
                category = ?,
                initial_amount = ?,
                advance_amount = ?,
                mileage = ?,
                status_changed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE status_changed_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [
                nextStatus,
                nextNotes,
                nextDescription,
                nextCategory,
                nextInitialAmount,
                nextAdvanceAmount,
                nextMileage,
                statusChanged ? 1 : 0,
                id,
            ]
        );

        await runAsync("COMMIT");

        if (statusChanged) {
            await createNotification({
                title: "Job status updated",
                message: `Job #${id} marked as ${job_status}.`,
                type: "job-status",
            });
        }

        const jobDetails = await fetchJobDetails(id);
        const responseBody = {
            ...jobDetails,
        };
        if (createdInvoice) {
            responseBody.invoice = createdInvoice;
        }
        res.json(responseBody);
    } catch (error) {
        try {
            await runAsync("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback failed:", rollbackError.message);
        }
        console.error("Update job error:", error.message);
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: error.message });
    }
});

// Delete job
router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const existingJob = await fetchJobDetails(id);
        if (!existingJob) {
            return res.status(404).json({ error: "Job not found" });
        }

        await runAsync("BEGIN TRANSACTION");
        await runAsync("DELETE FROM JobItems WHERE job_id = ?", [id]);
        await runAsync("DELETE FROM JobTechnicians WHERE job_id = ?", [id]);
        await runAsync("DELETE FROM Jobs WHERE id = ?", [id]);

        await runAsync("COMMIT");
        res.json({ message: "Job deleted" });
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

// Get invoice for job
router.get("/:id/invoice", async (req, res) => {
    const { id } = req.params;

    try {
        const invoice = await getAsync(
            `
            SELECT * FROM Invoices WHERE job_id = ?
        `,
            [id]
        );
        if (!invoice) {
            return res.status(404).json({ error: "No invoice for this job" });
        }

        const items = await allAsync(
            `
            SELECT * FROM InvoiceItems WHERE invoice_id = ?
        `,
            [invoice.id]
        );

        const extras = await allAsync(
            `
            SELECT id, label, type, amount
            FROM InvoiceExtraItems
            WHERE invoice_id = ?
            ORDER BY id ASC
        `,
            [invoice.id]
        );

        res.json({
            ...invoice,
            items,
            charges: extras.filter((entry) => entry.type === "charge"),
            reductions: extras.filter((entry) => entry.type === "deduction"),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

