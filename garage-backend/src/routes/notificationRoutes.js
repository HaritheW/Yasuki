const express = require("express");
const router = express.Router();
const db = require("../../database/db");
const { purgeOldNotifications } = require("../utils/notifications");

const allAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

const getAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

const runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

const mapNotificationRow = (row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    is_read: Boolean(row.is_read),
    created_at: row.created_at,
});

router.get("/", async (req, res) => {
    const rawLimit = typeof req.query.limit === "string" ? req.query.limit.toLowerCase() : "";
    const hasLimit =
        rawLimit && rawLimit !== "all" && rawLimit !== "unlimited" && rawLimit !== "0";
    const parsedLimit = hasLimit ? Number.parseInt(rawLimit, 10) : null;
    const limit =
        hasLimit && Number.isFinite(parsedLimit)
            ? Math.min(Math.max(parsedLimit, 1), 500)
            : null;
    const unreadParam = typeof req.query.unread === "string" ? req.query.unread.toLowerCase() : "";
    const unreadOnly = unreadParam === "1" || unreadParam === "true";

    let query = `
        SELECT id, title, message, type, is_read, created_at
        FROM Notifications
    `;
    const params = [];

    if (unreadOnly) {
        query += " WHERE is_read = 0";
    }

    query += " ORDER BY created_at DESC, id DESC";
    if (limit) {
        query += " LIMIT ?";
        params.push(limit);
    }

    try {
        const rows = await allAsync(query, params);
        res.json(rows.map(mapNotificationRow));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch("/:id/read", async (req, res) => {
    const { id } = req.params;
    try {
        const result = await runAsync(
            `
            UPDATE Notifications
            SET is_read = 1
            WHERE id = ?
        `,
            [id]
        );

        if (!result.changes) {
            return res.status(404).json({ error: "Notification not found" });
        }

        const row = await getAsync(
            `
            SELECT id, title, message, type, is_read, created_at
            FROM Notifications
            WHERE id = ?
        `,
            [id]
        );

        if (!row) {
            return res.status(404).json({ error: "Notification not found" });
        }

        res.json(mapNotificationRow(row));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.patch("/mark-all-read", async (_req, res) => {
    try {
        const result = await runAsync(
            `
            UPDATE Notifications
            SET is_read = 1
            WHERE is_read = 0
        `
        );

        res.json({ updated: result?.changes ?? 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.delete("/purge", async (_req, res) => {
    try {
        const removed = await purgeOldNotifications(60);
        res.json({ removed });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;


