-- Supports the full-page order view: a question can be scoped to a single
-- item (e.g. "esse item acabou, quer trocar?") instead of the whole order,
-- and delivery_type tracks entrega/retirada for the summary strip.
ALTER TABLE plugin_orders_orders ADD COLUMN pending_item_index INTEGER;
ALTER TABLE plugin_orders_orders ADD COLUMN delivery_type TEXT;
