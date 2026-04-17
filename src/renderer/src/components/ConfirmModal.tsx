import { useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { MIcon } from './MIcon';

/**
 * Single global confirm-modal. The app's Zustand store holds at most one
 * `confirmPrompt` at a time; any component can call `confirm({...})` and
 * await the user's answer. Supports:
 *   • yes/no mode
 *   • "type MONIKER to confirm" gate (for destructive actions on nodes)
 */
export function ConfirmModal() {
  const { confirmPrompt, resolveConfirm } = useApp();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    setTyped('');
    const onKey = (e: KeyboardEvent) => {
      if (!confirmPrompt) return;
      if (e.key === 'Escape') resolveConfirm(false);
      if (e.key === 'Enter' && !confirmPrompt.requireType) resolveConfirm(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmPrompt, resolveConfirm]);

  if (!confirmPrompt) return null;
  const requireMatch = confirmPrompt.requireType?.trim();
  const canConfirm = !requireMatch || typed.trim() === requireMatch;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm no-drag"
      onClick={(e) => e.target === e.currentTarget && resolveConfirm(false)}
    >
      <div className="card-elev w-[440px] max-w-[90vw] p-6">
        <div className="flex items-start gap-3">
          <div
            className={[
              'h-10 w-10 rounded-lg grid place-items-center flex-shrink-0',
              confirmPrompt.tone === 'danger' && 'bg-danger/15 text-danger',
              confirmPrompt.tone === 'warning' && 'bg-warning/15 text-warning',
              (!confirmPrompt.tone || confirmPrompt.tone === 'info') && 'bg-accent/15 text-accent',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <MIcon
              name={
                confirmPrompt.tone === 'danger'
                  ? 'delete_forever'
                  : confirmPrompt.tone === 'warning'
                  ? 'warning'
                  : 'help'
              }
              size={22}
            />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-text">{confirmPrompt.title}</div>
            {confirmPrompt.body && (
              <div className="mt-1 text-sm text-text-muted">{confirmPrompt.body}</div>
            )}
          </div>
        </div>

        {requireMatch && (
          <div className="mt-4">
            <div className="field-label">
              Type <span className="font-mono text-text">{requireMatch}</span> to confirm
            </div>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="field-input font-mono"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={() => resolveConfirm(false)}>
            {confirmPrompt.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={
              confirmPrompt.tone === 'danger'
                ? 'btn bg-danger text-white hover:bg-danger/80'
                : 'btn-primary'
            }
            disabled={!canConfirm}
            onClick={() => resolveConfirm(true)}
          >
            {confirmPrompt.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
