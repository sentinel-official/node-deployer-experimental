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
    if (res.ok)
      pushToast({ title: 'Diagnostics exported', body: res.path, tone: 'success' });
    else pushToast({ title: 'Export failed', body: res.error, tone: 'error' });
  };

  const checkUpdates = async () => {
    const s = await window.api.updater.check();
    setUpdater(s);
  };

  const installUpdate = async () => {
    const res = await window.api.updater.install();
    if (!res.ok && res.error)
      pushToast({ title: 'Update install failed', body: res.error, tone: 'error' });
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <PageHeader
        title="Help"
        subtitle="Guides, shortcuts, and diagnostics for running a Sentinel dVPN node."
        right={
          <>
            <UpdaterBadge state={updater} />
            <button
              className="btn btn-secondary"
              onClick={checkUpdates}
              disabled={updater.stage === 'checking'}
            >
              <MIcon name="refresh" size={14} />
              {updater.stage === 'checking' ? 'Checking…' : 'Check updates'}
            </button>
            {updater.stage === 'ready' && (
              <button className="btn btn-primary" onClick={installUpdate}>
                <MIcon name="download_done" size={14} />
                Install v{updater.version}
              </button>
            )}
            <button className="btn btn-secondary" onClick={exportDiagnostics}>
              <MIcon name="download" size={14} />
              Export diagnostics
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0 overflow-auto">
        <HelpCard
          icon="laptop_mac"
          title="Running a local node"
          body="Your machine needs Docker Desktop (macOS/Windows) or Docker Engine (Linux), 2+ GB of free RAM, and an open UDP port (default 7777). The Deploy screen's preflight verifies each."
        />
        <HelpCard
          icon="cloud"
          title="Remote deployment (SSH)"
          body="Paste your VPS IP, SSH username, and key or password. The app SSHs in, installs Docker if missing, builds the sentinel-dvpnx + sentinelhub images, seeds the node's keyring, and starts the container."
        />
        <HelpCard
          icon="vpn_key"
          title="Where are keys kept?"
          body="The app wallet mnemonic is encrypted with your OS keychain (Electron safeStorage). Each deployed node has its own operator mnemonic, shown once during deploy and backed up encrypted inside the app."
        />
        <HelpCard
          icon="restart_alt"
          title="Lost your mnemonic?"
          body="If the app keychain is corrupted or you reinstall on a new machine, you can recover via Wallet Setup → Use Existing Wallet and paste your 12–24-word recovery phrase. The phrase is the only way back, so store it offline. Per-node operator keys are app-only and rebuilt by re-deploying."
        />
        <HelpCard
          icon="price_change"
          title="Updating prices"
          body="Node Details → 'Edit pricing' broadcasts a MsgUpdateNodeDetails. Works if the app has the encrypted backup of the node's mnemonic."
        />
        <HelpCard
          icon="account_balance_wallet"
          title="Withdrawing rewards"
          body="Rewards land in each node's operator balance on-chain. 'Withdraw' on Node Details broadcasts a MsgSend from the node's key without SSH."
        />
        <HelpCard
          icon="keyboard"
          title="Keyboard shortcuts"
          body="⌘R / Ctrl+R refreshes balances + nodes. ⌘, or Ctrl+, opens Settings. Esc closes modals."
        />
        <HelpCard
          icon="bug_report"
          title="Reporting issues"
          body="Export diagnostics (button above) and open an issue on sentinel-official/sentinel-dvpnx or the Sentinel Discord. The zip is sanitized, with no mnemonics or SSH credentials."
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
      ? 'chip chip-success'
      : state.stage === 'error'
        ? 'chip chip-danger'
        : state.stage === 'downloading' || state.stage === 'checking'
          ? 'chip chip-warn'
          : 'chip';
  return <span className={cls}>{label}</span>;
}

function HelpCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="card col-span-12 md:col-span-6 lg:col-span-4">
      <div className="card-body" style={{ padding: '12px 14px' }}>
        <div className="flex items-center gap-2 mb-1.5">
          <MIcon name={icon} size={14} style={{ color: 'var(--accent)' }} />
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </div>
        </div>
        <p
          className="text-[12px] leading-snug"
          style={{ color: 'var(--text-muted)' }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
