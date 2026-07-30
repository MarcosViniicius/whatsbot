import { h, render } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { Dashboard } from './components/Dashboard.js';
import { OperationalDashboard } from './components/OperationalDashboard.js';
import { Sandbox } from './components/Sandbox.js';
import { Contacts } from './components/Contacts.js';
import { CostsDashboard } from './components/CostsDashboard.js';
import { Executions } from './components/Executions.js';
import { LoginScreen } from './components/LoginScreen.js';
import { PluginsManager } from './components/PluginsManager.js';
import { PluginScreen } from './components/PluginScreen.js';
import { ToolsManager } from './components/ToolsManager.js';
import { SetupWizard } from './components/SetupWizard.js';
import { LowBalanceModal } from './components/LowBalanceModal.js';
import { Toast } from './components/Toast.js';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useConfig } from './hooks/useConfig.js';
import { ConnectionStatus, QRCodeModal } from './components/QRCode.js';
import { checkAuth, authHeaders, getUnreadCount } from './services/api.js';
import { playTransferAlert } from './utils/alertSound.js';
import { getNotifPref, playNotificationSound, showBrowserNotification } from './utils/notifications.js';

const LOW_BALANCE_SNOOZE_KEY = 'whatsbot_low_balance_snoozed_until';

function lowBalanceIsSnoozed() {
  try {
    const v = parseInt(localStorage.getItem(LOW_BALANCE_SNOOZE_KEY) || '0', 10);
    return v && Date.now() < v;
  } catch { return false; }
}

function snoozeLowBalance(ms) {
  try {
    localStorage.setItem(LOW_BALANCE_SNOOZE_KEY, String(Date.now() + ms));
  } catch {}
}

const html = htm.bind(h);

// Core (built-in) routes. Plugin screens are merged in dynamically below.
// '/' is the operational dashboard (home) — the chat list/conversation view
// moved to '/conversas' to make room for it.
const CORE_ROUTES = {
  '/': 'home',
  '/conversas': 'contacts',
  '/painel': 'dashboard',
  '/sandbox': 'sandbox',
  '/costs': 'costs',
  '/executions': 'executions',
  '/plugins': 'plugins',
  '/tools': 'tools',
};
const CORE_TAB_PATHS = {
  home: '/',
  contacts: '/conversas',
  dashboard: '/painel',
  sandbox: '/sandbox',
  costs: '/costs',
  executions: '/executions',
  plugins: '/plugins',
  tools: '/tools',
};

// Tab id used internally for plugin screens. We encode the plugin id and
// the screen path so the router can round-trip it.
function pluginTabId(screen) { return `plugin:${screen.pluginId}:${screen.path}`; }

function tabFromPath(pluginScreens) {
  const path = window.location.pathname;
  if (path.match(/^\/contacts\/\d+$/)) return 'contacts';
  if (path.match(/^\/executions\/\d+$/)) return 'executions';
  const screen = (pluginScreens || []).find(s => s.path === path);
  if (screen) return pluginTabId(screen);
  return CORE_ROUTES[path] || 'home';
}

function pathForTab(tab, pluginScreens) {
  if (CORE_TAB_PATHS[tab]) return CORE_TAB_PATHS[tab];
  if (tab && tab.startsWith('plugin:')) {
    const screen = (pluginScreens || []).find(s => pluginTabId(s) === tab);
    if (screen) return screen.path;
  }
  return '/';
}

function contactIdFromPath() {
  const m = window.location.pathname.match(/^\/contacts\/(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function MenuItem({ active, href, onClick, icon, children }) {
  function handleClick(e) {
    // Let the browser handle modified clicks (Ctrl/Cmd/Shift) and middle-click
    // so users can open the menu item in a new tab/window.
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onClick();
  }
  return html`
    <a
      href=${href}
      onClick=${handleClick}
      class="w-full text-left px-4 py-2.5 text-[14px] hover:bg-wa-hover transition-colors flex items-center gap-2 no-underline ${active ? 'text-wa-teal font-medium' : 'text-wa-text'}"
    >
      ${icon}
      ${children}
    </a>
  `;
}

function DesktopNavbar({ tab, onTabChange, unreadCount, status, qrAvailable, config, onSaveConfig, onOpenQR, pluginScreens, hasPassword, onLogout, accountUrl }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [pluginsMenuOpen, setPluginsMenuOpen] = useState(false);
  const pluginsRef = useRef(null);

  function toggleDark() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('whatsbot_theme', next ? 'dark' : 'light'); } catch (e) {}
    setDark(next);
  }

  useEffect(() => {
    function onDoc(e) {
      if (pluginsRef.current && !pluginsRef.current.contains(e.target)) setPluginsMenuOpen(false);
    }
    if (pluginsMenuOpen) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pluginsMenuOpen]);

  const autoReply = config ? config.auto_reply !== false : true;

  function handleToggleAutoReply() {
    if (!config || !onSaveConfig) return;
    onSaveConfig({ auto_reply: !autoReply });
  }

  const navItems = [
    { id: 'home', label: 'Início', path: CORE_TAB_PATHS.home },
    { id: 'contacts', label: 'Conversas', path: CORE_TAB_PATHS.contacts, badge: unreadCount },
    { id: 'dashboard', label: 'Painel', path: CORE_TAB_PATHS.dashboard },
    { id: 'sandbox', label: 'Sandbox', path: CORE_TAB_PATHS.sandbox },
    { id: 'costs', label: 'Custos', path: CORE_TAB_PATHS.costs },
    { id: 'executions', label: 'Execuções', path: CORE_TAB_PATHS.executions },
  ];

  return html`
    <header class="hidden lg:flex items-center justify-between px-5 h-[56px] bg-wa-panel border-b border-wa-border shrink-0 z-40 select-none shadow-xs">
      <div class="flex items-center gap-6">
        <div onClick=${() => onTabChange('home')} class="flex items-center gap-2.5 cursor-pointer group">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center text-white font-black text-sm shadow-sm group-hover:scale-105 transition-transform">
            WB
          </div>
          <div class="flex flex-col">
            <span class="font-bold text-wa-text tracking-tight text-[15px] leading-none">WhatsBot</span>
            <span class="text-[10px] text-wa-secondary font-medium mt-0.5">Painel IA Operator</span>
          </div>
        </div>

        <nav class="flex items-center gap-1">
          ${navItems.map(item => {
            const isActive = tab === item.id;
            return html`
              <a
                key=${item.id}
                href=${item.path}
                onClick=${(e) => {
                  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onTabChange(item.id);
                }}
                class="relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 no-underline ${
                  isActive
                    ? 'bg-wa-teal/15 text-wa-teal shadow-2xs'
                    : 'text-wa-secondary hover:text-wa-text hover:bg-wa-hover'
                }"
              >
                ${item.label}
                ${item.badge > 0 ? html`
                  <span class="bg-wa-teal text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full leading-snug shadow-2xs animate-pulse-slow">
                    ${item.badge}
                  </span>
                ` : null}
              </a>
            `;
          })}

          ${(pluginScreens && pluginScreens.length > 0) ? html`
            <div ref=${pluginsRef} class="relative ml-1">
              <button
                onClick=${() => setPluginsMenuOpen(!pluginsMenuOpen)}
                class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                  tab && tab.startsWith('plugin:')
                    ? 'bg-wa-teal/15 text-wa-teal'
                    : 'text-wa-secondary hover:text-wa-text hover:bg-wa-hover'
                }"
              >
                Plugins (${pluginScreens.length})
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" class="transition-transform ${pluginsMenuOpen ? 'rotate-180' : ''}"><path d="M7 10l5 5 5-5z"/></svg>
              </button>
              ${pluginsMenuOpen ? html`
                <div class="absolute left-0 top-full mt-1 bg-wa-bg border border-wa-border rounded-xl shadow-lg py-1.5 min-w-[200px] z-50">
                  ${pluginScreens.map(s => html`
                    <a
                      key=${pluginTabId(s)}
                      href=${s.path}
                      onClick=${(e) => {
                        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        onTabChange(pluginTabId(s));
                        setPluginsMenuOpen(false);
                      }}
                      class="px-3.5 py-2 text-xs font-medium text-wa-text hover:bg-wa-hover flex items-center gap-2 no-underline cursor-pointer"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="text-wa-teal"><path d="M5 3h6v8H5V3zm8 0h6v6h-6V3zm0 8h6v10h-6V11zm-8 4h6v6H5v-6z"/></svg>
                      ${s.title}
                    </a>
                  `)}
                </div>
              ` : null}
            </div>
          ` : null}
        </nav>
      </div>

      <div class="flex items-center gap-3">
        <!-- Global AI toggle pill -->
        <button
          onClick=${handleToggleAutoReply}
          class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all border cursor-pointer ${
            autoReply
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
          }"
          title="Alternar resposta automática da IA globalmente"
        >
          <span class="w-2 h-2 rounded-full ${autoReply ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></span>
          <span>IA: ${autoReply ? 'Ativada' : 'Desativada'}</span>
        </button>

        <!-- Connection Badge -->
        <button
          onClick=${onOpenQR}
          class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all border cursor-pointer ${
            status && status.connected
              ? 'bg-wa-teal/10 border-wa-teal/30 text-wa-teal hover:bg-wa-teal/20'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
          }"
          title="Ver status da conexão WhatsApp e QR Code"
        >
          <span class="w-2 h-2 rounded-full ${status && status.connected ? 'bg-wa-teal' : 'bg-amber-500 animate-ping'}"></span>
          <span>${status && status.connected ? (status.name || status.phone || 'Conectado') : 'Desconectado'}</span>
        </button>

        <!-- Dark mode button -->
        <button
          onClick=${toggleDark}
          class="w-8 h-8 rounded-full flex items-center justify-center text-wa-secondary hover:text-wa-text hover:bg-wa-hover transition-colors cursor-pointer"
          title=${dark ? 'Alternar para Modo Claro' : 'Alternar para Modo Escuro'}
        >
          ${dark
            ? html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5l2.39 3.42C13.65 5.15 12.84 5 12 5c-.84 0-1.65.15-2.39.42L12 2zM3.34 7l4.16-.35C6.84 7.28 6.31 8 5.91 8.81L3.34 7zm0 10l2.57-1.81c.4.81.93 1.53 1.59 2.16L3.34 17zM12 22l-2.39-3.42c.74.27 1.55.42 2.39.42.84 0 1.65-.15 2.39-.42L12 22zm8.66-5l-4.16.35c.66-.63 1.19-1.35 1.59-2.16L20.66 17zm0-10l-2.57 1.81c-.4-.81-.93-1.53-1.59-2.16L20.66 7z"/></svg>`
            : html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 01-4.4 2.26 5.4 5.4 0 01-5.4-5.4c0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`
          }
        </button>

        <!-- Gear Menu Wrapper for Header -->
        <${GearMenu} tab=${tab} onTabChange=${onTabChange} pluginScreens=${pluginScreens} hasPassword=${hasPassword} onLogout=${onLogout} accountUrl=${accountUrl} isHeader=${true} />
      </div>
    </header>
  `;
}

function GearMenu({ tab, onTabChange, pluginScreens, hasPassword, onLogout, accountUrl, isHeader }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const close = () => setOpen(false);

  // Dark mode: toggles `.dark` on <html> (re-themes the whole app via CSS
  // variables) and persists the choice. The early script in index.html applies
  // it before first paint so there's no flash on reload.
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  function toggleDark() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('whatsbot_theme', next ? 'dark' : 'light'); } catch (e) {}
    setDark(next);
  }

  return html`
    <div ref=${menuRef} class=${isHeader ? 'relative z-50' : 'fixed top-3 right-3 z-50 lg:hidden'}>
      <button
        onClick=${() => setOpen(!open)}
        class="w-[36px] h-[36px] flex items-center justify-center rounded-full bg-wa-bg shadow-md border border-wa-border hover:bg-wa-hover transition-colors cursor-pointer"
        title="Configurações e menu"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="#54656f">
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
        </svg>
      </button>
      ${open ? html`
        <div class="absolute right-0 mt-1 bg-wa-bg rounded-lg shadow-lg border border-wa-border py-1 min-w-[180px] max-h-[80vh] overflow-y-auto">
          <${MenuItem} active=${tab === 'home'} href=${CORE_TAB_PATHS.home} onClick=${() => { onTabChange('home'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`}
          >Início</${MenuItem}>
          <${MenuItem} active=${tab === 'contacts'} href=${CORE_TAB_PATHS.contacts} onClick=${() => { onTabChange('contacts'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`}
          >Conversas</${MenuItem}>
          <${MenuItem} active=${tab === 'dashboard'} href=${CORE_TAB_PATHS.dashboard} onClick=${() => { onTabChange('dashboard'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`}
          >Painel</${MenuItem}>
          <${MenuItem} active=${tab === 'sandbox'} href=${CORE_TAB_PATHS.sandbox} onClick=${() => { onTabChange('sandbox'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 5h10v2h2V3c0-.55-.45-1-1-1H6c-.55 0-1 .45-1 1v4h2V5zm8.41 11.59L20 12l-4.59-4.59L14 8.83 17.17 12 14 15.17l1.41 1.42zM10 15.17L6.83 12 10 8.83 8.59 7.41 4 12l4.59 4.59L10 15.17zM17 19H7v-2H5v4c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-4h-2v2z"/></svg>`}
          >Sandbox</${MenuItem}>
          <${MenuItem} active=${tab === 'costs'} href=${CORE_TAB_PATHS.costs} onClick=${() => { onTabChange('costs'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`}
          >Custos</${MenuItem}>
          <${MenuItem} active=${tab === 'executions'} href=${CORE_TAB_PATHS.executions} onClick=${() => { onTabChange('executions'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>`}
          >Execuções</${MenuItem}>

          ${(pluginScreens && pluginScreens.length > 0) ? html`
            <div class="border-t border-wa-border my-1"></div>
            <div class="px-4 py-1.5 text-[11px] uppercase tracking-wide text-wa-secondary">
              Plugins
            </div>
            ${pluginScreens.map(s => html`
              <${MenuItem}
                key=${pluginTabId(s)}
                active=${tab === pluginTabId(s)}
                href=${s.path}
                onClick=${() => { onTabChange(pluginTabId(s)); close(); }}
                icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5 3h6v8H5V3zm8 0h6v6h-6V3zm0 8h6v10h-6V11zm-8 4h6v6H5v-6z"/></svg>`}
              >${s.title}</${MenuItem}>
            `)}
          ` : null}

          <div class="border-t border-wa-border my-1"></div>
          ${accountUrl ? html`
            <a
              href=${accountUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick=${close}
              class="w-full text-left px-4 py-2.5 text-[14px] hover:bg-wa-hover transition-colors flex items-center gap-2 no-underline text-wa-text"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
              Saldo e Recargar
            </a>
          ` : null}
          <${MenuItem} active=${tab === 'tools'} href=${CORE_TAB_PATHS.tools} onClick=${() => { onTabChange('tools'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>`}
          >Gerenciar Tools</${MenuItem}>
          <${MenuItem} active=${tab === 'plugins'} href=${CORE_TAB_PATHS.plugins} onClick=${() => { onTabChange('plugins'); close(); }}
            icon=${html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>`}
          >Gerenciar Plugins</${MenuItem}>

          <div class="border-t border-wa-border my-1"></div>
          <button
            onClick=${toggleDark}
            class="w-full text-left px-4 py-2.5 text-[14px] hover:bg-wa-hover transition-colors flex items-center gap-2 text-wa-text"
          >
            ${dark
              ? html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5l2.39 3.42C13.65 5.15 12.84 5 12 5c-.84 0-1.65.15-2.39.42L12 2zM3.34 7l4.16-.35C6.84 7.28 6.31 8 5.91 8.81L3.34 7zm0 10l2.57-1.81c.4.81.93 1.53 1.59 2.16L3.34 17zM12 22l-2.39-3.42c.74.27 1.55.42 2.39.42.84 0 1.65-.15 2.39-.42L12 22zm8.66-5l-4.16.35c.66-.63 1.19-1.35 1.59-2.16L20.66 17zm0-10l-2.57 1.81c-.4-.81-.93-1.53-1.59-2.16L20.66 7z"/></svg>`
              : html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 01-4.4 2.26 5.4 5.4 0 01-5.4-5.4c0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`}
            <span class="flex-1">Modo escuro</span>
            <span class="w-9 h-5 rounded-full transition-colors relative shrink-0 ${dark ? 'bg-wa-teal' : 'bg-wa-border'}">
              <span class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${dark ? 'left-[18px]' : 'left-0.5'}"></span>
            </span>
          </button>

          ${hasPassword ? html`
            <div class="border-t border-wa-border my-1"></div>
            <button
              onClick=${() => { onLogout(); close(); }}
              class="w-full text-left px-4 py-2.5 text-[14px] hover:bg-red-50 transition-colors flex items-center gap-2 text-red-600"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
              Sair
            </button>
          ` : null}
        </div>
      ` : null}
    </div>
  `;
}

function MobileTopBar({ tab, onTabChange, status, config, onSaveConfig, onOpenQR, pluginScreens, hasPassword, onLogout, accountUrl }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  function toggleDark() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('whatsbot_theme', next ? 'dark' : 'light'); } catch (e) {}
    setDark(next);
  }

  const autoReply = config ? config.auto_reply !== false : true;

  function handleToggleAutoReply() {
    if (!config || !onSaveConfig) return;
    onSaveConfig({ auto_reply: !autoReply });
  }

  return html`
    <header class="lg:hidden flex items-center justify-between px-3 h-[52px] bg-wa-panel border-b border-wa-border shrink-0 z-40 select-none shadow-2xs">
      <div class="flex items-center gap-2">
        <!-- Logo & Connection Status Button -->
        <button onClick=${onOpenQR} class="flex items-center gap-2 py-1 px-2 rounded-xl bg-wa-bg/70 border border-wa-border/80 hover:bg-wa-hover transition-colors cursor-pointer">
          <div class="relative w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-400 flex items-center justify-center text-white font-black text-xs shadow-2xs">
            WB
            <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-wa-panel ${status && status.connected ? 'bg-wa-teal' : 'bg-amber-500 animate-ping'}"></span>
          </div>
          <div class="flex flex-col text-left leading-none">
            <span class="font-bold text-wa-text text-[13px] tracking-tight">WhatsBot</span>
            <span class="text-[9.5px] font-medium text-wa-secondary">
              ${status && status.connected ? 'Online' : 'Desconectado'}
            </span>
          </div>
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- Quick AI Toggle Pill -->
        <button
          onClick=${handleToggleAutoReply}
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all border cursor-pointer ${
            autoReply
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
          }"
          title="Alternar IA globalmente"
        >
          <span class="w-1.5 h-1.5 rounded-full ${autoReply ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}"></span>
          <span>IA: ${autoReply ? 'ON' : 'OFF'}</span>
        </button>

        <!-- Dark mode button -->
        <button
          onClick=${toggleDark}
          class="w-8 h-8 rounded-full flex items-center justify-center text-wa-secondary hover:text-wa-text hover:bg-wa-hover transition-colors cursor-pointer"
          title="Alternar modo escuro"
        >
          ${dark
            ? html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5l2.39 3.42C13.65 5.15 12.84 5 12 5c-.84 0-1.65.15-2.39.42L12 2zM3.34 7l4.16-.35C6.84 7.28 6.31 8 5.91 8.81L3.34 7zm0 10l2.57-1.81c.4.81.93 1.53 1.59 2.16L3.34 17zM12 22l-2.39-3.42c.74.27 1.55.42 2.39.42.84 0 1.65-.15 2.39-.42L12 22zm8.66-5l-4.16.35c.66-.63 1.19-1.35 1.59-2.16L20.66 17zm0-10l-2.57 1.81c-.4-.81-.93-1.53-1.59-2.16L20.66 7z"/></svg>`
            : html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3a9 9 0 109 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 01-4.4 2.26 5.4 5.4 0 01-5.4-5.4c0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`
          }
        </button>

        <!-- Gear Menu Trigger -->
        <${GearMenu} tab=${tab} onTabChange=${onTabChange} pluginScreens=${pluginScreens} hasPassword=${hasPassword} onLogout=${onLogout} accountUrl=${accountUrl} isHeader=${true} />
      </div>
    </header>
  `;
}

// Mobile bottom navigation — WhatsApp-style primary tabs, thumb-reachable.
// A normal flex child (not `fixed`), so it never overlaps content: <main> is
// flex-1 and shrinks to make room for it automatically. Hidden from `lg` up,
// where the gear menu + desktop layout are already comfortable.
function BottomNavItem({ active, onClick, icon, badge, children }) {
  return html`
    <button
      onClick=${onClick}
      class="flex-1 flex flex-col items-center justify-center gap-1 py-1.5 relative transition-colors cursor-pointer ${
        active ? 'text-wa-teal font-semibold' : 'text-wa-secondary hover:text-wa-text'
      }"
    >
      ${active ? html`<span class="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-wa-teal rounded-b-full"></span>` : null}
      <span class="relative">
        ${icon}
        ${badge ? html`
          <span class="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-[3px] rounded-full bg-wa-badge text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-xs animate-pulse-slow">${badge > 99 ? '99+' : badge}</span>
        ` : null}
      </span>
      <span class="text-[10.5px] leading-none tracking-tight">${children}</span>
    </button>
  `;
}

function BottomNav({ tab, onTabChange, pluginScreens, unreadCount }) {
  const ordersScreen = (pluginScreens || []).find(s => s.pluginId === 'orders');
  return html`
    <nav class="lg:hidden shrink-0 flex items-stretch bg-wa-panel border-t border-wa-border/80 shadow-lg z-30" style="padding-bottom: env(safe-area-inset-bottom)">
      <${BottomNavItem} active=${tab === 'home'} onClick=${() => onTabChange('home')}
        icon=${html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`}
      >Início</${BottomNavItem}>

      <${BottomNavItem} active=${tab === 'contacts'} onClick=${() => onTabChange('contacts')} badge=${unreadCount}
        icon=${html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`}
      >Conversas</${BottomNavItem}>

      <${BottomNavItem} active=${tab === 'dashboard'} onClick=${() => onTabChange('dashboard')}
        icon=${html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`}
      >Painel</${BottomNavItem}>

      ${ordersScreen ? html`
        <${BottomNavItem} active=${tab === pluginTabId(ordersScreen)} onClick=${() => onTabChange(pluginTabId(ordersScreen))}
          icon=${html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L20.88 6H4.54l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>`}
        >Pedidos</${BottomNavItem}>
      ` : null}

      <${BottomNavItem} active=${tab === 'plugins' || tab === 'sandbox' || tab === 'costs' || tab === 'tools'} onClick=${() => onTabChange('plugins')}
        icon=${html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`}
      >Mais</${BottomNavItem}>
    </nav>
  `;
}

function PageHeader({ title, onBack }) {
  return html`
    <div class="flex items-center gap-3 mb-4">
      <button
        onClick=${onBack}
        class="w-[36px] h-[36px] flex items-center justify-center rounded-full hover:bg-wa-hover transition-colors"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="#54656f">
          <path d="M12 4l1.4 1.4L7.8 11H20v2H7.8l5.6 5.6L12 20l-8-8 8-8z"/>
        </svg>
      </button>
      <h1 class="text-[20px] font-medium text-wa-text">${title}</h1>
    </div>
  `;
}

function App({ onLogout, hasPassword }) {
  const [status, setStatus] = useState({ connected: false, msg_count: 0, auto_reply_running: false });
  const [qrAvailable, setQrAvailable] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);
  const [notification, setNotification] = useState('Iniciando...');
  const [wsConnected, setWsConnected] = useState(true);
  const [pluginScreens, setPluginScreens] = useState([]);
  const [tab, setTabState] = useState(() => tabFromPath([]));
  const [unreadConvos, setUnreadConvos] = useState(0);  // conversations with unread msgs (tab-title badge)
  const [newMessage, setNewMessage] = useState(null);
  const [chatPresence, setChatPresence] = useState(null);
  const [contactInfoUpdated, setContactInfoUpdated] = useState(null);
  const [tagsChanged, setTagsChanged] = useState(null);
  const [contactTagsUpdated, setContactTagsUpdated] = useState(null);
  const [contactAiToggled, setContactAiToggled] = useState(null);
  const [messagesRead, setMessagesRead] = useState(null);
  const [messageStatus, setMessageStatus] = useState(null);
  const [messageAction, setMessageAction] = useState(null);
  const [messageReaction, setMessageReaction] = useState(null);
  const [avatarUpdated, setAvatarUpdated] = useState(null);
  const [groupParticipantsChanged, setGroupParticipantsChanged] = useState(null);
  const [lowBalance, setLowBalance] = useState(null);
  const [initialContactId, setInitialContactId] = useState(contactIdFromPath);
  const [wizardManual, setWizardManual] = useState(() => window.location.pathname === '/wizard');
  const [showQrModal, setShowQrModal] = useState(false);
  const wizardLatchRef = useRef(false);

  // Open/close the setup wizard, keeping the /wizard URL in sync so it can be
  // reached directly (and bookmarked / shared).
  const openWizard = useCallback(() => {
    setWizardManual(true);
    if (window.location.pathname !== '/wizard') history.pushState(null, '', '/wizard');
  }, []);
  const closeWizard = useCallback(() => {
    wizardLatchRef.current = false;
    setWizardManual(false);
    if (window.location.pathname === '/wizard') {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  // Fetch the public plugin manifest once at boot. Errors are non-fatal —
  // the core app keeps running even if plugins fail to load.
  useEffect(() => {
    fetch('/api/plugins/manifest', { headers: authHeaders() })
      .then(r => r.json())
      .then(res => {
        if (!res || !res.ok) return;
        const screens = (res.data.plugins || []).flatMap(p =>
          (p.screens || [])
            .filter(s => !s.config)  // config screens live in the Plugins tab, not the gear menu
            .map(s => ({ ...s, pluginId: s.pluginId || p.id }))
        );
        setPluginScreens(screens);
        // Re-evaluate tab now that we know about plugin paths.
        setTabState(tabFromPath(screens));
      })
      .catch(() => { /* ignore */ });
  }, []);

  const setTab = useCallback((t) => {
    setTabState(t);
    const path = pathForTab(t, pluginScreens);
    if (window.location.pathname !== path) {
      history.pushState(null, '', path);
      // pushState doesn't fire popstate; notify listeners (e.g. Executions
      // syncs its detail view with the URL).
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [pluginScreens]);

  useEffect(() => {
    function onPopState() {
      setTabState(tabFromPath(pluginScreens));
      setInitialContactId(contactIdFromPath());
      setWizardManual(window.location.pathname === '/wizard');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [pluginScreens]);

  const { config, loading, saving, save } = useConfig();

  const configRef = useRef(config);
  useEffect(() => { configRef.current = config; }, [config]);

  // First run (no API key, setup not completed): reflect the wizard in the
  // URL so a hard reload / share lands back on /wizard.
  useEffect(() => {
    const firstRun = config && config.setup_completed !== true && !config.openrouter_api_key;
    if (firstRun && window.location.pathname !== '/wizard') {
      history.replaceState(null, '', '/wizard');
    }
  }, [config]);

  useWebSocket({
    onStatus: useCallback((data) => setStatus(data), []),
    onQrUpdate: useCallback((data) => {
      setQrAvailable(data.available);
      if (data.version) setQrVersion(data.version);
    }, []),
    onGowaStatus: useCallback((data) => setNotification(data.message), []),
    onConfigSaved: useCallback(() => setNotification('Configurações salvas!'), []),
    onNewMessage: useCallback((data) => setNewMessage(data), []),
    onChatPresence: useCallback((data) => setChatPresence(data), []),
    onContactInfoUpdated: useCallback((data) => setContactInfoUpdated(data), []),
    onTagsChanged: useCallback((data) => setTagsChanged(data), []),
    onContactTagsUpdated: useCallback((data) => setContactTagsUpdated(data), []),
    onHumanTransferAlert: useCallback(() => {
      const cfg = configRef.current;
      if (cfg && cfg.transfer_alert_enabled === false) return;
      const duration = cfg?.transfer_alert_duration || 5;
      playTransferAlert(duration);
    }, []),
    onContactAiToggled: useCallback((data) => setContactAiToggled(data), []),
    onMessagesRead: useCallback((data) => setMessagesRead(data), []),
    onMessageStatus: useCallback((data) => setMessageStatus(data), []),
    onMessageAction: useCallback((data) => setMessageAction(data), []),
    onMessageReaction: useCallback((data) => setMessageReaction(data), []),
    onAvatarUpdated: useCallback((data) => setAvatarUpdated(data), []),
    onGroupParticipantsChanged: useCallback((data) => setGroupParticipantsChanged({ ...data, _t: Date.now() }), []),
    onLowBalance: useCallback((data) => {
      if (lowBalanceIsSnoozed()) return;
      setLowBalance(data);
    }, []),
    onWsConnect: useCallback(() => setWsConnected(true), []),
    onWsDisconnect: useCallback(() => setWsConnected(false), []),
  });

  // One-shot balance check on boot — covers the case where the app opens while
  // already below the threshold but no LLM call has happened since the last
  // broadcast. Skipped when the user has snoozed the popup.
  useEffect(() => {
    if (!config || !config.openrouter_api_key) return;
    if (lowBalanceIsSnoozed()) return;
    fetch('/api/balance', { headers: authHeaders() })
      .then(r => r.json())
      .then(res => {
        if (res && res.ok && res.data && res.data.low_balance_enabled && res.data.below_threshold) {
          setLowBalance({
            remaining: res.data.remaining,
            total_credits: res.data.total_credits,
            total_usage: res.data.total_usage,
            threshold: res.data.threshold,
            account_url: res.data.account_url,
          });
        }
      })
      .catch(() => { /* ignore */ });
  }, [config && config.openrouter_api_key]);

  // ── Browser-tab unread badge ("(3) WhatsBot"), like WhatsApp Web ──────────
  // Single source of truth is the backend count; we refresh it (debounced) on
  // boot, on WS events that change unread state, and when the contacts list
  // reports a change (e.g. the operator opened/read a chat — no WS event fires
  // for that on the same client).
  const unreadTimerRef = useRef(null);
  const refreshUnreadCount = useCallback(() => {
    if (unreadTimerRef.current) clearTimeout(unreadTimerRef.current);
    unreadTimerRef.current = setTimeout(async () => {
      try {
        const res = await getUnreadCount();
        if (res && res.ok) setUnreadConvos(res.data.count || 0);
      } catch (_) { /* ignore */ }
    }, 250);
  }, []);

  useEffect(() => { refreshUnreadCount(); }, [newMessage, messagesRead, refreshUnreadCount]);

  // Bumped when notification prefs change in the config panel, so the effects
  // below re-evaluate (e.g. turning the tab badge off should apply at once).
  const [notifVersion, setNotifVersion] = useState(0);
  useEffect(() => {
    const onPrefs = () => setNotifVersion(v => v + 1);
    window.addEventListener('whatsbot:notif-prefs', onPrefs);
    return () => window.removeEventListener('whatsbot:notif-prefs', onPrefs);
  }, []);

  // Tab-title badge — gated by the "tab notification" preference.
  useEffect(() => {
    const tabBadge = getNotifPref('tab');
    document.title = (tabBadge && unreadConvos > 0) ? `(${unreadConvos}) WhatsBot` : 'WhatsBot';
  }, [unreadConvos, notifVersion]);

  // Browser notification + sound on a new INBOUND message (from a contact).
  // Sound plays whenever enabled; the desktop notification only shows when the
  // tab isn't visible (you're away), like Telegram/WhatsApp Web.
  useEffect(() => {
    if (!newMessage) return;
    const m = newMessage.message;
    if (!m || m.role !== 'user') return;
    if (getNotifPref('sound')) playNotificationSound();
    const away = document.hidden || !document.hasFocus();
    if (getNotifPref('browser') && away) {
      let preview = (m.content || '').trim();
      if (!preview) {
        preview = m.media_type ? 'Enviou uma mídia' : 'Nova mensagem';
      }
      showBrowserNotification('WhatsBot — nova mensagem', preview.slice(0, 140));
    }
  }, [newMessage]);

  async function handleSave(data) {
    const result = await save(data);
    setNotification(result.message);
  }

  function handleNotify(msg) {
    setNotification(msg);
  }

  if (loading) {
    return html`
      <div class="h-screen flex items-center justify-center">
        <div class="text-center text-wa-secondary animate-pulse-slow">Carregando...</div>
      </div>
    `;
  }

  // First-run setup wizard — takes over the whole screen until completed.
  // Also reopenable on demand via the "Refazer configuração" button on /painel.
  // An install that already has an API key configured is NOT a first run —
  // never ambush an existing/configured user with the wizard after an update.
  const needsSetup = config
    && config.setup_completed !== true
    && !config.openrouter_api_key;
  // Once opened, the wizard stays mounted until the user finishes or closes
  // it — provisioning a key sets openrouter_api_key, which would otherwise
  // flip needsSetup to false mid-flow and unmount the wizard before step 3.
  if (needsSetup || wizardManual) wizardLatchRef.current = true;
  if (wizardLatchRef.current) {
    return html`<${SetupWizard}
      status=${status}
      qrAvailable=${qrAvailable}
      qrVersion=${qrVersion}
      config=${config}
      canClose=${!needsSetup}
      onClose=${closeWizard}
      onConfigSave=${save}
      onComplete=${async () => {
        await save({ setup_completed: true });
        closeWizard();
      }}
    />`;
  }

  // Resolve plugin screen for the current tab id, if any.
  const activePluginScreen = (tab && tab.startsWith('plugin:'))
    ? pluginScreens.find(s => pluginTabId(s) === tab)
    : null;

  return html`
    <div class="h-dvh overflow-hidden flex flex-col relative bg-wa-bg">
      <${DesktopNavbar}
        tab=${tab}
        onTabChange=${setTab}
        unreadCount=${unreadConvos}
        status=${status}
        qrAvailable=${qrAvailable}
        config=${config}
        onSaveConfig=${save}
        onOpenQR=${() => setShowQrModal(true)}
        pluginScreens=${pluginScreens}
        hasPassword=${hasPassword}
        onLogout=${onLogout}
        accountUrl=${config && config.account_url}
      />
      <${MobileTopBar}
        tab=${tab}
        onTabChange=${setTab}
        status=${status}
        config=${config}
        onSaveConfig=${save}
        onOpenQR=${() => setShowQrModal(true)}
        pluginScreens=${pluginScreens}
        hasPassword=${hasPassword}
        onLogout=${onLogout}
        accountUrl=${config && config.account_url}
      />

      <main key=${tab} class="flex-1 min-h-0 overflow-auto wa-tab-enter ${tab !== 'contacts' ? 'bg-wa-panel' : ''}">
        ${activePluginScreen
          ? html`<div class="max-w-5xl mx-auto p-4">
              <${PageHeader} title=${activePluginScreen.title} onBack=${() => setTab('home')} />
              <${PluginScreen} screen=${activePluginScreen} />
            </div>`
          : tab === 'tools'
            ? html`<div class="max-w-5xl mx-auto p-4">
                <${PageHeader} title="Tools" onBack=${() => setTab('home')} />
                <${ToolsManager} />
              </div>`
            : tab === 'plugins'
            ? html`<div class="max-w-5xl mx-auto p-4">
                <${PageHeader} title="Plugins" onBack=${() => setTab('home')} />
                <${PluginsManager} onPluginsChanged=${() => {
                  fetch('/api/plugins/manifest', { headers: authHeaders() }).then(r => r.json()).then(res => {
                    if (res && res.ok) {
                      const sc = (res.data.plugins || []).flatMap(p =>
                        (p.screens || [])
                          .filter(s => !s.config)
                          .map(s => ({ ...s, pluginId: s.pluginId || p.id }))
                      );
                      setPluginScreens(sc);
                    }
                  });
                }} />
              </div>`
            : tab === 'dashboard'
              ? html`<div class="max-w-5xl mx-auto p-4">
                  <${PageHeader} title="Painel" onBack=${() => setTab('home')} />
                  <${Dashboard}
                    status=${status}
                    qrAvailable=${qrAvailable}
                    qrVersion=${qrVersion}
                    config=${config}
                    saving=${saving}
                    onSave=${handleSave}
                    onNotify=${handleNotify}
                    onReopenSetup=${openWizard}
                  />
                </div>`
              : tab === 'home'
                ? html`<div class="w-full max-w-none p-2 sm:p-3 lg:p-4 h-full">
                    <${OperationalDashboard} pluginScreens=${pluginScreens} newMessage=${newMessage} messagesRead=${messagesRead} contactAiToggled=${contactAiToggled} config=${config} />
                  </div>`
              : tab === 'contacts'
                ? html`<${Contacts} newMessage=${newMessage} chatPresence=${chatPresence} contactInfoUpdated=${contactInfoUpdated} tagsChanged=${tagsChanged} contactTagsUpdated=${contactTagsUpdated} contactAiToggled=${contactAiToggled} messagesRead=${messagesRead} messageStatus=${messageStatus} messageAction=${messageAction} messageReaction=${messageReaction} avatarUpdated=${avatarUpdated} groupParticipantsChanged=${groupParticipantsChanged} initialContactId=${initialContactId} wsConnected=${wsConnected} config=${config} onConfigSave=${save} onUnreadChange=${refreshUnreadCount} />`
                : tab === 'costs'
                  ? html`<div class="max-w-5xl mx-auto p-4">
                      <${PageHeader} title="Custos de IA" onBack=${() => setTab('home')} />
                      <${CostsDashboard} />
                    </div>`
                  : tab === 'executions'
                    ? html`<div class="max-w-5xl mx-auto p-4 h-full">
                        <${PageHeader} title="Execuções" onBack=${() => {
                          if (window.location.pathname.match(/^\/executions\/\d+$/)) {
                            history.pushState(null, '', '/executions');
                            window.dispatchEvent(new PopStateEvent('popstate'));
                          } else {
                            setTab('home');
                          }
                        }} />
                        <${Executions} />
                      </div>`
                    : html`<${Sandbox} newMessage=${newMessage} />`
        }
      </main>

      <${BottomNav} tab=${tab} onTabChange=${setTab} pluginScreens=${pluginScreens} unreadCount=${unreadConvos} />
      <${Toast} message=${notification} />

      ${showQrModal ? html`<${QRCodeModal}
        connected=${status && status.connected}
        botPhone=${status && status.phone}
        botName=${status && status.name}
        qrAvailable=${qrAvailable}
        qrVersion=${qrVersion}
        onClose=${() => setShowQrModal(false)}
      />` : null}

      ${lowBalance ? html`<${LowBalanceModal}
        balance=${lowBalance.remaining}
        threshold=${lowBalance.threshold}
        accountUrl=${lowBalance.account_url || (config && config.account_url)}
        onClose=${() => setLowBalance(null)}
        onSnooze=${(ms) => snoozeLowBalance(ms)}
      />` : null}
    </div>
  `;
}

function AuthGate() {
  const [authState, setAuthState] = useState('checking'); // 'checking' | 'login' | 'ready'
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    checkAuth().then(res => {
      if (res.ok) {
        setHasPassword(res.data.has_password);
        setAuthState('ready');
      } else {
        setHasPassword(true);
        setAuthState('login');
      }
    }).catch(() => {
      setAuthState('ready');
    });
  }, []);

  useEffect(() => {
    function onUnauthorized() {
      setHasPassword(true);
      setAuthState('login');
    }
    window.addEventListener('whatsbot:unauthorized', onUnauthorized);
    return () => window.removeEventListener('whatsbot:unauthorized', onUnauthorized);
  }, []);

  function handleLogin() {
    setAuthState('ready');
    setHasPassword(true);
  }

  function handleLogout() {
    localStorage.removeItem('whatsbot_token');
    setAuthState('login');
  }

  if (authState === 'checking') {
    return html`
      <div class="h-screen flex items-center justify-center">
        <div class="text-center text-wa-secondary animate-pulse-slow">Carregando...</div>
      </div>
    `;
  }

  if (authState === 'login') {
    return html`<${LoginScreen} onLogin=${handleLogin} />`;
  }

  return html`<${App} onLogout=${handleLogout} hasPassword=${hasPassword} />`;
}

render(html`<${AuthGate} />`, document.getElementById('app'));
