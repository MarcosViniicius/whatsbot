"""Repository for messages table."""

from __future__ import annotations

import json
import time

from sqlalchemy import and_, delete as sa_delete, insert as sa_insert, select, update as sa_update

from db.engine import get_engine
from db.tables import messages


def add(contact_id: int, role: str, content: str, *,
        media_type: str | None = None, media_path: str | None = None,
        status: str | None = None, msg_id: str | None = None,
        reply_to_msg_id: str | None = None,
        ts: float | None = None) -> dict:
    """Insert a message and return it as a dict."""
    ts = ts or time.time()
    with get_engine().begin() as conn:
        result = conn.execute(sa_insert(messages).values(
            contact_id=contact_id,
            role=role,
            content=content,
            ts=ts,
            media_type=media_type,
            media_path=media_path,
            status=status,
            msg_id=msg_id,
            reply_to_msg_id=reply_to_msg_id,
        ))
        new_id = result.inserted_primary_key[0]
    return {
        "id": new_id,
        "role": role,
        "content": content,
        "ts": ts,
        "media_type": media_type,
        "media_path": media_path,
        "status": status,
        "msg_id": msg_id,
        "reply_to_msg_id": reply_to_msg_id,
    }


def get_all(contact_id: int) -> list[dict]:
    """Return all messages for a contact ordered by timestamp."""
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(messages)
            .where(messages.c.contact_id == contact_id)
            .order_by(messages.c.ts)
        ).mappings().all()
    return [_row_to_dict(r) for r in rows]


# Split-message replies (split_messages=True, the default) save each WhatsApp
# bubble as its own row within milliseconds of each other — see
# server/routes/webhook.py `_send_reply`'s "save each part as a separate
# message" loop, which writes all parts back-to-back with no delay after
# sending. Measured in production: a 6-bubble reply had its rows span ~22ms.
# Without turn-grouping, get_context's row limit could be entirely consumed by
# ONE multi-bubble AI reply, pushing the actual order details out of context
# after just one or two exchanges (confirmed: a customer's item list fell out
# of a 10-row window after the very next AI turn). Rows within this many
# seconds of each other, same role, count as one turn against `limit`.
_TURN_GAP_SECONDS = 3.0

# Safety cap on how many raw rows we'll scan to assemble `limit` turns, so a
# very long-lived contact's full history is never pulled into memory just to
# find the last few turns. Generous relative to typical reply sizes (rarely
# > 10 bubbles), so it should almost never under-fill in practice.
_MAX_SCAN_ROWS = 500


def get_context(contact_id: int, limit: int) -> list[dict]:
    """Return the last N conversational TURNS (not raw rows) for LLM context.

    A "turn" is one or more consecutive same-role rows saved within
    ``_TURN_GAP_SECONDS`` of each other — i.e. one AI reply split into several
    WhatsApp bubbles counts as ONE turn against ``limit``, matching what a
    person actually perceives as "one message" instead of quietly shrinking
    the model's effective memory by the split factor.
    """
    # `system` = system-event messages (e.g. improvement analyses) that signal
    # something happened but are NOT meant for the AI to read. Kept out of the
    # LLM context here so they never leak into a reply.
    excluded = ("transcription", "tool_call", "system_notice", "system")
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(messages)
            .where(
                (messages.c.contact_id == contact_id)
                & (~messages.c.role.in_(excluded))
                & ((messages.c.status.is_(None)) | (messages.c.status != "failed"))
            )
            .order_by(messages.c.ts.desc())
            .limit(max(_MAX_SCAN_ROWS, limit * 25))
        ).mappings().all()

    # `rows` is newest-first. Walk forward, grouping consecutive same-role
    # rows within the gap threshold into a turn; stop STARTING new turns once
    # `limit` is reached (a turn already in progress may still grow, so it's
    # never split across the boundary).
    turns: list[list] = []
    prev_ts = None
    prev_role = None
    for row in rows:
        same_turn = (
            turns
            and row["role"] == prev_role
            and prev_ts is not None
            and (prev_ts - row["ts"]) <= _TURN_GAP_SECONDS
        )
        if same_turn:
            turns[-1].append(row)
        else:
            if len(turns) >= limit:
                break
            turns.append([row])
        prev_ts, prev_role = row["ts"], row["role"]

    flat = [r for turn in reversed(turns) for r in reversed(turn)]
    return [_row_to_dict(r) for r in flat]


def get_last(contact_id: int) -> dict | None:
    """Return the most recent message for a contact."""
    with get_engine().connect() as conn:
        row = conn.execute(
            select(messages)
            .where(messages.c.contact_id == contact_id)
            .order_by(messages.c.ts.desc())
            .limit(1)
        ).mappings().first()
    return _row_to_dict(row) if row else None


def get_last_user_message(contact_id: int) -> dict | None:
    """Return the most recent user message (for updating with transcription etc)."""
    with get_engine().connect() as conn:
        row = conn.execute(
            select(messages)
            .where((messages.c.contact_id == contact_id) & (messages.c.role == "user"))
            .order_by(messages.c.ts.desc())
            .limit(1)
        ).mappings().first()
    return _row_to_dict(row) if row else None


def get_last_operator_message(contact_id: int) -> dict | None:
    """Return the most recent human-operator-sent message (role=assistant, status=operator).

    Used by the AI auto-resume check (server/background.py) to anchor the
    "attendant went quiet" timeout — distinct from AI-sent assistant messages
    (status='sent'/'delivered'/'read'), which don't count as human activity.
    """
    with get_engine().connect() as conn:
        row = conn.execute(
            select(messages)
            .where(
                (messages.c.contact_id == contact_id)
                & (messages.c.role == "assistant")
                & (messages.c.status == "operator")
            )
            .order_by(messages.c.ts.desc())
            .limit(1)
        ).mappings().first()
    return _row_to_dict(row) if row else None


def update_content(message_id: int, content: str) -> None:
    """Update the content of a specific message."""
    with get_engine().begin() as conn:
        conn.execute(sa_update(messages).where(messages.c.id == message_id).values(content=content))


def update_status(contact_id: int, content: str, new_status: str | None,
                   msg_id: str | None = None) -> None:
    """Update status of the most recent message matching content (for retry-send)."""
    with get_engine().begin() as conn:
        target_id = conn.execute(
            select(messages.c.id)
            .where(
                (messages.c.contact_id == contact_id)
                & (messages.c.content == content)
                & (messages.c.status == "failed")
            )
            .order_by(messages.c.ts.desc())
            .limit(1)
        ).scalar_one_or_none()
        if target_id is None:
            return
        values = {"status": new_status}
        if msg_id:
            values["msg_id"] = msg_id
        conn.execute(sa_update(messages).where(messages.c.id == target_id).values(**values))


def update_status_by_msg_id(msg_id: str, new_status: str) -> list[str]:
    """Update delivery status by GOWA msg_id. Forward-only: sent → delivered → read.

    Does not overwrite 'operator' or 'failed' statuses. Cascades to all prior
    outgoing messages for the same contact (delivered/read are monotonic).
    """
    updated_msg_ids: list[str] = []
    with get_engine().begin() as conn:
        # Update the specific message.
        result = conn.execute(
            sa_update(messages)
            .where(
                (messages.c.msg_id == msg_id)
                & (messages.c.status.is_not(None))
                & (messages.c.status.in_(("sent", "delivered")))
            )
            .values(status=new_status)
        )
        if (result.rowcount or 0) > 0:
            updated_msg_ids.append(msg_id)

        # Find the anchor row to drive the cascade.
        anchor = conn.execute(
            select(messages.c.contact_id, messages.c.ts).where(messages.c.msg_id == msg_id)
        ).first()
        if anchor:
            prior_statuses = ("sent",) if new_status == "delivered" else ("sent", "delivered")
            # Gather IDs first so we can return them to the caller.
            prior_rows = conn.execute(
                select(messages.c.msg_id)
                .where(
                    (messages.c.contact_id == anchor.contact_id)
                    & (messages.c.role == "assistant")
                    & (messages.c.ts <= anchor.ts)
                    & (messages.c.status.in_(prior_statuses))
                    & (messages.c.msg_id.is_not(None))
                    & (messages.c.msg_id != msg_id)
                )
            ).all()
            cascaded = [r.msg_id for r in prior_rows]
            if cascaded:
                conn.execute(
                    sa_update(messages)
                    .where(
                        (messages.c.contact_id == anchor.contact_id)
                        & (messages.c.role == "assistant")
                        & (messages.c.ts <= anchor.ts)
                        & (messages.c.status.in_(prior_statuses))
                    )
                    .values(status=new_status)
                )
                updated_msg_ids.extend(cascaded)
    return updated_msg_ids


def get_contact_id_by_msg_id(msg_id: str) -> int | None:
    """Look up the contact_id for a given GOWA msg_id."""
    with get_engine().connect() as conn:
        cid = conn.execute(
            select(messages.c.contact_id).where(messages.c.msg_id == msg_id).limit(1)
        ).scalar_one_or_none()
    return cid


def update_msg_id_and_status(message_id: int, msg_id: str, status: str) -> None:
    """Set msg_id and status on a message (used after retry-send)."""
    with get_engine().begin() as conn:
        conn.execute(
            sa_update(messages).where(messages.c.id == message_id).values(msg_id=msg_id, status=status)
        )


def delete_all(contact_id: int) -> None:
    """Delete all messages for a contact."""
    with get_engine().begin() as conn:
        conn.execute(sa_delete(messages).where(messages.c.contact_id == contact_id))


def get_by_msg_id(msg_id: str) -> dict | None:
    """Look up a single message by its GOWA msg_id."""
    if not msg_id:
        return None
    with get_engine().connect() as conn:
        row = conn.execute(
            select(messages).where(messages.c.msg_id == msg_id).limit(1)
        ).mappings().first()
    return _row_to_dict(row) if row else None


# `revoked` column encodes WHICH kind of deletion happened, so the UI can show a
# scope-specific label. 0 = not revoked, 1 = "para todos" (delete for everyone),
# 2 = "para mim" (delete for me). Old rows revoked before this distinction existed
# carry 1 and read as "para todos".
_REVOKE_CODE = {"all": 1, "me": 2}


def mark_revoked(msg_id: str, scope: str = "all") -> bool:
    """Mark a message as revoked by its GOWA msg_id. Covers both 'delete for me'
    (scope='me') and 'delete for everyone' (scope='all') — in both cases the message
    is removed from WhatsApp but KEPT in our DB (content/media preserved) so the panel
    still shows it with a scope-specific 'deleted' indicator. Returns True if matched."""
    if not msg_id:
        return False
    with get_engine().begin() as conn:
        result = conn.execute(
            sa_update(messages)
            .where(messages.c.msg_id == msg_id)
            .values(revoked=_REVOKE_CODE.get(scope, 1))
        )
    return (result.rowcount or 0) > 0


def mark_revoked_by_id(message_id: int, scope: str = "me") -> bool:
    """Mark a message as revoked by its DB primary key (for local messages without a
    msg_id, e.g. failed sends / private notes). Content is kept; the row is never
    hard-deleted. Returns True if a row matched."""
    if not message_id:
        return False
    with get_engine().begin() as conn:
        result = conn.execute(
            sa_update(messages).where(messages.c.id == message_id)
            .values(revoked=_REVOKE_CODE.get(scope, 2))
        )
    return (result.rowcount or 0) > 0


def set_reaction(msg_id: str, emoji: str, reactor: str) -> dict | None:
    """Set (or clear, when ``emoji`` is empty) ``reactor``'s reaction on a message.

    Each reactor holds at most one emoji (WhatsApp semantics): a new emoji replaces
    the prior one. Returns the updated ``{emoji: [reactor, ...]}`` map, or None if
    the message doesn't exist.
    """
    if not msg_id:
        return None
    with get_engine().begin() as conn:
        row = conn.execute(
            select(messages.c.id, messages.c.reactions).where(messages.c.msg_id == msg_id).limit(1)
        ).mappings().first()
        if row is None:
            return None
        try:
            data = json.loads(row["reactions"]) if row["reactions"] else {}
        except (ValueError, TypeError):
            data = {}
        # Drop the reactor from every emoji (one reaction per person).
        for em in list(data.keys()):
            data[em] = [r for r in data[em] if r != reactor]
            if not data[em]:
                del data[em]
        if emoji:
            data.setdefault(emoji, [])
            if reactor not in data[emoji]:
                data[emoji].append(reactor)
        conn.execute(
            sa_update(messages).where(messages.c.id == row["id"]).values(
                reactions=json.dumps(data) if data else None
            )
        )
    return data


def _row_to_dict(row) -> dict:
    d = {
        "role": row["role"],
        "content": row["content"],
        "ts": row["ts"],
        "status": row["status"],
        "msg_id": row["msg_id"],
    }
    if row["media_type"]:
        d["media_type"] = row["media_type"]
    if row["media_path"]:
        d["media_path"] = row["media_path"]
    # `revoked` may be absent on very old rows read before the column existed.
    # 1 = "para todos", 2 = "para mim" (see _REVOKE_CODE).
    if row.get("revoked"):
        d["revoked"] = True
        d["revoke_scope"] = "me" if row["revoked"] == 2 else "all"
    if row.get("reactions"):
        try:
            parsed = json.loads(row["reactions"])
            if parsed:
                d["reactions"] = parsed
        except (ValueError, TypeError):
            pass
    # `reply_to_msg_id` may be absent on old rows read before the column existed.
    if row.get("reply_to_msg_id"):
        d["reply_to_msg_id"] = row["reply_to_msg_id"]
    d["_id"] = row["id"]
    return d
