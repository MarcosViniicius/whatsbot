// Visible toast — replaces the "notification" state that previously updated
// silently with no on-screen feedback (config saved, GOWA status changes).
// Re-triggers its own show/auto-hide cycle whenever `message` changes.
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

export function Toast({ message, duration = 3200 }) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState('');

  useEffect(() => {
    if (!message) return;
    setShown(message);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(t);
  }, [message]);

  if (!visible || !shown) return null;

  return html`
    <div class="fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] wa-toast pointer-events-none px-4">
      <div class="pointer-events-auto flex items-center gap-2 bg-wa-text text-wa-bg text-sm font-medium px-4 py-2.5 rounded-full shadow-lg max-w-[90vw]">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="shrink-0 opacity-80">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span class="truncate">${shown}</span>
      </div>
    </div>
  `;
}
