// Dashboard operacional — nova página inicial. Combina indicadores rápidos
// (pedidos do dia, conversas abertas/aguardando resposta, entregas em
// andamento, total vendido) com o Kanban de pedidos embutido (importado
// dinamicamente do plugin "orders", mesmo mecanismo do PluginScreen) e uma
// lista de conversas que precisam de atenção.
import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import htm from 'htm';
import { authHeaders } from '../services/api.js';
import { getContacts } from '../services/api.js';

const html = htm.bind(h);

function openConversation(contactId) {
  if (!contactId) return;
  const path = `/contacts/${contactId}`;
  if (window.location.pathname !== path) {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

function formatMoney(value) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  } catch {
    return `R$ ${(Number(value) || 0).toFixed(2)}`;
  }
}

// Each stat card carries a thin color bar keyed to what the number means
// (teal = activity, amber = needs a human, green = money/completed) — a
// small, legible way to make the grid scannable at a glance instead of a
// wall of identical white cards.
function StatCard({ label, value, hint, accent, bar, icon }) {
  return html`
    <div class="relative bg-wa-bg rounded-xl pl-3.5 pr-2.5 py-2.5 border border-wa-border shadow-sm flex items-start gap-2 min-w-0 overflow-hidden transition-shadow hover:shadow-md">
      <span class="absolute left-0 top-0 bottom-0 w-[3px] ${bar || 'bg-wa-teal'}"></span>
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        <span class="text-[10px] font-semibold text-wa-secondary uppercase tracking-wide leading-snug line-clamp-2">${label}</span>
        <span class="text-xl font-bold tabular-nums leading-tight ${accent || 'text-wa-text'}">${value}</span>
        ${hint ? html`<span class="text-xs text-wa-secondary">${hint}</span>` : null}
      </div>
      ${icon ? html`<span class="shrink-0 opacity-40 mt-0.5">${icon}</span>` : null}
    </div>
  `;
}

const _ICON = {
  chat: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
  hand: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  cart: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L20.88 6H4.54l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
  money: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`,
  truck: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`,
  check: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
};

// Rough ETA text for when this conversation auto-resumes AI (see
// server/background.py ai_auto_resume_loop) — approximate on purpose: the
// real trigger also requires a pending customer message, which this list
// doesn't carry per-row. Good enough as an operator hint, not a promise.
function autoResumeHint(contact, config) {
  if (!config || !config.ai_auto_resume_enabled || !contact.ai_disabled_at) return null;
  const timeoutSec = (config.ai_auto_resume_timeout_min || 30) * 60;
  const etaSec = contact.ai_disabled_at + timeoutSec - Date.now() / 1000;
  if (etaSec <= 0) return 'IA pode retomar a qualquer momento';
  const min = Math.round(etaSec / 60);
  return min <= 1 ? 'IA retoma em ~1min' : `IA retoma em ~${min}min`;
}

function ConversationRow({ contact, config }) {
  const needsHuman = contact.ai_enabled === false;
  return html`
    <button
      onClick=${() => openConversation(contact.id)}
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-wa-hover transition-colors text-left"
    >
      <div class="w-8 h-8 rounded-full ${needsHuman ? 'bg-wa-ai/20 text-wa-ai wa-ai-pulse' : 'bg-wa-teal/20 text-wa-teal'} flex items-center justify-center text-xs font-semibold shrink-0">
        ${(contact.name || contact.phone || '?').slice(0, 1).toUpperCase()}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-medium text-wa-text truncate">${contact.name || contact.phone}</span>
          ${needsHuman ? html`<span class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-wa-ai/15 text-wa-ai">🙋 Atendente</span>` : null}
        </div>
        <div class="text-xs text-wa-secondary truncate">
          ${needsHuman ? (autoResumeHint(contact, config) || (contact.is_group ? 'Grupo' : contact.phone)) : (contact.is_group ? 'Grupo' : contact.phone)}
        </div>
      </div>
      ${contact.unread_count > 0 ? html`
        <span class="text-xs px-2 py-0.5 rounded-full bg-wa-teal text-white font-semibold shrink-0">${contact.unread_count}</span>
      ` : null}
    </button>
  `;
}

export function OperationalDashboard({ pluginScreens, newMessage, messagesRead, contactAiToggled, config }) {
  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [orderStats, setOrderStats] = useState(null);
  const [ordersAvailable, setOrdersAvailable] = useState(true);
  const [OrdersComponent, setOrdersComponent] = useState(null);

  const ordersScreen = useMemo(
    () => (pluginScreens || []).find((s) => s.pluginId === 'orders'),
    [pluginScreens]
  );

  async function loadContacts() {
    try {
      const res = await getContacts('', false);
      if (res.ok) setContacts(res.data || []);
    } catch (e) { /* ignore */ }
    setLoadingContacts(false);
  }

  async function loadOrderStats() {
    try {
      const r = await fetch('/api/plugins/orders/stats', { headers: authHeaders() });
      if (r.status === 404) { setOrdersAvailable(false); return; }
      const data = await r.json();
      if (data && data.ok) { setOrderStats(data.data); setOrdersAvailable(true); }
    } catch (e) { /* plugin not installed/enabled — non-fatal */ }
  }

  useEffect(() => { loadContacts(); }, []);
  useEffect(() => { loadContacts(); }, [newMessage, messagesRead, contactAiToggled]);

  useEffect(() => {
    loadOrderStats();
    if (!ordersScreen) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (typeof ev.event === 'string' && ev.event.startsWith('plugin_orders_')) loadOrderStats();
      } catch {}
    };
    return () => ws.close();
  }, [ordersScreen]);

  useEffect(() => {
    if (!ordersScreen) return;
    let cancelled = false;
    import(ordersScreen.component).then((mod) => {
      if (!cancelled) setOrdersComponent(() => mod.default);
    }).catch(() => setOrdersAvailable(false));
    return () => { cancelled = true; };
  }, [ordersScreen]);

  const openConvos = contacts.filter((c) => !c.is_archived);
  // Precisam de atendente (IA desligada) sempre primeiro — é a fila real de
  // trabalho do atendente; o resto ("aguardando resposta" comum, IA ligada
  // mas ainda não respondeu) vem depois, ordenado por quem tem mais msgs.
  const needsHumanConvos = openConvos.filter((c) => c.ai_enabled === false);
  const waitingConvos = openConvos.filter((c) => c.ai_enabled !== false && (c.unread_count || 0) > 0)
    .sort((a, b) => (b.unread_count || 0) - (a.unread_count || 0));
  const queue = [...needsHumanConvos, ...waitingConvos];

  return html`
    <div class="flex flex-col gap-3 h-full pt-12 lg:pt-0">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <${StatCard} label="Conversas abertas" value=${loadingContacts ? '…' : openConvos.length} bar="bg-wa-teal" icon=${_ICON.chat} />
        <${StatCard} label="Precisam de atendente" value=${loadingContacts ? '…' : needsHumanConvos.length} accent=${needsHumanConvos.length > 0 ? 'text-wa-ai' : ''} bar="bg-wa-ai" icon=${_ICON.hand} />
        <${StatCard} label="Pedidos hoje" value=${orderStats ? orderStats.orders_today_count : '—'} bar="bg-wa-teal" icon=${_ICON.cart} />
        <${StatCard} label="Vendido hoje" value=${orderStats ? formatMoney(orderStats.orders_today_total) : '—'} accent="text-green-600" bar="bg-green-600" icon=${_ICON.money} />
        <${StatCard} label="Em entrega" value=${orderStats ? orderStats.in_delivery_count : '—'} bar="bg-orange-500" icon=${_ICON.truck} />
        <${StatCard} label="Entregues hoje" value=${orderStats ? orderStats.delivered_today_count : '—'} accent="text-green-600" bar="bg-green-600" icon=${_ICON.check} />
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4 flex-1 min-h-0">
        <div class="bg-wa-panel rounded-xl border border-wa-border p-3 h-[65vh] xl:h-auto xl:min-h-[420px] flex flex-col">
          ${!ordersScreen
            ? html`
              <div class="flex-1 flex flex-col items-center justify-center text-center gap-2 text-wa-secondary p-6">
                <span class="text-sm">O Kanban de pedidos precisa do plugin "Pedidos (Kanban)".</span>
                <a href="/plugins" class="text-sm text-wa-teal hover:underline">Ativar em Gerenciar Plugins</a>
              </div>
            `
            : OrdersComponent
              ? html`<${OrdersComponent} apiBase="/api/plugins/orders" />`
              : html`<div class="flex-1 flex items-center justify-center text-wa-secondary text-sm">Carregando Kanban…</div>`
          }
        </div>

        <div class="bg-wa-bg rounded-xl border border-wa-border p-3 flex flex-col gap-1 min-h-0">
          <h2 class="text-xs font-semibold text-wa-secondary uppercase tracking-wide px-1 mb-1">Fila de atendimento</h2>
          <div class="flex flex-col overflow-y-auto max-h-[280px] xl:max-h-[420px]">
            ${queue.length === 0
              ? html`<div class="text-sm text-wa-secondary px-2 py-3">Nenhuma conversa esperando 🎉</div>`
              : queue.map((c) => html`<${ConversationRow} key=${c.id} contact=${c} config=${config} />`)}
          </div>
        </div>
      </div>
    </div>
  `;
}
