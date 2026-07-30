// Kanban e Lista de Pedidos — Preact + HTM, sem build.
// 5 Statuses Unificados: Novos pedidos -> Em processamento -> Em entrega -> Entregues | Cancelados
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

function mapStatus(status) {
  if (['awaiting_confirmation', 'separating', 'separated'].includes(status)) {
    return 'processing';
  }
  return status || 'new';
}

const COLUMNS = [
  { key: 'new', label: 'Novos pedidos', shortLabel: 'Novos', icon: '📦', dot: 'bg-blue-500', border: 'border-blue-500/40' },
  { key: 'processing', label: 'Em processamento', shortLabel: 'Processando', icon: '🔄', dot: 'bg-amber-500', border: 'border-amber-500/40' },
  { key: 'out_for_delivery', label: 'Em entrega', shortLabel: 'Em entrega', icon: '🚚', dot: 'bg-teal-500', border: 'border-teal-500/40' },
  { key: 'delivered', label: 'Entregues', shortLabel: 'Entregues', icon: '✅', dot: 'bg-emerald-500', border: 'border-emerald-500/40' },
  { key: 'cancelled', label: 'Cancelados', shortLabel: 'Cancelados', icon: '❌', dot: 'bg-rose-500', border: 'border-rose-500/40' },
];

function cleanItemText(str) {
  if (!str) return '';
  return str.replace(/^[\s\-\*\d\.\)]+/, '').trim();
}

function itemsSummary(items) {
  if (!items || !items.length) return 'Sem itens';
  const names = items.map((it) => `${it.quantity ? it.quantity + 'x ' : ''}${cleanItemText(it.name)}`);
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function formatMoney(val, currency = 'BRL') {
  if (val == null || val === '') return null;
  const num = Number(val);
  if (isNaN(num)) return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(num);
  } catch {
    return `R$ ${num.toFixed(2)}`;
  }
}

function timeAgo(ts) {
  if (!ts) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('whatsbot_token') || '';
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  return fetch(url, { ...options, headers });
}

function openConversation(contactId) {
  if (contactId) {
    window.location.href = `/conversas?contact=${contactId}`;
  } else {
    window.location.href = '/conversas';
  }
}

function OrderCard({ order, onOpen, onDragStart, onMove, onTogglePayment, flashed }) {
  const itemsText = itemsSummary(order.items);
  const total = formatMoney(order.estimated_total, order.currency);
  const mappedCurrent = mapStatus(order.status);
  const colIndex = COLUMNS.findIndex((c) => c.key === mappedCurrent);
  const prevCol = colIndex > 0 ? COLUMNS[colIndex - 1] : null;
  const nextCol = colIndex >= 0 && colIndex < COLUMNS.length - 1 ? COLUMNS[colIndex + 1] : null;

  return html`
    <div
      draggable="true"
      ondragstart=${(e) => onDragStart(e, order.id)}
      onClick=${() => onOpen(order)}
      class="bg-wa-bg rounded-xl border border-wa-border hover:border-wa-teal transition-all p-2.5 shadow-2xs cursor-pointer flex flex-col gap-1.5 relative group ${flashed ? 'ring-2 ring-wa-teal animate-pulse' : ''}"
    >
      <!-- Card Header: ID + Name + WhatsApp Quick Button -->
      <div class="flex items-center justify-between gap-1 min-w-0">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="text-[11px] font-bold text-wa-teal font-mono bg-wa-teal/10 px-1.5 py-0.5 rounded-md shrink-0">
            #${order.id}
          </span>
          <span class="text-xs font-bold text-wa-text truncate min-w-0">
            ${order.contact_name || order.contact_phone}
          </span>
        </div>
        <a
          href="https://wa.me/${(order.contact_phone || '').replace(/\D/g, '')}"
          target="_blank"
          rel="noopener noreferrer"
          onClick=${(e) => e.stopPropagation()}
          title="WhatsApp direto"
          class="text-emerald-500 hover:bg-emerald-500/10 p-1 rounded-md transition-colors shrink-0"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.66 15L2 22l5.12-1.34A10 10 0 1 0 12 2zm0 18a8 8 0 0 1-4.1-.1.1l-.3-.07-3.04.8.8-2.96-.2-.33A8 8 0 1 1 12 20zm4.4-6c-.24-.12-1.42-.7-1.64-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06s-1.02-.38-1.94-1.2c-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.1-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42s-.54-1.3-.74-1.78c-.2-.48-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3s-.84.82-.84 2c0 1.18.86 2.32.98 2.48.12.16 1.7 2.6 4.12 3.64.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.2-.16-.44-.28z"/></svg>
        </a>
      </div>

      <!-- Items summary -->
      <div class="text-[11px] text-wa-text truncate bg-wa-panel px-2 py-1 rounded-lg border border-wa-border/50 font-medium">
        ${itemsText}
      </div>

      <!-- Payment + Total + Time -->
      <div class="flex items-center justify-between gap-1 pt-1 border-t border-wa-border/50">
        <button
          onClick=${(e) => { e.stopPropagation(); onTogglePayment && onTogglePayment(order); }}
          class="text-[9.5px] font-bold px-1.5 py-0.2 rounded-full border transition-all ${order.payment_status === 'paid' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : 'bg-amber-500/15 text-amber-600 border-amber-500/30'}"
        >
          ${order.payment_status === 'paid' ? 'Pago' : 'Pendente'}
        </button>
        ${total ? html`<span class="text-[11px] font-black text-emerald-500 tabular-nums">${total}</span>` : null}
      </div>

      <!-- Quick Move Controls -->
      ${onMove ? html`
        <div class="flex items-center justify-between pt-0.5 text-[9.5px] text-wa-secondary">
          <button
            disabled=${!prevCol}
            onClick=${(e) => { e.stopPropagation(); prevCol && onMove(order.id, prevCol.key); }}
            class="hover:text-wa-text disabled:opacity-0 cursor-pointer"
          >
            ‹ ${prevCol?.shortLabel || ''}
          </button>
          <span class="text-[9px] text-wa-secondary">${timeAgo(order.created_at)}</span>
          <button
            disabled=${!nextCol}
            onClick=${(e) => { e.stopPropagation(); nextCol && onMove(order.id, nextCol.key); }}
            class="text-wa-teal font-bold disabled:opacity-0 cursor-pointer"
          >
            ${nextCol?.shortLabel || ''} ›
          </button>
        </div>
      ` : null}
    </div>
  `;
}

const QUICK_MESSAGES = [
  { label: '🔄 Em processamento', text: 'Seu pedido entrou em processamento! 🔄' },
  { label: '💳 Aguardando pagamento', text: 'Só falta a confirmação do pagamento pra gente dar sequência ao seu pedido.' },
  { label: '⚠️ Produto acabou', text: 'Um dos itens do seu pedido acabou no estoque — podemos trocar por outra opção?' },
  { label: '🚚 Entregador saiu', text: 'Seu pedido acabou de sair para entrega! 🚚' },
  { label: '🎉 Pedido entregue', text: 'Pedido entregue com sucesso! Muito obrigado pela preferência 🙏' },
];

const ICON = {
  send: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  money: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`,
  print: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`,
  truck: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5-1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`,
  check: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  x: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  arrow: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`,
  trash: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
};

function normalizeItems(items) {
  return (items || []).map((it) => ({
    status: (it.status && it.status !== 'pending') ? it.status : 'resolved',
    ...it,
  }));
}

function ItemRow({ item, idx, onStatusChange, onAction, onNoteChange, onDelete }) {
  const [showMenu, setShowMenu] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(item.notes || '');

  return html`
    <div class="flex flex-col gap-2 p-3 rounded-xl border transition-all ${item.status === 'problem' ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${item.status === 'problem' ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'}">
            ${item.status === 'problem' ? '✕' : '✓'}
          </span>
          <div class="min-w-0 flex-1">
            <span class="text-xs font-bold text-wa-text block truncate">
              ${item.quantity ? `${item.quantity}x ` : ''}${cleanItemText(item.name)}
            </span>
            ${item.notes ? html`<span class="text-[11px] text-wa-secondary block truncate">📝 ${item.notes}</span>` : null}
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button
            onClick=${() => onStatusChange(idx, item.status === 'problem' ? 'resolved' : 'problem')}
            class="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${item.status === 'problem' ? 'bg-rose-500 text-white shadow-2xs' : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/30'}"
            title="Alternar entre Disponível e Indisponível"
          >
            ${item.status === 'problem' ? '✕ Indisponível' : '✓ Disponível'}
          </button>

          <!-- Dropdown Ações Contextuais -->
          <div class="relative">
            <button
              onClick=${() => setShowMenu(!showMenu)}
              class="px-2.5 py-1 text-xs font-bold rounded-lg border border-wa-border bg-wa-bg hover:bg-wa-hover text-wa-text transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
            >
              <span>⚡ Ações</span>
              <span class="text-[9px]">▼</span>
            </button>

            ${showMenu ? html`
              <div
                class="absolute right-0 top-full mt-1 w-56 bg-wa-panel border border-wa-border rounded-xl shadow-xl z-30 py-1 flex flex-col text-xs text-wa-text animate-fadeIn"
                onClick=${() => setShowMenu(false)}
              >
                <button
                  onClick=${() => { onStatusChange(idx, 'problem'); onAction(idx, 'unavailable'); }}
                  class="px-3 py-2 text-left hover:bg-rose-500/10 text-rose-500 font-semibold flex items-center gap-2"
                >
                  <span>🚫</span> <span>Item indisponível</span>
                </button>

                <button
                  onClick=${() => onAction(idx, 'ask_brand')}
                  class="px-3 py-2 text-left hover:bg-wa-hover font-medium flex items-center gap-2"
                >
                  <span>🏷️</span> <span>Perguntar marca</span>
                </button>

                <button
                  onClick=${() => onAction(idx, 'ask_qty')}
                  class="px-3 py-2 text-left hover:bg-wa-hover font-medium flex items-center gap-2"
                >
                  <span>🔢</span> <span>Perguntar quantidade</span>
                </button>

                <button
                  onClick=${() => setEditingNote(true)}
                  class="px-3 py-2 text-left hover:bg-wa-hover font-medium flex items-center gap-2"
                >
                  <span>📝</span> <span>Adicionar observação</span>
                </button>

                <div class="border-t border-wa-border my-1"></div>

                <button
                  onClick=${() => onDelete(idx)}
                  class="px-3 py-2 text-left hover:bg-rose-500/10 text-rose-600 font-medium flex items-center gap-2"
                >
                  <span>🗑️</span> <span>Remover item</span>
                </button>
              </div>
            ` : null}
          </div>
        </div>
      </div>

      ${editingNote ? html`
        <div class="flex items-center gap-2 pt-1">
          <input
            type="text"
            value=${noteText}
            onInput=${(e) => setNoteText(e.target.value)}
            placeholder="Ex: Marca Barilla..."
            class="flex-1 bg-wa-bg text-wa-text text-xs px-2.5 py-1.5 rounded-lg border border-wa-border focus:border-wa-teal focus:outline-none"
          />
          <button
            onClick=${() => { onNoteChange(idx, noteText); setEditingNote(false); }}
            class="px-3 py-1.5 text-xs font-bold rounded-lg bg-wa-teal text-white cursor-pointer"
          >
            Salvar
          </button>
          <button
            onClick=${() => setEditingNote(false)}
            class="px-2 py-1.5 text-xs text-wa-secondary hover:text-wa-text cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      ` : null}
    </div>
  `;
}

function OrderDetailPage({ order, onClose, onSave, onDelete }) {
  const [status, setStatus] = useState(mapStatus(order.status));
  const [paymentStatus, setPaymentStatus] = useState(order.payment_status);
  const [priority, setPriority] = useState(order.priority);
  const [deliveryType, setDeliveryType] = useState(order.delivery_type || '');
  const [notes, setNotes] = useState(order.notes || '');
  const [estimatedTotal, setEstimatedTotal] = useState(order.estimated_total != null ? order.estimated_total : '');
  const [items, setItems] = useState(() => normalizeItems(order.items));
  const [itemFilter, setItemFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askText, setAskText] = useState('');
  const [askItemIndex, setAskItemIndex] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [askSuccess, setAskSuccess] = useState('');
  const [history, setHistory] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sendingValue, setSendingValue] = useState(false);
  const [valueSent, setValueSent] = useState(false);

  useEffect(() => {
    setItems(normalizeItems(order.items));
  }, [order.items]);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/plugins/orders/orders/${order.id}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.ok) setHistory(d.data.history || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [order.id]);

  const resolvedCount = items.filter((it) => it.status === 'resolved').length;
  const problemCount = items.filter((it) => it.status === 'problem').length;
  const progressPct = items.length ? Math.round((resolvedCount / items.length) * 100) : 0;

  const visibleItems = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => itemFilter === 'all' || (itemFilter === 'resolved' ? it.status === 'resolved' : itemFilter === 'problem' ? it.status === 'problem' : true));

  function updateItemStatus(idx, newStatus) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, status: newStatus } : it)));
  }

  function updateItemNote(idx, newNote) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, notes: newNote } : it)));
  }

  function deleteItem(idx) {
    setItems((cur) => cur.filter((_, i) => i !== idx));
  }

  function handleItemAction(idx, actionType) {
    const item = items[idx];
    if (!item) return;
    const itemName = cleanItemText(item.name);
    setAskItemIndex(idx);

    if (actionType === 'unavailable') {
      updateItemStatus(idx, 'problem');
      setAskText(`Olá! Infelizmente o item "${itemName}" está indisponível no momento. Gostaria de substituir por outro produto ou cancelar este item?`);
    } else if (actionType === 'ask_brand') {
      setAskText(`Olá! Qual a sua preferência de marca para o item "${itemName}"?`);
    } else if (actionType === 'ask_qty') {
      setAskText(`Olá! Poderia me confirmar a quantidade desejada do item "${itemName}"?`);
    }

    setTimeout(() => {
      const el = document.getElementById('whatsapp-composer-box');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }

  async function handleSave(overrideStatus) {
    const finalStatus = overrideStatus || status;
    setSaving(true);
    try {
      if (finalStatus !== order.status) {
        await apiFetch(`/api/plugins/orders/orders/${order.id}/status`, {
          method: 'POST', body: JSON.stringify({ status: finalStatus }),
        });
      }
      const totalNum = estimatedTotal !== '' ? Number(estimatedTotal) : order.estimated_total;
      await apiFetch(`/api/plugins/orders/orders/${order.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          payment_status: paymentStatus,
          priority,
          notes,
          items,
          delivery_type: deliveryType || null,
          estimated_total: isNaN(totalNum) ? null : totalNum,
        }),
      });
      onSave();
    } finally {
      setSaving(false);
    }
  }

  const colIndex = COLUMNS.findIndex((c) => c.key === status);
  const nextStep = colIndex >= 0 && colIndex < COLUMNS.length - 1 ? COLUMNS[colIndex + 1] : null;

  async function handleAdvance() {
    if (!nextStep) return;
    setStatus(nextStep.key);
    await handleSave(nextStep.key);
  }

  async function handleDelete() {
    await apiFetch(`/api/plugins/orders/orders/${order.id}`, { method: 'DELETE' });
    onDelete(order.id);
    onClose();
  }

  async function sendToCustomer(text, itemIndex) {
    const rawPhone = order.contact_phone || '';
    const phone = rawPhone.replace(/\D/g, '') || rawPhone;
    const sendRes = await apiFetch(`/api/contacts/${encodeURIComponent(phone)}/send`, {
      method: 'POST', body: JSON.stringify({ message: text }),
    });
    const sendData = await sendRes.json();
    if (!sendData.ok) throw new Error(sendData.error || 'Falha ao enviar mensagem pelo WhatsApp.');
    try {
      await apiFetch(`/api/plugins/orders/orders/${order.id}/messages`, {
        method: 'POST', body: JSON.stringify({ text, item_index: itemIndex }),
      });
    } catch {}
  }

  async function handleAsk() {
    const text = askText.trim();
    if (!text) return;
    setAsking(true);
    setAskError('');
    setAskSuccess('');
    try {
      await sendToCustomer(text, askItemIndex);
      setAskSuccess('Mensagem enviada com sucesso ao cliente!');
      setAskText('');
      setAskItemIndex(null);
      setTimeout(() => setAskSuccess(''), 4000);
      onSave();
    } catch (e) {
      setAskError(String(e.message || e));
    } finally {
      setAsking(false);
    }
  }

  async function handleSendValue() {
    const totalFormatted = formatMoney(estimatedTotal !== '' ? estimatedTotal : order.estimated_total, order.currency);
    const resumo = itemsSummary(items);
    const pgto = order.payment_method || 'A combinar';
    const text = `*Resumo do Pedido #${order.id}*\n\n📋 *Itens:* ${resumo}\n💵 *Total:* ${totalFormatted || 'R$ ' + estimatedTotal}\n💳 *Pagamento:* ${pgto}\n\nQualquer dúvida, estamos à disposição!`;
    setSendingValue(true);
    setAskError('');
    setAskSuccess('');
    try {
      await sendToCustomer(text, null);
      setValueSent(true);
      setAskSuccess('Resumo do pedido enviado com sucesso pelo WhatsApp!');
      setTimeout(() => { setValueSent(false); setAskSuccess(''); }, 4000);
      handleSave();
    } catch (e) {
      setAskError(String(e.message || e));
    } finally {
      setSendingValue(false);
    }
  }

  async function quickStatusAction(newStatus) {
    await apiFetch(`/api/plugins/orders/orders/${order.id}/status`, {
      method: 'POST', body: JSON.stringify({ status: newStatus }),
    });
    onSave();
  }

  const mapsUrl = order.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
    : null;

  return html`
    <div class="flex flex-col gap-4 text-wa-text">
      <!-- Header Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-wa-border">
        <div class="flex items-center gap-3">
          <button
            onClick=${onClose}
            class="p-1.5 rounded-full hover:bg-wa-hover text-wa-secondary hover:text-wa-text transition-colors cursor-pointer"
            title="Voltar ao Kanban"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-lg font-bold text-wa-text tracking-tight">Pedido #${order.id}</h1>
              <span class="text-xs font-mono px-2 py-0.5 rounded-md bg-wa-bg border border-wa-border text-wa-secondary">
                ${order.contact_name || order.contact_phone}
              </span>
            </div>
            <span class="text-[11px] text-wa-secondary">Criado em ${new Date(order.created_at * 1000).toLocaleString('pt-BR')}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <select
            value=${status}
            onChange=${(e) => setStatus(e.target.value)}
            class="bg-wa-bg text-wa-text text-xs font-bold px-3 py-2 rounded-xl border border-wa-border focus:border-wa-teal focus:outline-none"
          >
            ${COLUMNS.map((c) => html`<option value=${c.key}>${c.label}</option>`)}
          </select>

          <button
            onClick=${() => openConversation(order.contact_id)}
            class="px-3 py-2 text-xs font-semibold rounded-xl border border-wa-border bg-wa-bg hover:bg-wa-hover text-wa-text transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            💬 Abrir Conversa
          </button>

          <button
            onClick=${() => handleSave()}
            disabled=${saving}
            class="px-4 py-2 text-xs font-bold rounded-xl border border-wa-border bg-wa-bg hover:bg-wa-hover text-wa-text transition-colors disabled:opacity-50 cursor-pointer"
          >
            ${saving ? 'Salvando…' : 'Salvar Alterações'}
          </button>

          ${nextStep ? html`
            <button
              onClick=${handleAdvance}
              disabled=${saving}
              class="px-4 py-2 text-xs font-bold rounded-xl bg-wa-teal text-white hover:opacity-90 transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <span>Avançar: ${nextStep.label}</span>
              ${ICON.arrow}
            </button>
          ` : null}
        </div>
      </div>

      <!-- Top Metric Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <!-- Card 1: Progress -->
        <div class="bg-wa-bg rounded-2xl p-3.5 border border-wa-border flex flex-col justify-between gap-2 shadow-2xs">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-wa-secondary uppercase tracking-wider">Progresso dos Itens</span>
            <span class="text-xs font-bold text-wa-teal">${progressPct}%</span>
          </div>
          <div class="text-sm font-semibold text-wa-text">${resolvedCount} de ${items.length} disponíveis</div>
          <div class="w-full h-2 bg-wa-panel rounded-full overflow-hidden border border-wa-border/40">
            <div class="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-300" style="width: ${progressPct}%"></div>
          </div>
        </div>

        <!-- Card 2: Order Total (EDITABLE INPUT) + Send Value Button -->
        <div class="bg-wa-bg rounded-2xl p-3.5 border border-wa-border flex flex-col justify-between gap-2 shadow-2xs">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-wa-secondary uppercase tracking-wider">Valor do Pedido (R$)</span>
            <span class="text-[10px] text-wa-secondary">Editável</span>
          </div>
          <div class="flex items-center gap-1 bg-wa-panel px-2.5 py-1 rounded-xl border border-wa-border focus-within:border-wa-teal">
            <span class="text-xs font-bold text-emerald-500">R$</span>
            <input
              type="text"
              value=${estimatedTotal}
              onInput=${(e) => setEstimatedTotal(e.target.value)}
              placeholder="0,00"
              class="w-full bg-transparent text-emerald-500 font-black text-base focus:outline-none tabular-nums"
            />
          </div>
          <button
            onClick=${handleSendValue}
            disabled=${sendingValue}
            class="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            ${sendingValue ? html`<span>Enviando...</span>` : valueSent ? html`<span>✓ Resumo Enviado!</span>` : html`${ICON.send} <span>Enviar Resumo ao Cliente</span>`}
          </button>
        </div>

        <!-- Card 3: Payment Status -->
        <div class="bg-wa-bg rounded-2xl p-3.5 border border-wa-border flex flex-col justify-between gap-2 shadow-2xs">
          <div class="text-[11px] font-bold text-wa-secondary uppercase tracking-wider">Pagamento</div>
          <select
            value=${paymentStatus}
            onChange=${(e) => setPaymentStatus(e.target.value)}
            class="bg-wa-panel text-wa-text text-xs font-semibold px-3 py-2 rounded-xl border border-wa-border focus:border-wa-teal focus:outline-none"
          >
            <option value="pending">⏳ Pendente</option>
            <option value="paid">✓ Pago</option>
          </select>
        </div>

        <!-- Card 4: Delivery Type & Priority -->
        <div class="bg-wa-bg rounded-2xl p-3.5 border border-wa-border flex flex-col justify-between gap-2 shadow-2xs">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-[10px] font-bold text-wa-secondary uppercase mb-1">Entrega</label>
              <select
                value=${deliveryType}
                onChange=${(e) => setDeliveryType(e.target.value)}
                class="bg-wa-panel text-wa-text text-xs font-semibold w-full px-2 py-1.5 rounded-lg border border-wa-border focus:outline-none"
              >
                <option value="">—</option>
                <option value="delivery">🛵 Entrega</option>
                <option value="pickup">📦 Retirada</option>
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-bold text-wa-secondary uppercase mb-1">Prioridade</label>
              <select
                value=${priority}
                onChange=${(e) => setPriority(e.target.value)}
                class="bg-wa-panel text-wa-text text-xs font-semibold w-full px-2 py-1.5 rounded-lg border border-wa-border focus:outline-none"
              >
                <option value="normal">Normal</option>
                <option value="high">🚨 Urgente</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Main Layout 2-Columns Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <!-- Left Main Column: Items & WhatsApp Communication -->
        <div class="flex flex-col gap-4">
          <!-- Items List Card -->
          <div class="bg-wa-bg rounded-2xl border border-wa-border p-4 flex flex-col gap-3 shadow-2xs">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 class="text-sm font-bold text-wa-text tracking-tight">Painel de Resolução de Itens (${items.length})</h2>
                <span class="text-[11px] text-emerald-500 font-medium">✓ Todos os itens estão marcados como disponíveis por padrão.</span>
              </div>

              <!-- Item Status Filter Chips -->
              <div class="flex items-center gap-1 p-0.5 bg-wa-panel rounded-xl border border-wa-border">
                ${[['all', 'Todos'], ['resolved', 'Disponíveis'], ['problem', 'Indisponíveis']].map(([key, label]) => html`
                  <button
                    key=${key}
                    onClick=${() => setItemFilter(key)}
                    class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${itemFilter === key ? 'bg-wa-bg text-wa-text shadow-2xs' : 'text-wa-secondary hover:text-wa-text'}"
                  >
                    ${label}
                  </button>
                `)}
              </div>
            </div>

            <div class="flex flex-col gap-2 max-h-[380px] overflow-y-auto wa-scrollbar pr-1">
              ${visibleItems.length === 0 ? html`
                <div class="text-xs text-wa-secondary py-8 text-center font-medium italic border border-dashed border-wa-border/50 rounded-xl">
                  Nenhum item neste filtro.
                </div>
              ` : null}
              ${visibleItems.map(({ it, idx }) => html`
                <${ItemRow}
                  key=${idx}
                  item=${it}
                  idx=${idx}
                  onStatusChange=${updateItemStatus}
                  onAction=${handleItemAction}
                  onNoteChange=${updateItemNote}
                  onDelete=${deleteItem}
                />
              `)}
            </div>
          </div>

          <!-- WhatsApp Communication Composer Card -->
          <div id="whatsapp-composer-box" class="bg-wa-bg rounded-2xl border border-wa-border p-4 flex flex-col gap-3 shadow-2xs transition-all">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-bold text-wa-text tracking-tight flex items-center gap-1.5">
                <span class="text-emerald-500">💬</span>
                <span>Comunicação com o Cliente (WhatsApp)</span>
              </h2>
              ${askItemIndex !== null ? html`
                <span class="text-[11px] text-wa-teal font-bold px-2 py-0.5 rounded-full bg-wa-teal/15 border border-wa-teal/30">
                  Foco: ${cleanItemText(items[askItemIndex]?.name || 'Item')}
                  <button onClick=${() => setAskItemIndex(null)} class="ml-1 text-wa-secondary hover:underline cursor-pointer">(limpar)</button>
                </span>
              ` : null}
            </div>

            <!-- Feedback Alerts -->
            ${askSuccess ? html`
              <div class="p-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-xl flex items-center gap-2">
                <span>✓</span> <span>${askSuccess}</span>
              </div>
            ` : null}
            ${askError ? html`
              <div class="p-3 bg-rose-500/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl flex items-center gap-2">
                <span>⚠️</span> <span>${askError}</span>
              </div>
            ` : null}

            <!-- Quick Template Chips -->
            <div>
              <label class="block text-[10px] font-bold text-wa-secondary uppercase tracking-wider mb-1.5">Modelos Rápidos</label>
              <div class="flex flex-wrap gap-1.5">
                ${QUICK_MESSAGES.map((qm) => html`
                  <button
                    key=${qm.label}
                    onClick=${() => { setAskItemIndex(null); setAskText(qm.text); }}
                    class="px-2.5 py-1 rounded-xl text-xs font-medium bg-wa-panel hover:bg-wa-hover text-wa-text border border-wa-border transition-colors cursor-pointer"
                  >
                    ${qm.label}
                  </button>
                `)}
              </div>
            </div>

            <!-- Text area & Action Buttons -->
            <textarea
              value=${askText}
              onInput=${(e) => setAskText(e.target.value)}
              rows="3"
              placeholder="Ao clicar nas Ações dos itens ou nos modelos, a mensagem é preparada automaticamente aqui..."
              class="w-full bg-wa-panel text-wa-text text-xs p-3 rounded-xl border border-wa-border focus:border-wa-teal focus:outline-none transition-all resize-none font-sans"
            ></textarea>

            <div class="flex items-center justify-end gap-2">
              ${askText ? html`
                <button
                  onClick=${() => setAskText('')}
                  class="px-3 py-2 text-xs font-semibold text-wa-secondary hover:text-wa-text transition-colors"
                >
                  Limpar
                </button>
              ` : null}
              <button
                onClick=${handleAsk}
                disabled=${asking || !askText.trim()}
                class="px-4 py-2 text-xs font-bold rounded-xl bg-wa-teal text-white hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                ${ICON.send}
                <span>${asking ? 'Enviando ao WhatsApp…' : 'Enviar no WhatsApp'}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Right Sidebar: Customer Info, Quick Actions & History -->
        <div class="flex flex-col gap-4">
          <!-- Customer Info Card -->
          <div class="bg-wa-bg rounded-2xl border border-wa-border p-4 flex flex-col gap-2.5 shadow-2xs">
            <h3 class="text-xs font-bold text-wa-secondary uppercase tracking-wider">Dados do Cliente</h3>
            <div class="flex flex-col">
              <span class="text-sm font-bold text-wa-text">${order.contact_name || order.contact_phone}</span>
              <span class="text-xs text-wa-secondary font-mono">${order.contact_phone}</span>
            </div>

            ${order.address ? html`
              <div class="p-2.5 bg-wa-panel rounded-xl border border-wa-border text-xs text-wa-text font-medium flex flex-col gap-1.5">
                <span class="text-wa-secondary text-[10px] font-bold uppercase">Endereço de Entrega</span>
                <span>${order.address}</span>
                <div class="flex items-center gap-3 pt-1 text-[11px]">
                  ${mapsUrl ? html`
                    <a href=${mapsUrl} target="_blank" rel="noopener noreferrer" class="text-wa-teal font-semibold hover:underline flex items-center gap-1">
                      🗺️ Ver no Mapa
                    </a>
                  ` : null}
                  <button
                    onClick=${() => navigator.clipboard && navigator.clipboard.writeText(order.address)}
                    class="text-wa-teal font-semibold hover:underline cursor-pointer"
                  >
                    📋 Copiar Endereço
                  </button>
                </div>
              </div>
            ` : null}
          </div>

          <!-- Quick Actions Card -->
          <div class="bg-wa-bg rounded-2xl border border-wa-border p-4 flex flex-col gap-2.5 shadow-2xs">
            <h3 class="text-xs font-bold text-wa-secondary uppercase tracking-wider">Ações Rápidas</h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                onClick=${() => window.print()}
                class="p-2.5 rounded-xl border border-wa-border bg-wa-panel hover:bg-wa-hover text-xs font-semibold text-wa-text transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                ${ICON.print} Imprimir
              </button>
              <button
                onClick=${() => quickStatusAction('out_for_delivery')}
                class="p-2.5 rounded-xl border border-wa-border bg-wa-panel hover:bg-wa-hover text-xs font-semibold text-wa-text transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                ${ICON.truck} Chamar Entrega
              </button>
              <button
                onClick=${() => quickStatusAction('delivered')}
                class="col-span-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                ${ICON.check} Marcar como Entregue
              </button>
            </div>
          </div>

          <!-- Risk / Danger Zone Card -->
          <div class="bg-wa-bg rounded-2xl border border-rose-500/30 p-4 flex flex-col gap-2.5 shadow-2xs">
            <h3 class="text-xs font-bold text-rose-500 uppercase tracking-wider">Zona de Controle</h3>
            <div class="flex flex-col gap-2">
              ${confirmCancel ? html`
                <div class="flex items-center gap-2 p-2 bg-rose-500/10 rounded-xl border border-rose-500/20">
                  <span class="text-xs font-semibold text-rose-600 flex-1">Cancelar pedido?</span>
                  <button onClick=${() => { setConfirmCancel(false); quickStatusAction('cancelled'); }} class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white">Sim</button>
                  <button onClick=${() => setConfirmCancel(false)} class="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-wa-panel text-wa-text">Não</button>
                </div>
              ` : html`
                <button
                  onClick=${() => setConfirmCancel(true)}
                  class="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 transition-colors text-left cursor-pointer"
                >
                  🚫 Cancelar Pedido
                </button>
              `}

              ${confirmDelete ? html`
                <div class="flex items-center gap-2 p-2 bg-rose-500/10 rounded-xl border border-rose-500/20">
                  <span class="text-xs font-semibold text-rose-600 flex-1">Excluir permanentemente?</span>
                  <button onClick=${handleDelete} class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white">Excluir</button>
                  <button onClick=${() => setConfirmDelete(false)} class="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-wa-panel text-wa-text">Cancelar</button>
                </div>
              ` : html`
                <button
                  onClick=${() => setConfirmDelete(true)}
                  class="px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/15 transition-colors text-left cursor-pointer"
                >
                  🗑️ Excluir Registro
                </button>
              `}
            </div>
          </div>

          <!-- History Timeline Card -->
          <div class="bg-wa-bg rounded-2xl border border-wa-border p-4 flex flex-col gap-2.5 shadow-2xs">
            <h3 class="text-xs font-bold text-wa-secondary uppercase tracking-wider">Histórico</h3>
            <div class="flex flex-col gap-2 max-h-[220px] overflow-y-auto wa-scrollbar pr-1">
              ${history === null ? html`
                <div class="text-xs text-wa-secondary italic">Carregando histórico…</div>
              ` : history.length === 0 ? html`
                <div class="text-xs text-wa-secondary italic">Nenhum evento registrado ainda.</div>
              ` : history.map((h) => html`
                <div key=${h.id} class="text-xs border-l-2 border-wa-teal/60 pl-2 py-0.5">
                  <span class="text-[10px] text-wa-secondary block font-mono">
                    ${new Date(h.ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span class="text-xs text-wa-text font-medium block">
                    ${h.field}: ${h.old_value || '—'} → ${h.new_value || '—'}
                  </span>
                </div>
              `)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export default function OrdersScreen({ apiBase = '/api/plugins/orders' } = {}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [selected, setSelected] = useState(null);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' | 'list'
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  async function load() {
    try {
      const r = await apiFetch(`${apiBase}/orders`);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'erro');
      setOrders(data.data || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onopen = () => setWsOk(true);
    ws.onclose = () => setWsOk(false);
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (ev.event === 'plugin_orders_created' && ev.data) {
          setOrders((prev) => (prev.find((o) => o.id === ev.data.id) ? prev : [ev.data, ...prev]));
        } else if ((ev.event === 'plugin_orders_updated' || ev.event === 'plugin_orders_status_changed') && ev.data) {
          setOrders((prev) => prev.map((o) => (o.id === ev.data.id ? ev.data : o)));
        } else if (ev.event === 'plugin_orders_deleted' && ev.data) {
          setOrders((prev) => prev.filter((o) => o.id !== ev.data.id));
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const [dragOverCol, setDragOverCol] = useState(null);
  const [flashId, setFlashId] = useState(null);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const mapped = mapStatus(o.status);
      if (filterStatus !== 'all' && mapped !== filterStatus) return false;
      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase().trim();
      const name = (o.contact_name || '').toLowerCase();
      const phone = (o.contact_phone || '').toLowerCase();
      const items = (o.items || []).map((it) => (it.name || '').toLowerCase()).join(' ');
      return name.includes(term) || phone.includes(term) || items.includes(term);
    });
  }, [orders, filterStatus, searchTerm]);

  const grouped = useMemo(() => {
    const g = {};
    for (const c of COLUMNS) g[c.key] = [];
    for (const o of filteredOrders) {
      const st = mapStatus(o.status);
      (g[st] || (g[st] = [])).push(o);
    }
    return g;
  }, [filteredOrders]);

  function handleDragStart(e, id) {
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.effectAllowed = 'move';
  }

  async function moveOrder(id, status) {
    const prev = orders;
    setOrders((cur) => cur.map((o) => (o.id === id ? { ...o, status } : o)));
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 900);
    try {
      const r = await apiFetch(`${apiBase}/orders/${id}/status`, {
        method: 'POST', body: JSON.stringify({ status }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error);
      setOrders((cur) => cur.map((o) => (o.id === id ? data.data : o)));
    } catch (e) {
      setOrders(prev);
      setError(String(e.message || e));
    }
  }

  async function togglePaymentStatus(order) {
    const nextStatus = order.payment_status === 'paid' ? 'pending' : 'paid';
    const prev = orders;
    setOrders((cur) => cur.map((o) => (o.id === order.id ? { ...o, payment_status: nextStatus } : o)));
    try {
      const r = await apiFetch(`${apiBase}/orders/${order.id}`, {
        method: 'PUT',
        body: JSON.stringify({ payment_status: nextStatus }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error);
    } catch (e) {
      setOrders(prev);
    }
  }

  function handleDrop(e, status) {
    e.preventDefault();
    setDragOverCol(null);
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (id) moveOrder(id, status);
  }

  const activeColumns = useMemo(() => {
    if (filterStatus === 'all') return COLUMNS;
    return COLUMNS.filter((c) => c.key === filterStatus);
  }, [filterStatus]);

  return html`
    <div class="flex flex-col gap-2 h-full min-h-0 flex-1 w-full max-w-none overflow-hidden">
      <!-- Clean Top Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-2 shrink-0 w-full">
        <div class="flex items-center gap-2">
          <h1 class="text-base font-bold text-wa-text tracking-tight">Pedidos</h1>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border border-teal-500/40 bg-teal-500/10 text-teal-400">
            ${wsOk ? '● ao vivo' : '○ offline'}
          </span>
          <span class="text-xs text-wa-secondary font-medium hidden sm:inline">
            (${filteredOrders.length} ${filteredOrders.length === 1 ? 'pedido' : 'pedidos'})
          </span>
        </div>

        <div class="flex items-center gap-2 flex-wrap flex-1 sm:flex-initial justify-end">
          <!-- Search box -->
          <div class="relative flex-1 sm:w-56">
            <input
              type="text"
              value=${searchTerm}
              onInput=${(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar..."
              class="w-full bg-wa-bg text-wa-text text-xs pl-7 pr-3 py-1.5 rounded-xl border border-wa-border focus:border-wa-teal focus:outline-none transition-all"
            />
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" class="absolute left-2.5 top-2.5 text-wa-secondary"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            ${searchTerm ? html`
              <button onClick=${() => setSearchTerm('')} class="absolute right-2 top-1.5 text-wa-secondary hover:text-wa-text text-xs">×</button>
            ` : null}
          </div>


        </div>
      </div>

      <!-- Filter chips row for 5 unified statuses -->
      <div class="flex flex-wrap items-center gap-1.5 shrink-0 w-full">
        <button
          onClick=${() => setFilterStatus('all')}
          class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border ${filterStatus === 'all' ? 'bg-wa-teal text-white border-wa-teal' : 'bg-wa-panel text-wa-secondary border-wa-border hover:text-wa-text'}"
        >
          Todos (${orders.length})
        </button>
        ${COLUMNS.map((col) => {
          const count = orders.filter((o) => mapStatus(o.status) === col.key).length;
          const isSelected = filterStatus === col.key;
          return html`
            <button
              key=${col.key}
              onClick=${() => setFilterStatus(col.key)}
              class="px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border ${isSelected ? 'bg-wa-teal text-white border-wa-teal font-bold' : 'bg-wa-panel text-wa-secondary border-wa-border hover:text-wa-text'}"
            >
              <span>${col.icon}</span>
              <span>${col.label} (${count})</span>
            </button>
          `;
        })}
      </div>

      ${error ? html`<div class="text-xs text-rose-500 bg-rose-500/10 p-2 rounded-xl border border-rose-500/20 font-medium">Erro: ${error}</div>` : null}

      ${loading
        ? html`<div class="flex-1 flex items-center justify-center text-wa-secondary text-xs font-medium">Carregando pedidos…</div>`
        : html`
          <!-- Exactly 5 Columns Grid on Desktop -->
          <div class="flex flex-col md:grid md:grid-cols-5 gap-2.5 flex-1 min-h-0 w-full max-w-none overflow-y-auto wa-scrollbar">
            ${activeColumns.map((col) => {
              const colOrders = grouped[col.key] || [];
              return html`
                <div
                  key=${col.key}
                  ondragover=${(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                  ondragleave=${() => setDragOverCol((c) => (c === col.key ? null : c))}
                  ondrop=${(e) => handleDrop(e, col.key)}
                  class="flex flex-col w-full bg-wa-panel rounded-xl border ${col.border} ${dragOverCol === col.key ? 'border-wa-teal border-dashed bg-wa-teal/5' : ''} transition-all md:h-full min-h-[140px]"
                >
                  <!-- Column Header -->
                  <div class="flex items-center justify-between px-2.5 py-2 border-b border-wa-border shrink-0 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0 flex-1">
                      <span class="text-xs shrink-0">${col.icon}</span>
                      <span class="text-xs font-bold text-wa-text truncate min-w-0" title="${col.label}">${col.label}</span>
                    </div>
                    <span class="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-wa-bg text-wa-secondary border border-wa-border font-mono shrink-0 ml-1">${colOrders.length}</span>
                  </div>

                  <!-- Cards container -->
                  <div class="flex flex-col gap-2 p-2 overflow-y-auto wa-scrollbar flex-1 min-h-0">
                    ${colOrders.length === 0
                      ? html`<div class="flex-1 flex items-center justify-center text-[10px] text-wa-secondary text-center italic font-medium py-3">Sem pedidos</div>`
                      : colOrders.map((order) => html`
                          <${OrderCard}
                            key=${order.id}
                            order=${order}
                            onOpen=${setSelected}
                            onDragStart=${handleDragStart}
                            onMove=${moveOrder}
                            onTogglePayment=${togglePaymentStatus}
                            flashed=${order.id === flashId}
                          />
                        `)}
                  </div>
                </div>
              `;
            })}
          </div>
        `}

      ${selected ? html`
        <div class="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-2 sm:p-4 md:p-6 flex items-center justify-center backdrop-blur-xs animate-fadeIn" onClick=${() => setSelected(null)}>
          <div class="max-w-6xl w-full bg-wa-panel rounded-2xl border border-wa-border p-4 sm:p-6 shadow-2xl relative max-h-[92vh] overflow-y-auto wa-scrollbar" onClick=${(e) => e.stopPropagation()}>
            <${OrderDetailPage}
              order=${orders.find((o) => o.id === selected.id) || selected}
              onClose=${() => setSelected(null)}
              onSave=${load}
              onDelete=${(id) => { setOrders((cur) => cur.filter((o) => o.id !== id)); setSelected(null); }}
            />
          </div>
        </div>
      ` : null}
    </div>
  `;
}
