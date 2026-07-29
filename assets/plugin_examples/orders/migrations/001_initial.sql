CREATE TABLE IF NOT EXISTS plugin_orders_orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id       INTEGER NOT NULL,
    contact_phone    TEXT    NOT NULL,
    contact_name     TEXT    NOT NULL DEFAULT '',
    status           TEXT    NOT NULL DEFAULT 'new',
    items            TEXT    NOT NULL DEFAULT '[]',
    notes            TEXT    NOT NULL DEFAULT '',
    payment_method   TEXT    NOT NULL DEFAULT '',
    payment_status   TEXT    NOT NULL DEFAULT 'pending',
    address          TEXT    NOT NULL DEFAULT '',
    estimated_total  REAL,
    currency         TEXT    NOT NULL DEFAULT 'BRL',
    priority         TEXT    NOT NULL DEFAULT 'normal',
    source           TEXT    NOT NULL DEFAULT 'ai',
    source_msg_id    TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    closed_at        INTEGER
);
CREATE INDEX IF NOT EXISTS plugin_orders_orders_status
    ON plugin_orders_orders(status);
CREATE INDEX IF NOT EXISTS plugin_orders_orders_contact
    ON plugin_orders_orders(contact_id);
CREATE INDEX IF NOT EXISTS plugin_orders_orders_created
    ON plugin_orders_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS plugin_orders_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL,
    field       TEXT    NOT NULL,
    old_value   TEXT,
    new_value   TEXT,
    changed_by  TEXT    NOT NULL DEFAULT 'system',
    ts          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plugin_orders_history_order
    ON plugin_orders_history(order_id);
