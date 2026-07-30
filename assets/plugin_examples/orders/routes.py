"""REST endpoints do plugin Pedidos (mountados em /api/plugins/orders)."""

import json
import logging
import time

from fastapi import APIRouter
from sqlalchemy import text

from plugins.context import broadcast, make_plugin_db

logger = logging.getLogger(__name__)

router = APIRouter()

STATUSES = ("new", "processing", "out_for_delivery", "delivered", "cancelled")

_EDITABLE_FIELDS = (
    "contact_name", "items", "notes", "payment_method", "payment_status",
    "address", "estimated_total", "currency", "priority", "delivery_type",
)


def _row_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["items"] = json.loads(d.get("items") or "[]")
    except (TypeError, ValueError):
        d["items"] = []
    if d.get("ai_suggestion"):
        try:
            d["ai_suggestion"] = json.loads(d["ai_suggestion"])
        except (TypeError, ValueError):
            d["ai_suggestion"] = None
    return d


@router.get("/orders")
async def list_orders(status: str | None = None, limit: int = 500):
    query = "SELECT * FROM plugin_orders_orders"
    params: dict = {"limit": limit}
    if status:
        query += " WHERE status = :status"
        params["status"] = status
    query += " ORDER BY created_at DESC LIMIT :limit"
    with make_plugin_db() as conn:
        rows = conn.execute(text(query), params).mappings().all()
    return {"ok": True, "data": [_row_to_dict(r) for r in rows]}


@router.get("/orders/{order_id}")
async def get_order(order_id: int):
    with make_plugin_db() as conn:
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not row:
            return {"ok": False, "error": "Pedido não encontrado."}
        history = conn.execute(
            text("SELECT * FROM plugin_orders_history WHERE order_id = :id ORDER BY ts DESC"),
            {"id": order_id},
        ).mappings().all()
    data = _row_to_dict(row)
    data["history"] = [dict(h) for h in history]
    return {"ok": True, "data": data}


@router.post("/orders")
async def create_order(body: dict):
    """Manual order creation — used by the "Enviar para Kanban" conversation action."""
    contact_id = body.get("contact_id")
    contact_phone = (body.get("contact_phone") or "").strip()
    if not contact_id or not contact_phone:
        return {"ok": False, "error": "contact_id e contact_phone são obrigatórios."}
    now_ts = int(time.time())
    items = body.get("items") or []
    with make_plugin_db() as conn:
        rid = conn.execute(
            text(
                "INSERT INTO plugin_orders_orders "
                "(contact_id, contact_phone, contact_name, status, items, notes, "
                " payment_method, payment_status, address, estimated_total, currency, "
                " priority, source, source_msg_id, created_at, updated_at) "
                "VALUES (:contact_id, :contact_phone, :contact_name, 'new', :items, :notes, "
                " :payment_method, :payment_status, :address, :estimated_total, :currency, "
                " :priority, 'manual', :source_msg_id, :now, :now) "
                "RETURNING id"
            ),
            {
                "contact_id": contact_id,
                "contact_phone": contact_phone,
                "contact_name": body.get("contact_name") or "",
                "items": json.dumps(items, ensure_ascii=False),
                "notes": body.get("notes") or "",
                "payment_method": body.get("payment_method") or "",
                "payment_status": body.get("payment_status") or "pending",
                "address": body.get("address") or "",
                "estimated_total": body.get("estimated_total"),
                "currency": body.get("currency") or "BRL",
                "priority": body.get("priority") or "normal",
                "source_msg_id": body.get("source_msg_id"),
                "now": now_ts,
            },
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                "VALUES (:order_id, 'status', NULL, 'new', 'operator', :ts)"
            ),
            {"order_id": rid, "ts": now_ts},
        )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": rid},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_created", data)
    return {"ok": True, "data": data}


@router.put("/orders/{order_id}")
async def update_order(order_id: int, body: dict):
    with make_plugin_db() as conn:
        current = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not current:
            return {"ok": False, "error": "Pedido não encontrado."}
        current = dict(current)
        now_ts = int(time.time())
        sets = []
        params: dict = {"id": order_id, "now": now_ts}
        history_rows = []
        for field in _EDITABLE_FIELDS:
            if field not in body:
                continue
            new_value = body[field]
            new_stored = json.dumps(new_value, ensure_ascii=False) if field == "items" else new_value
            old_stored = current.get(field)
            if str(old_stored) == str(new_stored):
                continue
            sets.append(f"{field} = :{field}")
            params[field] = new_stored
            history_rows.append((field, old_stored, new_stored))
        if not sets:
            return {"ok": True, "data": _row_to_dict(current)}
        sets.append("updated_at = :now")
        conn.execute(
            text(f"UPDATE plugin_orders_orders SET {', '.join(sets)} WHERE id = :id"),
            params,
        )
        for field, old_value, new_value in history_rows:
            conn.execute(
                text(
                    "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                    "VALUES (:order_id, :field, :old_value, :new_value, 'operator', :ts)"
                ),
                {
                    "order_id": order_id, "field": field,
                    "old_value": str(old_value) if old_value is not None else None,
                    "new_value": str(new_value) if new_value is not None else None,
                    "ts": now_ts,
                },
            )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_updated", data)
    return {"ok": True, "data": data}


@router.post("/orders/{order_id}/status")
async def update_status(order_id: int, body: dict):
    new_status = (body.get("status") or "").strip()
    if new_status not in STATUSES:
        return {"ok": False, "error": f"Status inválido. Use um de: {', '.join(STATUSES)}"}
    now_ts = int(time.time())
    with make_plugin_db() as conn:
        current = conn.execute(
            text("SELECT status FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not current:
            return {"ok": False, "error": "Pedido não encontrado."}
        old_status = current["status"]
        if old_status != new_status:
            closed_at = now_ts if new_status in ("delivered", "cancelled") else None
            conn.execute(
                text(
                    "UPDATE plugin_orders_orders SET status = :status, updated_at = :now, "
                    "closed_at = COALESCE(:closed_at, closed_at) WHERE id = :id"
                ),
                {"status": new_status, "now": now_ts, "closed_at": closed_at, "id": order_id},
            )
            conn.execute(
                text(
                    "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                    "VALUES (:order_id, 'status', :old, :new, 'operator', :ts)"
                ),
                {"order_id": order_id, "old": old_status, "new": new_status, "ts": now_ts},
            )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_status_changed", data)
    return {"ok": True, "data": data}


@router.delete("/orders/{order_id}")
async def delete_order(order_id: int):
    with make_plugin_db() as conn:
        conn.execute(text("DELETE FROM plugin_orders_history WHERE order_id = :id"), {"id": order_id})
        conn.execute(text("DELETE FROM plugin_orders_orders WHERE id = :id"), {"id": order_id})
    broadcast("plugin_orders_deleted", {"id": order_id})
    return {"ok": True}


@router.post("/orders/{order_id}/messages")
async def record_question(order_id: int, body: dict):
    """Bookkeeping for a question/note the operator sent about this order.

    The actual WhatsApp send happens client-side against the core
    ``/api/contacts/{phone}/send`` endpoint (plugins have no direct GOWA
    access by design) — this endpoint just marks the order as waiting on the
    customer so the Kanban card can show it, and events.py auto-clears it
    (+ captures the reply) the moment the next inbound message arrives.

    ``item_index`` (optional) scopes the question to a single item — e.g.
    "esse item acabou, quer trocar?" — so the full-page order view can show
    the "aguardando" badge on that specific item row and events.py can steer
    the AI's update suggestion at just that item instead of the whole order.
    """
    question = (body.get("text") or "").strip()
    if not question:
        return {"ok": False, "error": "Campo 'text' é obrigatório."}
    item_index = body.get("item_index")
    if item_index is not None:
        try:
            item_index = int(item_index)
        except (TypeError, ValueError):
            item_index = None
    now_ts = int(time.time())
    with make_plugin_db() as conn:
        current = conn.execute(
            text("SELECT id FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not current:
            return {"ok": False, "error": "Pedido não encontrado."}
        conn.execute(
            text(
                "UPDATE plugin_orders_orders SET awaiting_reply = 1, "
                "last_question = :q, last_reply = NULL, ai_suggestion = NULL, "
                "pending_item_index = :item_index, updated_at = :now WHERE id = :id"
            ),
            {"q": question, "item_index": item_index, "now": now_ts, "id": order_id},
        )
        conn.execute(
            text(
                "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                "VALUES (:order_id, 'question_sent', NULL, :q, 'operator', :ts)"
            ),
            {"order_id": order_id, "q": question, "ts": now_ts},
        )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_updated", data)
    return {"ok": True, "data": data}


@router.post("/orders/{order_id}/suggestion/apply")
async def apply_suggestion(order_id: int):
    """Apply the pending AI suggestion (items/notes) — operator-approved only,
    never auto-applied by events.py."""
    now_ts = int(time.time())
    with make_plugin_db() as conn:
        current = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not current:
            return {"ok": False, "error": "Pedido não encontrado."}
        current = dict(current)
        raw = current.get("ai_suggestion")
        if not raw:
            return {"ok": False, "error": "Não há sugestão pendente para este pedido."}
        try:
            suggestion = json.loads(raw)
        except (TypeError, ValueError):
            return {"ok": False, "error": "Sugestão inválida."}

        sets = ["ai_suggestion = NULL", "updated_at = :now"]
        params: dict = {"id": order_id, "now": now_ts}
        history_rows = []

        item_index = suggestion.get("item_index")
        updated_item = suggestion.get("updated_item")
        if item_index is not None and updated_item:
            # Item-scoped suggestion — splice just that one item, leave the
            # rest of the order's items untouched.
            try:
                items_list = json.loads(current.get("items") or "[]")
            except (TypeError, ValueError):
                items_list = []
            if 0 <= item_index < len(items_list):
                old_items_json = current.get("items") or "[]"
                items_list[item_index] = updated_item
                new_items_json = json.dumps(items_list, ensure_ascii=False)
                sets.append("items = :items")
                params["items"] = new_items_json
                history_rows.append(("items", old_items_json, new_items_json))
        else:
            new_items = suggestion.get("items")
            if new_items:
                old_items = current.get("items") or "[]"
                new_items_json = json.dumps(new_items, ensure_ascii=False)
                if old_items != new_items_json:
                    sets.append("items = :items")
                    params["items"] = new_items_json
                    history_rows.append(("items", old_items, new_items_json))

        notes_append = (suggestion.get("notes_append") or "").strip()
        if notes_append:
            old_notes = current.get("notes") or ""
            new_notes = f"{old_notes}\n{notes_append}".strip() if old_notes else notes_append
            sets.append("notes = :notes")
            params["notes"] = new_notes
            history_rows.append(("notes", old_notes, new_notes))

        conn.execute(
            text(f"UPDATE plugin_orders_orders SET {', '.join(sets)} WHERE id = :id"),
            params,
        )
        for field, old_value, new_value in history_rows:
            conn.execute(
                text(
                    "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                    "VALUES (:order_id, :field, :old_value, :new_value, 'ai_suggested_applied', :ts)"
                ),
                {"order_id": order_id, "field": field, "old_value": old_value, "new_value": new_value, "ts": now_ts},
            )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_updated", data)
    return {"ok": True, "data": data}


@router.post("/orders/{order_id}/suggestion/dismiss")
async def dismiss_suggestion(order_id: int):
    now_ts = int(time.time())
    with make_plugin_db() as conn:
        current = conn.execute(
            text("SELECT id FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
        if not current:
            return {"ok": False, "error": "Pedido não encontrado."}
        conn.execute(
            text("UPDATE plugin_orders_orders SET ai_suggestion = NULL, updated_at = :now WHERE id = :id"),
            {"now": now_ts, "id": order_id},
        )
        conn.execute(
            text(
                "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                "VALUES (:order_id, 'ai_suggestion', 'pending', 'dismissed', 'operator', :ts)"
            ),
            {"order_id": order_id, "ts": now_ts},
        )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order_id},
        ).mappings().first()
    data = _row_to_dict(row)
    broadcast("plugin_orders_updated", data)
    return {"ok": True, "data": data}


@router.get("/stats")
async def get_stats():
    """Aggregates consumed by the core operational dashboard embed."""
    day_start = int(time.time() // 86400 * 86400)
    with make_plugin_db() as conn:
        by_status = conn.execute(
            text("SELECT status, COUNT(*) AS c FROM plugin_orders_orders GROUP BY status")
        ).mappings().all()
        today_rows = conn.execute(
            text("SELECT estimated_total FROM plugin_orders_orders WHERE created_at >= :day_start"),
            {"day_start": day_start},
        ).mappings().all()
        delivered_today = conn.execute(
            text(
                "SELECT COUNT(*) AS c, COALESCE(SUM(estimated_total), 0) AS total "
                "FROM plugin_orders_orders WHERE status = 'delivered' AND closed_at >= :day_start"
            ),
            {"day_start": day_start},
        ).mappings().first()
    by_status_map = {row["status"]: row["c"] for row in by_status}
    return {
        "ok": True,
        "data": {
            "by_status": {s: by_status_map.get(s, 0) for s in STATUSES},
            "orders_today_count": len(today_rows),
            "orders_today_total": sum(float(r["estimated_total"] or 0) for r in today_rows),
            "delivered_today_count": (delivered_today["c"] if delivered_today else 0) or 0,
            "delivered_today_total": float(delivered_today["total"] or 0) if delivered_today else 0.0,
            "in_delivery_count": by_status_map.get("out_for_delivery", 0),
        },
    }
