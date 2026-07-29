"""Event listener — captures the customer's reply to an order-linked question.

When the operator asks something from the Kanban card (routes.py:
``POST /orders/{id}/messages``), the order is marked ``awaiting_reply=1``. The
next inbound message from that same contact clears the flag automatically and
records the reply — no need for the operator to watch the chat. If an LLM is
configured, it also proposes a structured update to the order (item swap,
notes) that the operator reviews and applies with one click from the card
(``routes.py``: ``/suggestion/apply`` / ``/suggestion/dismiss``) — never
applied silently, since it can touch money/order accuracy.
"""

import json
import logging
import time

from sqlalchemy import text

from plugins.context import broadcast, make_plugin_db

logger = logging.getLogger(__name__)


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


def _suggest_order_update(handler, question: str, reply: str, items: list,
                          item_index: int | None) -> dict | None:
    """Ask the configured LLM to interpret the reply and propose an update.

    When ``item_index`` is set, the question was about ONE specific item
    (e.g. "esse item acabou, quer trocar?") — the prompt is scoped so the
    suggestion only touches that item, not the whole order (the full-page
    order view shows this suggestion on that item's row).

    Returns ``None`` on any failure (no API key, provider error, malformed
    JSON) — this is a convenience suggestion on top of the core flow (which
    already recorded the reply), never a blocker.
    """
    if not handler or not getattr(handler, "api_key", None):
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=handler.api_key, base_url=handler.base_url)
        if item_index is not None and 0 <= item_index < len(items):
            target_item = items[item_index]
            prompt = (
                "Você ajuda um atendente a atualizar UM ITEM de um pedido com "
                "base na resposta do cliente a uma pergunta sobre esse item "
                "específico (ex: item em falta, troca de marca, quantidade).\n\n"
                f"Pergunta enviada ao cliente sobre o item: {question}\n"
                f"Resposta do cliente: {reply}\n"
                f"Item atual (JSON): {json.dumps(target_item, ensure_ascii=False)}\n\n"
                "Responda em JSON no formato exato: "
                '{"summary": "resumo curto da mudança sugerida (ou vazio se não houver)", '
                '"updated_item": {"name": "...", "quantity": "...", "notes": "..."} ou null se não mudou, '
                '"notes_append": "texto curto a adicionar nas observações gerais do pedido, ou vazio"}'
            )
        else:
            prompt = (
                "Você ajuda um atendente a atualizar um pedido com base na resposta "
                "do cliente a uma pergunta sobre o pedido (ex: item em falta, troca "
                "de marca, quantidade).\n\n"
                f"Pergunta enviada ao cliente: {question}\n"
                f"Resposta do cliente: {reply}\n"
                f"Itens atuais do pedido (JSON): {json.dumps(items, ensure_ascii=False)}\n\n"
                "Responda em JSON no formato exato: "
                '{"summary": "resumo curto da mudança sugerida (ou vazio se não houver)", '
                '"items": [...itens atualizados, mesmo formato dos itens atuais, ou null se não mudou...], '
                '"notes_append": "texto curto a adicionar nas observações, ou vazio"}'
            )
        response = client.chat.completions.create(
            model=handler.model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=800,
        )
        data = json.loads(response.choices[0].message.content)
        if not data.get("summary"):
            return None
        if item_index is not None:
            data["item_index"] = item_index
        return data
    except Exception as e:
        logger.warning("Order update suggestion failed: %s", e)
        return None


def on_message_saved(ctx, payload: dict) -> None:
    phone = payload.get("phone")
    reply_text = (payload.get("text") or "").strip()
    if not phone or not reply_text:
        return

    with make_plugin_db() as conn:
        order = conn.execute(
            text(
                "SELECT * FROM plugin_orders_orders "
                "WHERE contact_phone = :phone AND awaiting_reply = 1 "
                "ORDER BY updated_at DESC LIMIT 1"
            ),
            {"phone": phone},
        ).mappings().first()
        if not order:
            return
        order = dict(order)
        now_ts = int(time.time())

        try:
            items = json.loads(order.get("items") or "[]")
        except (TypeError, ValueError):
            items = []
        suggestion = _suggest_order_update(
            ctx.handler, order.get("last_question") or "", reply_text, items,
            order.get("pending_item_index"),
        )
        suggestion_json = json.dumps(suggestion, ensure_ascii=False) if suggestion else None

        conn.execute(
            text(
                "UPDATE plugin_orders_orders SET awaiting_reply = 0, "
                "last_reply = :reply, ai_suggestion = :suggestion, "
                "pending_item_index = NULL, updated_at = :now WHERE id = :id"
            ),
            {"reply": reply_text, "suggestion": suggestion_json, "now": now_ts, "id": order["id"]},
        )
        conn.execute(
            text(
                "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                "VALUES (:order_id, 'awaiting_reply', '1', '0', 'customer', :ts)"
            ),
            {"order_id": order["id"], "ts": now_ts},
        )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order["id"]},
        ).mappings().first()

    broadcast("plugin_orders_updated", _row_to_dict(row))
    logger.info(
        "Order %s: customer reply captured%s",
        order["id"], " (AI suggested an update)" if suggestion else "",
    )


EVENT_HANDLERS = {"message.saved": on_message_saved}
