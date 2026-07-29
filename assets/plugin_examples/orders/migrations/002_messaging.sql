-- Order-linked messaging: lets the operator ask the customer something
-- (missing item, substitution, price) directly from the Kanban card, without
-- opening the full chat. The reply is captured automatically (see events.py)
-- and the AI proposes an update the operator approves/dismisses.
ALTER TABLE plugin_orders_orders ADD COLUMN awaiting_reply INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plugin_orders_orders ADD COLUMN last_question TEXT;
ALTER TABLE plugin_orders_orders ADD COLUMN last_reply TEXT;
ALTER TABLE plugin_orders_orders ADD COLUMN ai_suggestion TEXT;

CREATE INDEX IF NOT EXISTS plugin_orders_orders_awaiting
    ON plugin_orders_orders(awaiting_reply);
