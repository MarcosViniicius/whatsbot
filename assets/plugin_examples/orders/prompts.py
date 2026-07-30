"""Fragmento de system prompt — instrui o LLM sobre o fluxo de pedidos e injeta
um resumo compacto do(s) pedido(s) em aberto do contato atual.

O resumo é a âncora "estável" pro pedido — não depende de quantas mensagens
de histórico o modelo ainda enxerga (ver correção em
db/repositories/message_repo.py: uma resposta quebrada em várias bolhas do
WhatsApp podia empurrar os itens do pedido pra fora da janela de contexto).
Escopado por ``contact.id``, então nunca mistura pedidos de clientes
diferentes — e só injeta quando existe pedido aberto, pra não inflar o prompt
à toa em conversas sem pedido em andamento.
"""

import json

from sqlalchemy import text

from plugins.context import make_plugin_db

# Pedidos nesses status já foram concluídos — não são "em andamento", não
# entram no resumo (evita poluir o prompt com histórico irrelevante).
_CLOSED_STATUSES = ("delivered", "cancelled")

_STATUS_LABELS = {
    "new": "novo",
    "processing": "em processamento",
    "out_for_delivery": "em entrega",
    "delivered": "entregue",
    "cancelled": "cancelado",
}

# Quantos pedidos em aberto no máximo entram no resumo — mantém o prompt
# enxuto mesmo se o cliente tiver vários pedidos simultâneos.
_MAX_ORDERS_IN_CONTEXT = 2


def _items_summary(items_json: str) -> str:
    try:
        items = json.loads(items_json or "[]")
    except (TypeError, ValueError):
        return ""
    parts = []
    for it in items:
        qty = it.get("quantity")
        name = it.get("name", "")
        parts.append(f"{qty}x {name}" if qty else name)
    return ", ".join(p for p in parts if p)


def _order_context_block(contact) -> str:
    contact_id = getattr(contact, "id", None)
    if not contact_id:
        return ""
    placeholders = ", ".join(f"'{s}'" for s in _CLOSED_STATUSES)
    with make_plugin_db() as conn:
        rows = conn.execute(
            text(
                f"SELECT status, items, estimated_total, currency, payment_status, "
                f"payment_method, address FROM plugin_orders_orders "
                f"WHERE contact_id = :cid AND status NOT IN ({placeholders}) "
                f"ORDER BY created_at DESC LIMIT :n"
            ),
            {"cid": contact_id, "n": _MAX_ORDERS_IN_CONTEXT},
        ).mappings().all()
    if not rows:
        return ""

    lines = ["\n\nPedido(s) em andamento deste cliente (já registrados, não peça de novo):"]
    for row in rows:
        status_label = _STATUS_LABELS.get(row["status"], row["status"])
        items = _items_summary(row["items"])
        bits = [f"status: {status_label}"]
        if items:
            bits.append(f"itens: {items}")
        if row["estimated_total"]:
            bits.append(f"total: {row['currency'] or 'BRL'} {row['estimated_total']}")
        bits.append(f"pagamento: {row['payment_status'] or 'pending'}")
        if row["address"]:
            bits.append(f"entrega: {row['address']}")
        lines.append("- " + "; ".join(bits))
    return "\n".join(lines)


def orders_prompt_fragment(contact, ctx) -> str:
    base = (
        "\n\nGestão de pedidos — DUAS tools, escolha a certa:\n"
        "- save_order: SÓ para o PRIMEIRO registro de um pedido novo (o cliente "
        "ainda não tem nenhum pedido em andamento).\n"
        "- update_order: para QUALQUER informação nova sobre um pedido que JÁ "
        "existe (troca/confirmação de marca, forma de pagamento, endereço, "
        "status do pagamento, tipo de entrega) — envie só os campos que "
        "mudaram.\n"
        "REGRA: se a seção \"Pedido(s) em andamento\" abaixo NÃO estiver vazia, "
        "qualquer informação nova do cliente sobre o pedido vai para "
        "update_order, NUNCA para save_order de novo — isso cria um pedido "
        "duplicado no Kanban do atendente. Extraia itens, quantidades, forma "
        "de pagamento, endereço, status do pagamento e observações relevantes "
        "conforme o cliente for confirmando, e chame a tool certa. Não "
        "mencione essas ferramentas para o cliente, apenas registre e "
        "continue o atendimento normalmente."
    )
    try:
        return base + _order_context_block(contact)
    except Exception:
        # Nunca deixar uma falha aqui derrubar a resposta normal da IA.
        return base


PROMPT_FRAGMENTS = [orders_prompt_fragment]
