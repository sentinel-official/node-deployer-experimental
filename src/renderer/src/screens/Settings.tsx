import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { AppSettings } from '../../../shared/types';

/**
 * Settings screen.
 *
 *   • Multi-RPC editor — one URL per line; empty preserves defaults.
 *   • Docker socket override (rarely needed).
 *   • Gas price + chain id.
 *   • Chain health panel — live probe per RPC.
 *   • "Replay onboarding" toggle.
 */
export function Settings() {
  const { settings, refreshSettings, saveSettings, chainHealth, refreshChainHealth, pushToast } = useApp();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) void refreshSettings();
    void refreshChainHealth();
  }, [settings, refreshSettings, refreshChainHealth]);

  useEffect(() => setDraft(settings), [settings]);

  if (!draft) {
    return (
      <div>
        <PageHeader title="Settings" />
        <div className="card p-6 text-sm text-text-muted">Loading…</div>
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
    <div>
      <PageHeader
        title="Settings"
        subtitle="RPC endpoints, Sentinel chain params, and app preferences."
        right={
          <>
            <button className="btn-secondary" onClick={() => void refreshChainHealth()}>
              <MIcon name="network_check" size={14} />
              Probe RPC pool
            </button>
            <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      />

      <div className="card p-6">
        <div className="section-title mb-3">Chain</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="field-label">Chain ID</div>
            <input
              className="field-input font-mono"
              value={draft.chainId}
              onChange={(e) => update({ chainId: e.target.value })}
            />
          </div>
          <div>
            <div className="field-label">Gas price (udvpn per gas unit)</div>
            <input
              className="field-input font-mono"
              value={draft.gasPriceUdvpn}
              onChange={(e) => update({ gasPriceUdvpn: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-4">
          <div className="field-label">RPC endpoints (one per line; the first healthy one wins)</div>
          <textarea
            rows={4}
            value={draft.rpcUrls.join('\n')}
            onChange={(e) => update({ rpcUrls: e.target.value.split(/\r?\n/) })}
            className="field-input font-mono text-xs"
          />
        </div>

        <div className="mt-5">
          <div className="section-title mb-2">Pool health</div>
          {chainHealth.length === 0 ? (
            <div className="text-xs text-text-dim">Probing…</div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
              {chainHealth.map((h) => (
                <li key={h.rpcUrl} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${h.reachable ? 'bg-success' : 'bg-danger'}`}
                  />
                  <span className="font-mono text-text">{h.rpcUrl}</span>
                  <div className="flex-1" />
                  {h.reachable ? (
                    <>
                      <span className="text-text-muted">height {h.blockHeight ?? '—'}</span>
                      <span className="text-text-dim">· {h.latencyMs}ms</span>
                    </>
                  ) : (
                    <span className="text-danger truncate max-w-[400px]">{h.error}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card p-6 mt-4">
        <div className="section-title mb-3">Docker</div>
        <p className="text-xs text-text-muted mb-3">
          Leave blank to auto-probe default locations. Override if you use Colima, Podman, or a
          rootless Docker setup.
        </p>
        <div>
          <div className="field-label">Docker socket path</div>
          <input
            value={draft.dockerSocket}
            onChange={(e) => update({ dockerSocket: e.target.value })}
            placeholder="/var/run/docker.sock or //./pipe/docker_engine"
            className="field-input font-mono"
          />
        </div>
      </div>

      <div className="card p-6 mt-4">
        <div className="section-title mb-3">App</div>
        <button
          className="btn-secondary"
          onClick={async () => {
            await saveSettings({ seenOnboarding: false });
            pushToast({ title: 'Onboarding re-armed', body: 'It will show on next launch.', tone: 'info' });
          }}
        >
          <MIcon name="play_circle" size={14} />
          Replay onboarding
        </button>
      </div>
    </div>
  );
}
