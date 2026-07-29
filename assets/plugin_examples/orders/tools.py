"""Tools ``save_order`` / ``update_order`` — extraem e mantêm o pedido do
cliente identificado pela IA.

``save_order`` CRIA um pedido novo; ``update_order`` EDITA o pedido em
andamento do contato. São dois tools separados de propósito — sem essa
distinção explícita, o modelo tende a chamar sempre save_order (a única opção
que conhece) mesmo quando só precisa acrescentar uma informação a um pedido
que já existe, duplicando o cartão no Kanban a cada resposta do cliente
(confirmação de marca, forma de pagamento etc). O fragmento de prompt em
prompts.py reforça a regra "existe pedido em andamento → use update_order".
"""

import json
import logging
import time

from sqlalchemy import text

from plugins.context import broadcast, make_plugin_db

logger = logging.getLogger(__name__)

# Pedidos nesses status são considerados concluídos — não contam como "em
# andamento" para fins de update_order (mesma regra de prompts.py).
_CLOSED_STATUSES = ("delivered", "cancelled")


def _row_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["items"] = json.loads(d.get("items") or "[]")
    except (TypeError, ValueError):
        d["items"] = []
    return d


SAVE_ORDER_TOOL = {
    "type": "function",
    "display_label": "Registrar Pedido",
    "function": {
        "name": "save_order",
        "description": (
            "Registra um PEDIDO NOVO feito ou confirmado pelo cliente nesta "
            "conversa (texto ou áudio já transcrito). Use quando o cliente "
            "listar produtos que quer comprar/encomendar, com ou sem "
            "quantidade, forma de pagamento ou endereço. "
            "NÃO use para perguntas sobre produtos, reclamações, ou conversas "
            "que não são um pedido concreto. "
            "IMPORTANTE: se já existe um pedido em andamento para este cliente "
            "(veja o resumo no início desta conversa), NÃO chame save_order de "
            "novo — use update_order para acrescentar a informação nova "
            "(marca escolhida, forma de pagamento, endereço etc) ao pedido "
            "existente. save_order é só para o PRIMEIRO registro do pedido. "
            "Se o cliente confirmar um pedido em etapas (manda os itens, "
            "depois o endereço), aguarde ter pelo menos os itens antes de "
            "chamar."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "Itens do pedido.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Nome do produto/item."},
                            "quantity": {"type": "string", "description": "Quantidade pedida (ex: '2', '1kg', '3 unidades')."},
                            "notes": {"type": "string", "description": "Observação específica do item (ex: 'sem cebola')."},
                        },
                        "required": ["name"],
                    },
                },
                "notes": {"type": "string", "description": "Observações gerais do pedido (dúvidas, pedidos especiais etc)."},
                "payment_method": {"type": "string", "description": "Forma de pagamento informada (ex: Pix, cartão, dinheiro), se houver."},
                "payment_status": {
                    "type": "string",
                    "enum": ["pending", "paid"],
                    "description": "Status do pagamento. Use 'paid' apenas se o cliente confirmar que já pagou.",
                },
                "address": {"type": "string", "description": "Endereço de entrega informado, se houver."},
                "estimated_total": {"type": "number", "description": "Valor total estimado do pedido, se der pra calcular ou o cliente informar."},
                "currency": {"type": "string", "description": "Moeda do valor (padrão BRL)."},
                "priority": {
                    "type": "string",
                    "enum": ["normal", "high"],
                    "description": "Prioridade do pedido — use 'high' apenas se o cliente indicar urgência.",
                },
                "delivery_type": {
                    "type": "string",
                    "enum": ["delivery", "pickup"],
                    "description": "'delivery' se o cliente pediu entrega, 'pickup' se disse que vai retirar na loja. Omitir se ainda não foi perguntado/respondido.",
                },
            },
            "required": ["items"],
        },
    },
}


def execute_save_order(ctx, args: dict) -> str | None:
    items = (args or {}).get("items") or []
    if not items:
        return None
    contact = ctx.contact
    info = getattr(contact, "info", {}) or {}
    name = info.get("name") or getattr(contact, "group_name", "") or ""
    now_ts = int(time.time())

    payment_status = args.get("payment_status") or "pending"
    if payment_status not in ("pending", "paid"):
        payment_status = "pending"
    priority = args.get("priority") or "normal"
    if priority not in ("normal", "high"):
        priority = "normal"
    delivery_type = args.get("delivery_type") or None
    if delivery_type not in ("delivery", "pickup", None):
        delivery_type = None

    with make_plugin_db() as conn:
        rid = conn.execute(
            text(
                "INSERT INTO plugin_orders_orders "
                "(contact_id, contact_phone, contact_name, status, items, notes, "
                " payment_method, payment_status, address, estimated_total, currency, "
                " priority, delivery_type, source, created_at, updated_at) "
                "VALUES (:contact_id, :contact_phone, :contact_name, 'new', :items, :notes, "
                " :payment_method, :payment_status, :address, :estimated_total, :currency, "
                " :priority, :delivery_type, 'ai', :now, :now) "
                "RETURNING id"
            ),
            {
                "contact_id": contact.id,
                "contact_phone": contact.phone,
                "contact_name": name,
                "items": json.dumps(items, ensure_ascii=False),
                "notes": args.get("notes") or "",
                "payment_method": args.get("payment_method") or "",
                "payment_status": payment_status,
                "address": args.get("address") or "",
                "estimated_total": args.get("estimated_total"),
                "currency": args.get("currency") or "BRL",
                "priority": priority,
                "delivery_type": delivery_type,
                "now": now_ts,
            },
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                "VALUES (:order_id, 'status', NULL, 'new', 'ai', :ts)"
            ),
            {"order_id": rid, "ts": now_ts},
        )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": rid},
        ).mappings().first()

    if row:
        order = dict(row)
        order["items"] = items
        broadcast("plugin_orders_created", order)
    logger.info("Order saved for %s (%d items)", contact.phone, len(items))
    return f"Pedido registrado com {len(items)} item(ns) e enviado para o Kanban."


UPDATE_ORDER_TOOL = {
    "type": "function",
    "display_label": "Atualizar Pedido",
    "function": {
        "name": "update_order",
        "description": (
            "Atualiza o PEDIDO EM ANDAMENTO deste cliente (o resumo dele já "
            "aparece no início desta conversa) com uma informação nova: troca "
            "ou confirmação de marca/produto, forma de pagamento, status do "
            "pagamento, endereço, tipo de entrega, ou observação. "
            "USE ESTA TOOL em vez de save_order sempre que já existir um "
            "pedido em andamento para o cliente — NUNCA crie um pedido novo só "
            "para acrescentar uma informação a um pedido que já existe "
            "(isso duplica o pedido no sistema do atendente). "
            "Envie apenas os campos que realmente mudaram; omita o resto — "
            "não repita a lista de itens inteira se só a forma de pagamento "
            "mudou, por exemplo. Se não houver nenhum pedido em andamento "
            "para este cliente, use save_order em vez desta."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "Lista COMPLETA e atualizada dos itens — só envie se algum item mudou (marca, quantidade, adicionado/removido). Omita se os itens não mudaram.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "quantity": {"type": "string"},
                            "notes": {"type": "string"},
                        },
                        "required": ["name"],
                    },
                },
                "notes": {"type": "string", "description": "Observações gerais do pedido, se mudaram."},
                "payment_method": {"type": "string", "description": "Forma de pagamento, se informada agora."},
                "payment_status": {"type": "string", "enum": ["pending", "paid"], "description": "Status do pagamento, se mudou."},
                "address": {"type": "string", "description": "Endereço de entrega, se informado/corrigido agora."},
                "estimated_total": {"type": "number", "description": "Valor total atualizado, se mudou."},
                "delivery_type": {"type": "string", "enum": ["delivery", "pickup"], "description": "Entrega ou retirada, se informado agora."},
            },
            "required": [],
        },
    },
}


def execute_update_order(ctx, args: dict) -> str | None:
    contact = ctx.contact
    now_ts = int(time.time())
    placeholders = ", ".join(f"'{s}'" for s in _CLOSED_STATUSES)

    with make_plugin_db() as conn:
        order = conn.execute(
            text(
                f"SELECT * FROM plugin_orders_orders WHERE contact_id = :cid "
                f"AND status NOT IN ({placeholders}) ORDER BY created_at DESC LIMIT 1"
            ),
            {"cid": contact.id},
        ).mappings().first()
        if not order:
            logger.info("update_order called for %s but no open order exists", contact.phone)
            return (
                "Não há nenhum pedido em andamento para este cliente ainda — "
                "use a tool save_order para registrar um pedido novo."
            )
        order = dict(order)

        sets = ["updated_at = :now"]
        params: dict = {"id": order["id"], "now": now_ts}
        history_rows = []
        for field in ("items", "notes", "payment_method", "payment_status",
                      "address", "estimated_total", "delivery_type"):
            if field not in args or args[field] is None:
                continue
            new_value = args[field]
            new_stored = json.dumps(new_value, ensure_ascii=False) if field == "items" else new_value
            old_stored = order.get(field)
            if str(old_stored) == str(new_stored):
                continue
            sets.append(f"{field} = :{field}")
            params[field] = new_stored
            history_rows.append((field, old_stored, new_stored))

        if len(sets) == 1:  # only updated_at — nothing actually changed
            return "Nenhuma mudança detectada no pedido."

        conn.execute(
            text(f"UPDATE plugin_orders_orders SET {', '.join(sets)} WHERE id = :id"),
            params,
        )
        for field, old_value, new_value in history_rows:
            conn.execute(
                text(
                    "INSERT INTO plugin_orders_history (order_id, field, old_value, new_value, changed_by, ts) "
                    "VALUES (:order_id, :field, :old_value, :new_value, 'ai', :ts)"
                ),
                {
                    "order_id": order["id"], "field": field,
                    "old_value": str(old_value) if old_value is not None else None,
                    "new_value": str(new_value) if new_value is not None else None,
                    "ts": now_ts,
                },
            )
        row = conn.execute(
            text("SELECT * FROM plugin_orders_orders WHERE id = :id"),
            {"id": order["id"]},
        ).mappings().first()

    data = _row_to_dict(row)
    broadcast("plugin_orders_updated", data)
    changed_fields = [f for f, _, _ in history_rows]
    logger.info("Order %s updated by AI for %s: %s", order["id"], contact.phone, changed_fields)
    return f"Pedido atualizado ({', '.join(changed_fields)})."


CORE_TOOLS = [
    (SAVE_ORDER_TOOL, execute_save_order),
    (UPDATE_ORDER_TOOL, execute_update_order),
]
