const db = require("../../database/db");

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

const createNotification = async ({ title, message, type }) => {
    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedMessage = typeof message === "string" ? message.trim() : "";

    if (!trimmedTitle || !trimmedMessage) {
        return;
    }

    await runAsync(
        `
        INSERT INTO Notifications (title, message, type, created_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
    `,
        [trimmedTitle, trimmedMessage, type || null]
    );
};

const notifyLowStockIfNeeded = async (inventoryItemId) => {
    if (!inventoryItemId) return;

    const item = await getAsync(
        `
        SELECT id, name, quantity, reorder_level
        FROM InventoryItems
        WHERE id = ?
    `,
        [inventoryItemId]
    );

    if (!item) return;

    const reorderLevel = Number(item.reorder_level ?? 0);
    if (reorderLevel <= 0 && item.quantity > 0) {
        return;
    }

    if (item.quantity <= reorderLevel) {
        const identifier = `Item #${item.id}`;
        const existing = await getAsync(
            `
            SELECT id
            FROM Notifications
            WHERE type = 'low-stock'
              AND is_read = 0
              AND message LIKE ?
            LIMIT 1
        `,
            [`${identifier}%`]
        );

        if (existing) return;

        await createNotification({
            title: "Low stock warning",
            message: `${identifier} (${item.name}) low on stock (${item.quantity}).`,
            type: "low-stock",
        });
    }
};

const purgeOldNotifications = async (olderThanDays = 60) => {
    if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
        return 0;
    }

    const result = await runAsync(
        `
        DELETE FROM Notifications
        WHERE created_at < DATETIME('now', ?)
    `,
        [`-${Math.floor(olderThanDays)} days`]
    );

    return result?.changes ?? 0;
};

module.exports = {
    createNotification,
    notifyLowStockIfNeeded,
    purgeOldNotifications,
};