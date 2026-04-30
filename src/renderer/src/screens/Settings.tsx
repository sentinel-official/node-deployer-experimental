import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { AppSettings } from '../../../shared/types';

export function Settings() {
  const {
    settings,
    refreshSettings,
    saveSettings,
    chainHealth,
    refreshChainHealth,
    pushToast,
  } = useApp();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) void refreshSettings();
    void refreshChainHealth();
  }, [settings, refreshSettings, refreshChainHealth]);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft) {
    return (
      <div className="flex flex-col h-full min-h-0 gap-3">
        <PageHeader title="Settings" />
        <div className="card flex-1 min-h-0">
          <div className="card-body">
            <div className="loading-state">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const update = (patch: Partial<AppSettings>) => setDraft({ ...draft, ...patch });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(draft);
      pushToast({ title: 'Settings saved', tone: 'success' });
      await refreshChainHealth();
    } finally {
      setSaving(false);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <PageHeader
        title="Settings"
        subtitle="Configure RPC endpoints, Sentinel chain parameters, and application preferences."
        right={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => void refreshChainHealth()}
            >
              <MIcon name="network_check" size={14} />
              Probe RPC pool
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-8 card flex flex-col min-h-0 overflow-hidden">
          <div className="card-header">
            <div className="card-title">Chain</div>
          </div>
          <div className="card-body flex flex-col gap-3 flex-1 min-h-0 overflow-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="field-label">Chain ID</div>
                <input
                  className="field-input mono-inline"
                  value={draft.chainId}
                  onChange={(e) => update({ chainId: e.target.value })}
                />
              </div>
              <div>
                <div className="field-label">Gas price (udvpn per gas unit)</div>
                <input
                  className="field-input mono-inline"
                  value={draft.gasPriceUdvpn}
                  onChange={(e) => update({ gasPriceUdvpn: e.target.value })}
                />
                <div
                  className="text-[10px] mt-1"
                  style={{ color: 'var(--text-dim)' }}
                >
                  1 $P2P equals 1,000,000 udvpn. The network default is{' '}
                  <span className="mono-inline">0.1udvpn</span> (approximately 0.0000001 $P2P per gas unit).
                </div>
              </div>
            </div>
            <div>
              <div className="field-label">
                RPC endpoints (one per line; requests use the first reachable endpoint)
              </div>
              <textarea
                rows={3}
                value={draft.rpcUrls.join('\n')}
                onChange={(e) => update({ rpcUrls: e.target.value.split(/\r?\n/) })}
                className="field-input mono-inline text-xs"
              />
            </div>

            <div className="flex flex-col min-h-0">
              <div
                className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Pool health
              </div>
              {chainHealth.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  Probing…
                </div>
              ) : (
                <ul
                  className="overflow-hidden"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  {chainHealth.map((h, idx) => (
                    <li
                      key={h.rpcUrl}
                      className="px-3 py-2 flex items-center gap-3 text-xs"
                      style={{
                        borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                        background: 'var(--bg-input)',
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{
                          background: h.reachable ? 'var(--green)' : 'var(--red)',
                        }}
                      />
                      <span className="mono-inline truncate min-w-0" style={{ color: 'var(--text)' }}>
                        {h.rpcUrl}
                      </span>
                      <div className="flex-1" />
                      {h.reachable ? (
                        <>
                          <span style={{ color: 'var(--text-muted)' }}>
                            height {h.blockHeight ?? '—'}
                          </span>
                          <span style={{ color: 'var(--text-dim)' }}>
                            · {h.latencyMs}ms
                          </span>
                        </>
                      ) : (
                        <span
                          className="truncate max-w-[280px]"
                          style={{ color: 'var(--red)' }}
                        >
                          {h.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col">
              <div
                className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Refresh cadence
              </div>
              <p
                className="text-[11px] mb-3"
                style={{ color: 'var(--text-muted)' }}
              >
                How often the app re-queries the chain in the background. Lower
                values keep the UI fresher but issue more RPC calls — pick longer
                intervals on metered or rate-limited endpoints.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <RefreshIntervalField
                  label="Wallet balance"
                  hint="Re-queries the operator wallet's $P2P balance. 10–600 seconds."
                  min={10}
                  max={600}
                  step={5}
                  value={draft.walletRefreshIntervalSec}
                  onChange={(v) => update({ walletRefreshIntervalSec: v })}
                />
                <RefreshIntervalField
                  label="Node status"
                  hint="Samples each deployed node (sessions, earnings, reachability). 15–600 seconds."
                  min={15}
                  max={600}
                  step={5}
                  value={draft.nodeRefreshIntervalSec}
                  onChange={(v) => update({ nodeRefreshIntervalSec: v })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 flex flex-col min-h-0 gap-3">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Docker</div>
            </div>
            <div className="card-body flex flex-col gap-2">
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Leave blank to auto-detect. Override only when running Colima, Podman, or rootless Docker.
              </p>
              <div>
                <div className="field-label">Socket path</div>
                <input
                  value={draft.dockerSocket}
                  onChange={(e) => update({ dockerSocket: e.target.value })}
                  placeholder="/var/run/docker.sock"
                  className="field-input mono-inline text-xs"
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">App</div>
            </div>
            <div className="card-body space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.minimizeToTrayOnClose}
                  onChange={(e) => update({ minimizeToTrayOnClose: e.target.checked })}
                  className="mt-[2px]"
                />
                <span className="text-xs">
                  <span className="block" style={{ color: 'var(--text)' }}>
                    Minimize to tray on close
                  </span>
                  <span className="block" style={{ color: 'var(--text-muted)' }}>
                    Closing the window will hide it to the system tray so the application can
                    continue polling your nodes. Use the tray menu to quit fully.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.stopNodesOnQuit}
                  onChange={(e) => update({ stopNodesOnQuit: e.target.checked })}
                  className="mt-[2px]"
                />
                <span className="text-xs">
                  <span className="block" style={{ color: 'var(--text)' }}>
                    Stop running nodes on exit
                  </span>
                  <span className="block" style={{ color: 'var(--text-muted)' }}>
                    Disabled by default. Nodes continue running in Docker after the application
                    exits, so they keep earning rewards. Enable only when a full shutdown is required.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.stopCliServerOnQuit}
                  onChange={(e) => update({ stopCliServerOnQuit: e.target.checked })}
                  className="mt-[2px]"
                />
                <span className="text-xs">
                  <span className="block" style={{ color: 'var(--text)' }}>
                    Stop the local CLI server on exit
                  </span>
                  <span className="block" style={{ color: 'var(--text-muted)' }}>
                    The CLI server lets PowerShell sessions and AI agents share this app's
                    commands over a local pipe. Disable to leave the listener up across app
                    restarts (only meaningful if the server is started but the app crashes).
                  </span>
                </span>
              </label>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RefreshIntervalField({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div>
      <div className="field-label">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : min}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (Number.isFinite(raw)) onChange(clamp(raw));
          }}
          className="field-input mono-inline"
          style={{ width: 110 }}
        />
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          seconds
        </span>
      </div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--text-dim)' }}>
        {hint}
      </div>
    </div>
  );
}
