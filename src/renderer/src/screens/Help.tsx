import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { UpdaterState } from '../../../shared/updater-types';

export function Help() {
  const { pushToast } = useApp();
  const [updater, setUpdater] = useState<UpdaterState>({ stage: 'idle' });

  useEffect(() => {
    void window.api.updater.status().then(setUpdater);
    const unsub = window.api.updater.onChanged(setUpdater);
    return unsub;
  }, []);

  const exportDiagnostics = async () => {
    const res = await window.api.system.exportDiagnostics();
    if (res.cancelled) return;
    if (res.ok) pushToast({ title: 'Diagnostics exported', body: res.path, tone: 'success' });
    else pushToast({ title: 'Export failed', body: res.error, tone: 'error' });
  };

  const checkUpdates = async () => {
    const s = await window.api.updater.check();
    setUpdater(s);
  };

  const installUpdate = async () => {
    const res = await window.api.updater.install();
    if (!res.ok && res.error) pushToast({ title: 'Update install failed', body: res.error, tone: 'error' });
  };

  return (
    <div>
      <PageHeader
        title="Help"
        subtitle="Guides, shortcuts, and diagnostics for running a Sentinel dVPN node from this app."
        right={
          <button className="btn-secondary" onClick={exportDiagnostics}>
            <MIcon name="download" size={14} />
            Export diagnostics
          </button>
        }
      />

      <div className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <MIcon name="system_update" size={16} className="text-accent" />
          <div className="font-semibold text-text">App updates</div>
          <div className="flex-1" />
          <UpdaterBadge state={updater} />
        </div>
        <p className="text-sm text-text-muted mb-3">
          The app checks for new releases on launch and can download them in the background.
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={checkUpdates} disabled={updater.stage === 'checking'}>
            <MIcon name="refresh" size={14} />
            {updater.stage === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {updater.stage === 'ready' && (
            <button className="btn-primary" onClick={installUpdate}>
              <MIcon name="download_done" size={14} />
              Install v{updater.version} now
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HelpCard
          icon="laptop_mac"
          title="Running a local node"
          body="Your machine needs Docker Desktop (macOS/Windows) or Docker Engine (Linux), 2+ GB of free RAM, and an open UDP port (default 7777). The Deploy screen's preflight verifies each."
        />
        <HelpCard
          icon="cloud"
          title="Remote deployment (SSH)"
          body="Paste your VPS IP, SSH username, and key or password. The app SSHs in, installs Docker if missing, builds the sentinel-dvpnx + sentinelhub images, seeds the node's keyring with an app-generated mnemonic, and starts the container."
        />
        <HelpCard
          icon="vpn_key"
          title="Where are keys kept?"
          body="The app wallet mnemonic is encrypted with your OS keychain (Electron safeStorage). Each deployed node has its own operator mnemonic shown to you exactly once during deploy, and — by default — backed up encrypted inside the app so node-level withdrawals and pricing updates work without SSH."
        />
        <HelpCard
          icon="price_change"
          title="Updating prices"
          body="Node Details → click 'Pricing' to broadcast a MsgUpdateNodeDetails. Only works if the app has the encrypted backup of the node's mnemonic (kept by default)."
        />
        <HelpCard
          icon="account_balance_wallet"
          title="Withdrawing node rewards"
          body="Rewards land directly in each node's operator balance on-chain. Click 'Withdraw to app wallet' on Node Details to broadcast a MsgSend from the node's key (via the encrypted backup) without needing SSH."
        />
        <HelpCard
          icon="keyboard"
          title="Keyboard shortcuts"
          body="⌘R / Ctrl+R refreshes balances + nodes. ⌘, or Ctrl+, opens Settings. Esc closes modals."
        />
        <HelpCard
          icon="bug_report"
          title="Reporting issues"
          body="Export diagnostics (button above) and open an issue on sentinel-official/sentinel-dvpnx or the Sentinel Discord. The zip contains sanitized state + events + logs; mnemonics and SSH credentials are never included."
        />
      </div>
    </div>
  );
}

function UpdaterBadge({ state }: { state: UpdaterState }) {
  const label =
    state.stage === 'idle'
      ? 'Idle'
      : state.stage === 'checking'
      ? 'Checking…'
      : state.stage === 'downloading'
      ? `Downloading ${state.percent ?? 0}%`
      : state.stage === 'ready'
      ? `v${state.version} ready`
      : state.stage === 'up-to-date'
      ? 'Up to date'
      : state.stage === 'error'
      ? 'Error'
      : state.stage;
  const cls =
    state.stage === 'ready'
      ? 'chip-ok'
      : state.stage === 'error'
      ? 'chip-err'
      : state.stage === 'downloading' || state.stage === 'checking'
      ? 'chip-warn'
      : 'chip-muted';
  return <span className={cls}>{label}</span>;
}

function HelpCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1.5">
        <MIcon name={icon} size={16} className="text-accent" />
        <div className="font-semibold text-text">{title}</div>
      </div>
      <p className="text-sm text-text-muted leading-relaxed">{body}</p>
    </div>
  );
}
