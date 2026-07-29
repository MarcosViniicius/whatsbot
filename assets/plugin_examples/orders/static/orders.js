// Kanban de Pedidos — Preact + HTM, sem build.
// Drag-and-drop nativo (HTML5 DnD — não há lib vendorizada no projeto).
// Atualiza em tempo real via WebSocket /ws (plugin_orders_created/updated/status_changed/deleted).
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

const COLUMNS = [
  { key: 'new', label: 'Novos pedidos' },
  { key: 'awaiting_confirmation', label: 'Aguardando confirmação' },
  { key: 'separating', label: 'Separando' },
  { key: 'separated', label: 'Separado' },
  { key: 'out_for_delivery', label: 'Saiu para entrega' },
  { key: 'delivered', label: 'Entregue' },
  { key: 'cancelled', label: 'Cancelado' },
];

const COLUMN_DOT = {
  new: 'bg-blue-500',
  awaiting_confirmation: 'bg-amber-500',
  separating: 'bg-purple-500',
  separated: 'bg-indigo-500',
  out_for_delivery: 'bg-orange-500',
  delivered: 'bg-green-600',
  cancelled: 'bg-red-500',
};

function authHeaders(extra = {}) {
  const token = localStorage.getItem('whatsbot_token') || '';
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
}

async function apiFetch(url, init = {}) {
  const headers = authHeaders({ 'Content-Type': 'application/json', ...(init.headers || {}) });
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    localStorage.removeItem('whatsbot_token');
    window.dispatchEvent(new Event('whatsbot:unauthorized'));
    throw new Error('Não autenticado.');
  }
  return res;
}

function openConversation(contactId) {
  if (!contactId) return;
  const path = `/contacts/${contactId}`;
  if (window.location.pathname !== path) {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || value === '') return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(Number(value));
  } catch {
    return `${currency || 'BRL'} ${Number(value).toFixed(2)}`;
  }
}

function itemsSummary(items) {
  if (!items || items.length === 0) return 'Sem itens';
  return items.map((it) => `${it.quantity ? it.quantity + 'x ' : ''}${it.name}`).join(', ');
}

// Arrastar (HTML5 DnD) só funciona com mouse — navegadores mobile não
// disparam drag/drop nativo em touch. Por isso todo card tem também botões
// ‹ › pra avançar/voltar de coluna com um toque, funcionando em qualquer
// dispositivo (o arraste continua disponível no desktop como atalho).
function OrderCard({ order, onOpen, onDragStart, onMove, flashed }) {
  const total = formatMoney(order.estimated_total, order.currency);
  const colIndex = COLUMNS.findIndex((c) => c.key === order.status);
  const prevCol = colIndex > 0 ? COLUMNS[colIndex - 1] : null;
  const nextCol = colIndex >= 0 && colIndex < COLUMNS.length - 1 ? COLUMNS[colIndex + 1] : null;
  return html`
    <div
      draggable="true"
      ondragstart=${(e) => onDragStart(e, order.id)}
      onClick=${() => onOpen(order)}
      class="bg-wa-bg border border-wa-border rounded-lg p-3 shadow-sm hover:shadow-md hover:border-wa-teal cursor-pointer transition-all flex flex-col gap-1.5 ${flashed ? 'wa-flash-in' : ''}"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-sm font-semibold text-wa-text truncate">${order.contact_name || order.contact_phone}</span>
        <span class="flex items-center gap-1 shrink-0">
          ${order.awaiting_reply ? html`
            <span class="flex items-center rounded-full bg-wa-ai/15 text-wa-ai p-1 wa-ai-pulse" title="Aguardando resposta do cliente">${ICON.clock}</span>
          ` : null}
          ${order.ai_suggestion && order.ai_suggestion.summary ? html`
            <span class="flex items-center rounded-full bg-wa-ai/15 text-wa-ai p-1" title="A IA sugeriu uma atualização">${ICON.bulb}</span>
          ` : null}
          ${order.priority === 'high' ? html`
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">Urgente</span>
          ` : null}
        </span>
      </div>
      <div class="text-xs text-wa-secondary line-clamp-2">${itemsSummary(order.items)}</div>
      ${order.notes ? html`<div class="text-xs text-wa-secondary italic line-clamp-1">"${order.notes}"</div>` : null}
      <div class="flex items-center justify-between gap-2 mt-1">
        <span class="text-xs px-1.5 py-0.5 rounded-full ${order.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-wa-secondary/20 text-wa-secondary'}">
          ${order.payment_status === 'paid' ? 'Pago' : 'Pendente'}${order.payment_method ? ` · ${order.payment_method}` : ''}
        </span>
        ${total ? html`<span class="text-xs font-semibold text-wa-text">${total}</span>` : null}
      </div>
      <div class="flex items-center justify-between gap-2 mt-0.5">
        <span class="text-[11px] text-wa-secondary">
          ${new Date(order.created_at * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span class="flex items-center gap-1 shrink-0">
          <button
            disabled=${!prevCol}
            onClick=${(e) => { e.stopPropagation(); prevCol && onMove(order.id, prevCol.key); }}
            title=${prevCol ? `Voltar para "${prevCol.label}"` : ''}
            class="w-6 h-6 flex items-center justify-center rounded-full text-wa-secondary hover:text-wa-text hover:bg-wa-hover disabled:opacity-0 disabled:pointer-events-none transition-colors"
          ><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
          <button
            disabled=${!nextCol}
            onClick=${(e) => { e.stopPropagation(); nextCol && onMove(order.id, nextCol.key); }}
            title=${nextCol ? `Avançar para "${nextCol.label}"` : ''}
            class="w-6 h-6 flex items-center justify-center rounded-full text-wa-secondary hover:text-wa-text hover:bg-wa-hover disabled:opacity-0 disabled:pointer-events-none transition-colors"
          ><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></button>
        </span>
      </div>
    </div>
  `;
}

const ITEM_STATUS_LABEL = { pending: 'Pendente', resolved: 'Resolvido', problem: 'Problema' };
const QUICK_MESSAGES = [
  { label: 'Pedido separado', text: 'Seu pedido já foi separado! ✅' },
  { label: 'Aguardando pagamento', text: 'Só falta a confirmação do pagamento pra gente seguir com seu pedido.' },
  { label: 'Produto acabou', text: 'Um dos itens do seu pedido acabou no estoque — pode me confirmar se quer trocar por outra opção?' },
  { label: 'Entregador saiu', text: 'Seu pedido acabou de sair para entrega! 🚚' },
  { label: 'Pedido entregue', text: 'Pedido entregue! Obrigado pela preferência 🙏' },
];

// Vector icons — nunca emoji como ícone estrutural: emoji renderiza diferente
// por SO/navegador e não se adapta ao tema claro/escuro.
const ICON = {
  send: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  money: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`,
  print: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`,
  truck: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`,
  check: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  x: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  bulb: html`<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>`,
  clock: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 11.69l-3.5-2.1V8h1.5v3.75l2.5 1.5-.5.44z"/></svg>`,
  arrow: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`,
  trash: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
};

function normalizeItems(items) {
  return (items || []).map((it) => ({ status: 'pending', ...it }));
}

// Order status column each status can advance to next — powers the single
// primary "next step" action instead of a flat grid of equally-weighted
// buttons (an operator doing this all day needs ONE obvious next tap).
function nextColumn(status) {
  const idx = COLUMNS.findIndex((c) => c.key === status);
  if (idx === -1 || idx >= COLUMNS.length - 1) return null;
  const next = COLUMNS[idx + 1];
  return next.key === 'cancelled' ? null : next;
}

function OrderDetailPage({ order, onClose, onSave, onDelete }) {
  const [status, setStatus] = useState(order.status);
  const [paymentStatus, setPaymentStatus] = useState(order.payment_status);
  const [priority, setPriority] = useState(order.priority);
  const [deliveryType, setDeliveryType] = useState(order.delivery_type || '');
  const [notes, setNotes] = useState(order.notes || '');
  const [items, setItems] = useState(() => normalizeItems(order.items));
  const [itemFilter, setItemFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [askText, setAskText] = useState('');
  const [askItemIndex, setAskItemIndex] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [applyingSuggestion, setApplyingSuggestion] = useState(false);
  const [history, setHistory] = useState(null);
  const [editingItem, setEditingItem] = useState(null); // {idx, field: 'quantity'|'notes'} | null
  const [editingValue, setEditingValue] = useState('');
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
  const pendingCount = items.length - resolvedCount - problemCount;
  const progressPct = items.length ? Math.round((resolvedCount / items.length) * 100) : 0;
  const visibleItems = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => itemFilter === 'all' || it.status === itemFilter);

  function updateItem(idx, patch) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx) {
    setItems((cur) => cur.filter((_, i) => i !== idx));
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
      await apiFetch(`/api/plugins/orders/orders/${order.id}`, {
        method: 'PUT',
        body: JSON.stringify({ payment_status: paymentStatus, priority, notes, items, delivery_type: deliveryType || null }),
      });
      onSave();
    } finally {
      setSaving(false);
    }
  }

  // Primary action: advance to the next Kanban column in one tap. Persists
  // via handleSave (not the lighter quickStatusAction) so unsaved edits to
  // notes/items/payment made on this page aren't silently dropped.
  async function handleAdvance() {
    const next = nextColumn(status);
    if (!next) return;
    setStatus(next.key);
    await handleSave(next.key);
  }

  async function handleDelete() {
    await apiFetch(`/api/plugins/orders/orders/${order.id}`, { method: 'DELETE' });
    onDelete(order.id);
    onClose();
  }

  function startEdit(idx, field, current) {
    setEditingItem({ idx, field });
    setEditingValue(current || '');
  }
  function confirmEdit() {
    if (editingItem) updateItem(editingItem.idx, { [editingItem.field]: editingValue });
    setEditingItem(null);
    setEditingValue('');
  }
  function cancelEdit() {
    setEditingItem(null);
    setEditingValue('');
  }

  // Sends the message for real (core WhatsApp send endpoint — plugins don't
  // have direct GOWA access), then records it against the order (optionally
  // scoped to one item) so the page shows "aguardando cliente" and
  // events.py auto-captures the reply.
  async function sendToCustomer(text, itemIndex) {
    const sendRes = await apiFetch(`/api/contacts/${encodeURIComponent(order.contact_phone)}/send`, {
      method: 'POST', body: JSON.stringify({ message: text }),
    });
    const sendData = await sendRes.json();
    if (!sendData.ok) throw new Error(sendData.error || 'Falha ao enviar mensagem.');
    await apiFetch(`/api/plugins/orders/orders/${order.id}/messages`, {
      method: 'POST', body: JSON.stringify({ text, item_index: itemIndex }),
    });
  }

  async function handleAsk() {
    const text = askText.trim();
    if (!text) return;
    setAsking(true);
    setAskError('');
    try {
      await sendToCustomer(text, askItemIndex);
      setAskText('');
      setAskItemIndex(null);
      onSave();
    } catch (e) {
      setAskError(String(e.message || e));
    } finally {
      setAsking(false);
    }
  }

  function askAboutItem(idx, template) {
    setAskItemIndex(idx);
    setAskText(template);
  }

  // Botão "Enviar valor ao cliente" — antes só preenchia a caixa de mensagem
  // (o operador tinha que achar a caixa e clicar em "Enviar mensagem" de
  // novo, um segundo passo confuso). Agora manda direto, igual às outras
  // ações rápidas de um toque só da página.
  async function handleSendValue() {
    const total = formatMoney(order.estimated_total, order.currency);
    const resumo = itemsSummary(order.items);
    const pgto = order.payment_method || 'a combinar';
    const text = `Seu pedido: ${resumo}.${total ? ` Total: ${total}.` : ''} Forma de pagamento: ${pgto}.`;
    setSendingValue(true);
    setAskError('');
    try {
      await sendToCustomer(text, null);
      setValueSent(true);
      setTimeout(() => setValueSent(false), 2500);
      onSave();
    } catch (e) {
      setAskError(String(e.message || e));
    } finally {
      setSendingValue(false);
    }
  }

  async function handleApplySuggestion() {
    setApplyingSuggestion(true);
    try {
      await apiFetch(`/api/plugins/orders/orders/${order.id}/suggestion/apply`, { method: 'POST' });
      onSave();
    } finally {
      setApplyingSuggestion(false);
    }
  }

  async function handleDismissSuggestion() {
    await apiFetch(`/api/plugins/orders/orders/${order.id}/suggestion/dismiss`, { method: 'POST' });
    onSave();
  }

  async function quickStatusAction(newStatus) {
    await apiFetch(`/api/plugins/orders/orders/${order.id}/status`, {
      method: 'POST', body: JSON.stringify({ status: newStatus }),
    });
    onSave();
  }

  function handlePrint() {
    window.print();
  }

  const mapsUrl = order.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`
    : null;
  const nextStep = nextColumn(status);
  // A pergunta/sugestão em aberto pertence a UM item específico — mostrada
  // ali, não duplicada no painel lateral (evita ter que ficar olhando duas
  // colunas pra entender o mesmo evento).
  const itemScopedPending = order.awaiting_reply && order.pending_item_index != null;
  const itemScopedSuggestion = order.ai_suggestion && order.ai_suggestion.item_index != null;

  return html`
    <div class="flex flex-col gap-4 h-full overflow-y-auto wa-scrollbar">
      <!-- Header -->
      <div class="flex flex-wrap items-center gap-3 pb-3 border-b border-wa-border">
        <button onClick=${onClose} class="flex items-center gap-1.5 text-sm text-wa-secondary hover:text-wa-text shrink-0">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          Voltar ao Kanban
        </button>
        <h1 class="text-lg font-semibold text-wa-text">Pedido #${order.id}</h1>
        <select value=${status} onChange=${(e) => setStatus(e.target.value)} class="wa-field px-2.5 py-1 rounded-full text-xs font-semibold border border-wa-border">
          ${COLUMNS.map((c) => html`<option value=${c.key}>${c.label}</option>`)}
        </select>
        <span class="text-xs text-wa-secondary">Criado em ${new Date(order.created_at * 1000).toLocaleString('pt-BR')}</span>
        <div class="flex-1"></div>
        <button onClick=${() => openConversation(order.contact_id)} class="min-h-[44px] px-3 py-2 text-sm rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Abrir conversa</button>
        <button onClick=${() => handleSave()} disabled=${saving} class="min-h-[44px] px-4 py-2 text-sm rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover disabled:opacity-50">
          ${saving ? 'Salvando…' : 'Salvar alterações'}
        </button>
        ${nextStep ? html`
          <button onClick=${handleAdvance} disabled=${saving} class="min-h-[44px] flex items-center gap-1 px-4 py-2 text-sm font-semibold rounded-lg bg-wa-teal text-white hover:opacity-90 disabled:opacity-50">
            Avançar: ${nextStep.label} ${ICON.arrow}
          </button>
        ` : null}
      </div>

      <!-- Summary strip -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div class="bg-wa-bg rounded-xl p-3 border border-wa-border">
          <div class="text-[11px] font-semibold text-wa-secondary uppercase mb-1">Progresso</div>
          <div class="text-xs text-wa-text mb-1">${resolvedCount} de ${items.length} itens resolvidos</div>
          <div class="h-1.5 bg-wa-panel rounded-full overflow-hidden"><div class="h-full bg-wa-teal" style=${`width:${progressPct}%`}></div></div>
        </div>
        <div class="bg-wa-bg rounded-xl p-3 border border-wa-border">
          <div class="text-[11px] font-semibold text-wa-secondary uppercase mb-1">Total do pedido</div>
          <div class="text-lg font-bold text-wa-text tabular-nums mb-1">${formatMoney(order.estimated_total, order.currency) || '—'}</div>
          <button onClick=${handleSendValue} disabled=${sendingValue} class="flex items-center gap-1 text-xs ${valueSent ? 'text-green-600' : 'text-wa-teal hover:underline'} disabled:opacity-50">
            ${valueSent ? html`${ICON.check} Valor enviado` : sendingValue ? 'Enviando…' : html`${ICON.send} Enviar valor ao cliente`}
          </button>
        </div>
        <div class="bg-wa-bg rounded-xl p-3 border border-wa-border">
          <div class="text-[11px] font-semibold text-wa-secondary uppercase mb-1">Pagamento</div>
          <select value=${paymentStatus} onChange=${(e) => setPaymentStatus(e.target.value)} class="wa-field w-full px-2 py-1 rounded-lg text-sm border border-wa-border">
            <option value="pending">Pendente</option>
            <option value="paid">Pago</option>
          </select>
        </div>
        <div class="bg-wa-bg rounded-xl p-3 border border-wa-border">
          <div class="text-[11px] font-semibold text-wa-secondary uppercase mb-1">Entrega</div>
          <select value=${deliveryType} onChange=${(e) => setDeliveryType(e.target.value)} class="wa-field w-full px-2 py-1 rounded-lg text-sm border border-wa-border">
            <option value="">—</option>
            <option value="delivery">Entrega</option>
            <option value="pickup">Retirada</option>
          </select>
        </div>
        <div class="bg-wa-bg rounded-xl p-3 border border-wa-border">
          <div class="text-[11px] font-semibold text-wa-secondary uppercase mb-1">Prioridade</div>
          <select value=${priority} onChange=${(e) => setPriority(e.target.value)} class="wa-field w-full px-2 py-1 rounded-lg text-sm border border-wa-border">
            <option value="normal">Normal</option>
            <option value="high">Urgente</option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1.1fr_1fr] gap-4">
        <!-- Items -->
        <div class="bg-wa-bg rounded-xl border border-wa-border p-3 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-wa-text">Itens do pedido (${items.length})</h2>
          </div>
          <div class="flex gap-1.5 text-xs">
            ${[['all', 'Todos', items.length], ['resolved', 'Resolvidos', resolvedCount], ['pending', 'Pendentes', pendingCount], ['problem', 'Problemas', problemCount]].map(([key, label, count]) => html`
              <button
                onClick=${() => setItemFilter(key)}
                class="min-h-[36px] px-3 rounded-full font-medium transition-colors ${itemFilter === key ? 'bg-wa-teal text-white' : 'bg-wa-panel text-wa-secondary hover:bg-wa-hover'}"
              >${label} ${count}</button>
            `)}
          </div>
          <div class="flex flex-col gap-2">
            ${visibleItems.length === 0 ? html`<div class="text-sm text-wa-secondary py-4 text-center">Nenhum item nesse filtro.</div>` : null}
            ${visibleItems.map(({ it, idx }) => html`
              <div key=${idx} class="flex flex-col gap-2 p-3 rounded-lg border ${it.status === 'problem' ? 'border-red-500/40 bg-red-500/5' : it.status === 'resolved' ? 'border-green-600/30 bg-green-600/5' : 'border-wa-border bg-wa-panel'}">
                <div class="flex items-center gap-2">
                  <span class="shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${it.status === 'resolved' ? 'bg-green-600 text-white' : it.status === 'problem' ? 'bg-red-600 text-white' : 'bg-wa-secondary/20 text-wa-secondary'}">
                    ${it.status === 'resolved' ? ICON.check : it.status === 'problem' ? ICON.x : html`<span class="w-1.5 h-1.5 rounded-full bg-current"></span>`}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold text-wa-text truncate">${it.quantity ? `${it.quantity}x ` : ''}${it.name}</div>
                    ${it.notes ? html`<div class="text-xs text-wa-secondary truncate">${it.notes}</div>` : null}
                  </div>
                  ${it.unit_price ? html`<span class="text-sm font-semibold text-wa-text shrink-0">${formatMoney(it.unit_price, order.currency)}</span>` : null}
                  ${itemScopedPending && order.pending_item_index === idx ? html`<span class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-wa-ai/15 text-wa-ai font-semibold wa-ai-pulse shrink-0">${ICON.clock} aguardando</span>` : null}
                  ${itemScopedSuggestion && order.ai_suggestion.item_index === idx ? html`<span class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-wa-ai/15 text-wa-ai font-semibold shrink-0" title="A IA sugeriu uma atualização">${ICON.bulb} sugestão</span>` : null}
                </div>

                ${itemScopedPending && order.pending_item_index === idx ? html`
                  <div class="text-xs text-wa-ai italic pl-8">Perguntado: "${order.last_question}"</div>
                ` : null}

                ${itemScopedSuggestion && order.ai_suggestion.item_index === idx ? html`
                  <div class="flex flex-col gap-2 p-2.5 ml-8 rounded-lg bg-wa-ai/10 border border-wa-ai/30">
                    <div class="text-xs text-wa-text flex items-center gap-1"><span class="font-semibold flex items-center gap-1">${ICON.bulb} IA sugere:</span> ${order.ai_suggestion.summary}</div>
                    <div class="flex gap-2">
                      <button onClick=${handleApplySuggestion} disabled=${applyingSuggestion} class="min-h-[36px] px-3 text-xs rounded-lg bg-wa-teal text-white hover:opacity-90 disabled:opacity-50">${applyingSuggestion ? 'Aplicando…' : 'Aplicar'}</button>
                      <button onClick=${handleDismissSuggestion} class="min-h-[36px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Ignorar</button>
                    </div>
                  </div>
                ` : null}

                ${editingItem && editingItem.idx === idx ? html`
                  <div class="flex items-center gap-2">
                    <input
                      value=${editingValue}
                      onInput=${(e) => setEditingValue(e.target.value)}
                      placeholder=${editingItem.field === 'quantity' ? 'Quantidade' : 'Observação'}
                      class="wa-field flex-1 min-h-[44px] px-3 rounded-lg text-sm border border-wa-border"
                    />
                    <button onClick=${confirmEdit} class="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg bg-wa-teal text-white hover:opacity-90">${ICON.check}</button>
                    <button onClick=${cancelEdit} class="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">${ICON.x}</button>
                  </div>
                ` : html`
                  <div class="flex flex-wrap gap-1.5">
                    <button onClick=${() => updateItem(idx, { status: 'resolved' })} class="min-h-[44px] flex items-center gap-1 px-3 text-xs font-medium rounded-lg bg-green-600/10 text-green-700 hover:bg-green-600/20 ${it.status === 'resolved' ? 'ring-2 ring-green-600/50' : ''}">${ICON.check} Tenho</button>
                    <button onClick=${() => updateItem(idx, { status: 'problem' })} class="min-h-[44px] flex items-center gap-1 px-3 text-xs font-medium rounded-lg bg-red-600/10 text-red-700 hover:bg-red-600/20 ${it.status === 'problem' ? 'ring-2 ring-red-600/50' : ''}">${ICON.x} Não tem</button>
                    <button onClick=${() => startEdit(idx, 'quantity', it.quantity)} class="min-h-[44px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Editar qtd.</button>
                    <button onClick=${() => askAboutItem(idx, `Sobre o item "${it.name}": tem alguma marca ou opção que você prefere?`)} class="min-h-[44px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Trocar marca</button>
                    <button onClick=${() => startEdit(idx, 'notes', it.notes)} class="min-h-[44px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Obs. do item</button>
                    <button onClick=${() => removeItem(idx)} class="min-h-[44px] flex items-center px-3 text-xs rounded-lg text-red-600/70 hover:text-red-600 hover:bg-red-50" title="Remover item">${ICON.trash}</button>
                  </div>
                `}
              </div>
            `)}
          </div>

          <!-- Resumo -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-wa-border">
            <div>
              <label class="block text-xs font-semibold text-wa-secondary uppercase mb-1">Forma de pagamento</label>
              <div class="text-sm text-wa-text">${order.payment_method || '—'}</div>
            </div>
            <div>
              <label class="block text-xs font-semibold text-wa-secondary uppercase mb-1">Observações</label>
              <textarea
                value=${notes}
                onInput=${(e) => setNotes(e.target.value)}
                rows="2"
                class="wa-field w-full px-2 py-1.5 rounded-lg text-sm border border-wa-border resize-none"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- Mensagem com o cliente -->
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-2 p-3 rounded-lg border ${order.awaiting_reply && !itemScopedPending ? 'border-wa-ai/40 bg-wa-ai/5' : 'border-wa-border bg-wa-bg'}">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-wa-secondary uppercase flex-1">Mensagem com o cliente</span>
              ${order.awaiting_reply && !itemScopedPending ? html`<span class="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-wa-ai/15 text-wa-ai wa-ai-pulse">${ICON.clock} Aguardando</span>` : null}
            </div>
            ${itemScopedPending ? html`<div class="text-xs text-wa-secondary">Pergunta sobre "${items[order.pending_item_index]?.name || 'item'}" — veja o status na lista de itens.</div>` : null}
            ${!itemScopedPending && order.last_question ? html`<div class="text-sm"><span class="text-wa-secondary">Você perguntou:</span> <span class="text-wa-text">"${order.last_question}"</span></div>` : null}
            ${!itemScopedPending && order.last_reply ? html`<div class="text-sm"><span class="text-wa-secondary">Cliente respondeu:</span> <span class="text-wa-text font-medium">"${order.last_reply}"</span></div>` : null}
            ${!itemScopedSuggestion && order.ai_suggestion && order.ai_suggestion.summary ? html`
              <div class="flex flex-col gap-2 p-2.5 rounded-lg bg-wa-ai/10 border border-wa-ai/30">
                <div class="text-xs text-wa-text flex items-center gap-1"><span class="font-semibold flex items-center gap-1">${ICON.bulb} IA sugere:</span> ${order.ai_suggestion.summary}</div>
                <div class="flex gap-2">
                  <button onClick=${handleApplySuggestion} disabled=${applyingSuggestion} class="min-h-[36px] px-3 text-xs rounded-lg bg-wa-teal text-white hover:opacity-90 disabled:opacity-50">${applyingSuggestion ? 'Aplicando…' : 'Aplicar'}</button>
                  <button onClick=${handleDismissSuggestion} class="min-h-[36px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Ignorar</button>
                </div>
              </div>
            ` : null}
            ${askItemIndex !== null ? html`<div class="text-[11px] text-wa-ai">Pergunta sobre: ${items[askItemIndex]?.name || 'item'} <button onClick=${() => setAskItemIndex(null)} class="underline ml-1">(tornar geral)</button></div>` : null}
            <textarea
              value=${askText}
              onInput=${(e) => setAskText(e.target.value)}
              rows="3"
              placeholder="Escreva ou escolha uma mensagem rápida abaixo…"
              class="wa-field w-full px-3 py-2 rounded-lg text-sm border border-wa-border resize-none"
            ></textarea>
            <div class="flex gap-2">
              <button onClick=${handleAsk} disabled=${asking || !askText.trim()} class="min-h-[44px] flex-1 flex items-center justify-center gap-1.5 px-3 text-sm font-medium rounded-lg bg-wa-teal text-white hover:opacity-90 disabled:opacity-50">${ICON.send} ${asking ? 'Enviando…' : 'Enviar mensagem'}</button>
              <button onClick=${() => setAskText('')} class="min-h-[44px] px-3 text-sm rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Limpar</button>
            </div>
            ${askError ? html`<div class="text-xs text-red-600">${askError}</div>` : null}
          </div>

          <div class="bg-wa-bg rounded-lg border border-wa-border p-3">
            <div class="text-xs font-semibold text-wa-secondary uppercase mb-2">Mensagens rápidas</div>
            <div class="grid grid-cols-2 gap-1.5">
              ${QUICK_MESSAGES.map((qm) => html`
                <button
                  key=${qm.label}
                  onClick=${() => { setAskItemIndex(null); setAskText(qm.text); }}
                  class="min-h-[44px] px-2 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover text-left"
                >${qm.label}</button>
              `)}
            </div>
          </div>
        </div>

        <!-- Cliente + histórico + ações -->
        <div class="flex flex-col gap-3">
          <div class="bg-wa-bg rounded-lg border border-wa-border p-3">
            <div class="text-xs font-semibold text-wa-secondary uppercase mb-2">Dados do cliente</div>
            <div class="text-sm font-semibold text-wa-text">${order.contact_name || order.contact_phone}</div>
            <div class="text-xs text-wa-secondary mb-2">${order.contact_phone}</div>
            ${order.address ? html`
              <div class="text-xs text-wa-text mb-1">${order.address}</div>
              <div class="flex gap-3 text-xs">
                <a href=${mapsUrl} target="_blank" rel="noopener noreferrer" class="text-wa-teal hover:underline">Ver no mapa</a>
                <button onClick=${() => navigator.clipboard && navigator.clipboard.writeText(order.address)} class="text-wa-teal hover:underline">Copiar endereço</button>
              </div>
            ` : null}
          </div>

          <div class="bg-wa-bg rounded-lg border border-wa-border p-3">
            <div class="text-xs font-semibold text-wa-secondary uppercase mb-2">Ações rápidas</div>
            <div class="grid grid-cols-2 gap-1.5">
              <button onClick=${handlePrint} class="min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">${ICON.print} Imprimir</button>
              <button onClick=${() => quickStatusAction('out_for_delivery')} class="min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">${ICON.truck} Chamar entrega</button>
              <button onClick=${() => quickStatusAction('delivered')} class="min-h-[44px] col-span-2 flex items-center justify-center gap-1.5 px-2 text-xs font-medium rounded-lg bg-green-600/10 text-green-700 hover:bg-green-600/20">${ICON.check} Marcar como entregue</button>
            </div>
          </div>

          <div class="rounded-lg border border-wa-border/60 p-3">
            <div class="text-xs font-semibold text-wa-secondary/70 uppercase mb-2">Zona de risco</div>
            <div class="flex flex-col gap-1.5">
              ${confirmCancel ? html`
                <div class="flex items-center gap-1.5">
                  <span class="flex-1 text-xs text-wa-secondary">Cancelar este pedido?</span>
                  <button onClick=${() => { setConfirmCancel(false); quickStatusAction('cancelled'); }} class="min-h-[36px] px-3 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700">Confirmar</button>
                  <button onClick=${() => setConfirmCancel(false)} class="min-h-[36px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Voltar</button>
                </div>
              ` : html`
                <button onClick=${() => setConfirmCancel(true)} class="min-h-[40px] flex items-center gap-1.5 px-2 text-xs text-red-600/80 hover:text-red-600 hover:bg-red-50 rounded-lg">${ICON.x} Cancelar pedido</button>
              `}
              ${confirmDelete ? html`
                <div class="flex items-center gap-1.5">
                  <span class="flex-1 text-xs text-wa-secondary">Excluir permanentemente?</span>
                  <button onClick=${handleDelete} class="min-h-[36px] px-3 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700">Confirmar</button>
                  <button onClick=${() => setConfirmDelete(false)} class="min-h-[36px] px-3 text-xs rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover">Voltar</button>
                </div>
              ` : html`
                <button onClick=${() => setConfirmDelete(true)} class="min-h-[40px] flex items-center gap-1.5 px-2 text-xs text-red-600/80 hover:text-red-600 hover:bg-red-50 rounded-lg">${ICON.trash} Excluir pedido</button>
              `}
            </div>
          </div>

          <div class="bg-wa-bg rounded-lg border border-wa-border p-3 flex-1 min-h-0">
            <div class="text-xs font-semibold text-wa-secondary uppercase mb-2">Histórico</div>
            <div class="flex flex-col gap-2 max-h-[300px] overflow-y-auto wa-scrollbar">
              ${history === null ? html`<div class="text-xs text-wa-secondary">Carregando…</div>` : history.length === 0 ? html`<div class="text-xs text-wa-secondary">Sem histórico ainda.</div>` : history.map((h) => html`
                <div key=${h.id} class="text-xs border-l-2 border-wa-border pl-2">
                  <div class="text-wa-secondary">${new Date(h.ts * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  <div class="text-wa-text">${h.field}: ${h.old_value || '—'} → ${h.new_value || '—'} <span class="text-wa-secondary">(${h.changed_by})</span></div>
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
  // <lg: 7 colunas lado a lado não cabem numa tela de celular de forma
  // legível — em vez de forçar scroll horizontal, mostra uma coluna por vez
  // (abas), com scroll só vertical. >=lg: grid ocupa a largura toda, sem
  // scroll horizontal (antes cada coluna tinha largura fixa e a 6ª/7ª
  // ficavam cortadas fora da tela mesmo em desktop).
  const [mobileStatus, setMobileStatus] = useState(COLUMNS[0].key);

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

  const grouped = useMemo(() => {
    const g = {};
    for (const c of COLUMNS) g[c.key] = [];
    for (const o of orders) (g[o.status] || (g[o.status] = [])).push(o);
    return g;
  }, [orders]);

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

  function handleDrop(e, status) {
    e.preventDefault();
    setDragOverCol(null);
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (id) moveOrder(id, status);
  }

  if (selected) {
    return html`
      <${OrderDetailPage}
        order=${orders.find((o) => o.id === selected.id) || selected}
        onClose=${() => setSelected(null)}
        onSave=${load}
        onDelete=${(id) => { setOrders((cur) => cur.filter((o) => o.id !== id)); setSelected(null); }}
      />
    `;
  }

  return html`
    <div class="flex flex-col gap-3 h-full">
      <div class="flex items-center gap-2">
        <h1 class="text-xl font-semibold text-wa-text">Pedidos</h1>
        <span class=${`text-xs px-2 py-0.5 rounded-full ${wsOk ? 'bg-green-100 text-green-700' : 'bg-wa-secondary/20 text-wa-secondary'}`}>
          ${wsOk ? 'ao vivo' : 'offline'}
        </span>
      </div>
      ${error ? html`<div class="text-sm text-red-600">Erro: ${error}</div>` : null}
      ${loading
        ? html`<div class="text-wa-secondary text-sm">Carregando…</div>`
        : html`
          <!-- Desktop/tablet largo: todas as colunas visíveis de uma vez, sem scroll horizontal -->
          <div class="hidden lg:grid lg:grid-cols-7 gap-3 flex-1 min-h-0">
            ${COLUMNS.map((col) => html`
              <div
                key=${col.key}
                ondragover=${(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                ondragleave=${() => setDragOverCol((c) => (c === col.key ? null : c))}
                ondrop=${(e) => handleDrop(e, col.key)}
                class="flex flex-col min-w-0 bg-wa-panel rounded-xl border shadow-sm ${dragOverCol === col.key ? 'border-wa-teal border-dashed shadow-md' : 'border-wa-border'} transition-shadow"
              >
                <div class="flex items-center gap-1.5 px-2.5 py-2.5 border-b border-wa-border">
                  <span class="w-2 h-2 rounded-full shrink-0 ${COLUMN_DOT[col.key]}"></span>
                  <span class="text-xs font-semibold text-wa-text flex-1 truncate">${col.label}</span>
                  <span class="text-xs text-wa-secondary shrink-0">${(grouped[col.key] || []).length}</span>
                </div>
                <div class="flex flex-col gap-2 p-2 overflow-y-auto min-h-[80px]">
                  ${(grouped[col.key] || []).map((order) => html`
                    <${OrderCard} key=${order.id} order=${order} onOpen=${setSelected} onDragStart=${handleDragStart} onMove=${moveOrder} flashed=${order.id === flashId} />
                  `)}
                </div>
              </div>
            `)}
          </div>

          <!-- Mobile/tablet estreito: 7 colunas lado a lado não cabem de forma legível.
               Uma coluna por vez via abas, tudo em scroll vertical (sem scroll horizontal). -->
          <div class="lg:hidden flex flex-col gap-3 flex-1 min-h-0">
            <div class="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 wa-scrollbar">
              ${COLUMNS.map((col) => html`
                <button
                  key=${col.key}
                  onClick=${() => setMobileStatus(col.key)}
                  class="shrink-0 min-h-[40px] flex items-center gap-1.5 px-3 rounded-full text-xs font-medium transition-colors ${mobileStatus === col.key ? 'bg-wa-teal text-white' : 'bg-wa-panel text-wa-secondary hover:bg-wa-hover'}"
                >
                  <span class="w-1.5 h-1.5 rounded-full ${COLUMN_DOT[col.key]}"></span>
                  ${col.label} ${(grouped[col.key] || []).length}
                </button>
              `)}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
              ${(grouped[mobileStatus] || []).length === 0
                ? html`<div class="text-sm text-wa-secondary text-center py-8">Nenhum pedido nesta coluna.</div>`
                : (grouped[mobileStatus] || []).map((order) => html`
                    <${OrderCard} key=${order.id} order=${order} onOpen=${setSelected} onDragStart=${handleDragStart} onMove=${moveOrder} flashed=${order.id === flashId} />
                  `)}
            </div>
          </div>
        `}
    </div>
  `;
}
