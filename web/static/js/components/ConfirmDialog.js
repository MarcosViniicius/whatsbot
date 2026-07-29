// Reusable confirmation modal — replaces the browser's native confirm()
// dialog, which looks foreign next to the rest of the app and can't be
// styled for dark mode. Controlled: parent owns open/message/onConfirm.
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, onConfirm, onCancel }) {
  if (!open) return null;
  return html`
    <div class="fixed inset-0 bg-black/40 z-[300] flex items-center justify-center p-4" onClick=${onCancel}>
      <div class="bg-wa-bg rounded-xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-3" onClick=${(e) => e.stopPropagation()}>
        ${title ? html`<h2 class="text-base font-semibold text-wa-text">${title}</h2>` : null}
        <p class="text-sm text-wa-secondary leading-relaxed">${message}</p>
        <div class="flex justify-end gap-2 mt-2">
          <button
            onClick=${onCancel}
            class="px-4 py-2 text-sm rounded-lg border border-wa-border text-wa-text hover:bg-wa-hover transition-colors"
          >${cancelLabel}</button>
          <button
            onClick=${onConfirm}
            class="px-4 py-2 text-sm rounded-lg text-white transition-opacity hover:opacity-90 ${danger ? 'bg-red-600' : 'bg-wa-teal'}"
          >${confirmLabel}</button>
        </div>
      </div>
    </div>
  `;
}
