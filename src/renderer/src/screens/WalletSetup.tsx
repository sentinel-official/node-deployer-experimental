import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { QRCode } from '../components/QRCode';
import { useApp } from '../store/app';
import { fmtDVPN, shortAddr } from '../lib/format';

/**
 * First-launch flow.
 *
 *   1. Choose — create or restore.
 *   2. For create, display the 24-word mnemonic exactly once; user must
 *      tick "I've backed this up" before proceeding.
 *   3. Funding status panel — live on-chain balance + QR for the sent1…
 *      address, refresh button re-queries the RPC.
 */
export function WalletSetup() {
  const { wallet, setWallet, refreshWallet, navigate, pushToast } = useApp();
  const [mode, setMode] = useState<'choose' | 'restore' | 'reveal' | 'funded'>(
    wallet?.address ? 'funded' : 'choose',
  );
  const [mnemonic, setMnemonic] = useState('');
  const [freshMnemonic, setFreshMnemonic] = useState<string | null>(null);
  const [confirmedBackup, setConfirmedBackup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await window.api.wallet.create();
      setWallet(res.wallet);
      setFreshMnemonic(res.mnemonic);
      setMode('reveal');
      pushToast({ title: 'Wallet created', body: 'Write down the mnemonic next.', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setError(null);
    setBusy(true);
    try {
      const w = await window.api.wallet.restore(mnemonic);
      setWallet(w);
      setMode('funded');
      pushToast({ title: 'Wallet restored', body: shortAddr(w.address, 10, 6), tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWallet();
    } finally {
      setRefreshing(false);
    }
  };

  const copyAddress = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div>
      <PageHeader
        title="Wallet Setup"
        subtitle="Configure your digital vault to participate in the Sentinel dVPN network. Your mnemonic is encrypted by your OS keychain and never leaves this device."
      />

      {mode === 'choose' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChoiceCard
            icon="shield"
            title="Create New Wallet"
            desc="Generate a fresh BIP-39 mnemonic with 24 words. It is shown exactly once — store it safely."
            cta={busy ? 'Working…' : 'Initialize Secure Vault'}
            ctaIcon="add"
            busy={busy}
            onClick={doCreate}
          />
          <ChoiceCard
            icon="key"
            title="Use Existing Wallet"
            desc="Import an existing Sentinel / Cosmos account using its 12, 15, 18, 21 or 24-word mnemonic."
            cta="Restore via Seed Phrase"
            ctaIcon="key_vertical"
            busy={false}
            onClick={() => setMode('restore')}
            secondary
          />
          {error && <div className="md:col-span-2 chip-err">{error}</div>}
        </div>
      )}

      {mode === 'restore' && (
        <div className="card p-6 max-w-2xl">
          <div className="text-sm font-semibold mb-2">Restore from mnemonic</div>
          <p className="text-xs text-text-muted mb-4">
            Paste your recovery phrase. It is encrypted with your OS keychain as soon as it
            arrives; the plaintext never touches disk.
          </p>
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={4}
            placeholder="tribe solution puppy eager nasty lonely …"
            className="field-input font-mono"
          />
          {error && <div className="mt-3 text-xs text-danger">{error}</div>}
          <div className="mt-4 flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setMode('choose')} disabled={busy}>
              Back
            </button>
            <button className="btn-primary" onClick={doRestore} disabled={busy || !mnemonic.trim()}>
              {busy ? 'Restoring…' : 'Restore wallet'}
              <MIcon name="arrow_forward" size={14} />
            </button>
          </div>
        </div>
      )}

      {mode === 'reveal' && freshMnemonic && (
        <div className="card-elev p-6 border-warning/40 max-w-2xl">
          <div className="flex items-center gap-2 text-warning text-xs uppercase tracking-wider font-semibold mb-2">
            <MIcon name="warning" size={16} />
            Write down your mnemonic — shown exactly once
          </div>
          <div className="font-mono text-sm text-text bg-bg-input rounded-lg p-4 border border-border leading-relaxed break-words">
            {freshMnemonic}
          </div>
          <button
            className="mt-3 btn-ghost text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(freshMnemonic);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            <MIcon name="content_copy" size={14} />
            {copied ? 'Copied' : 'Copy mnemonic'}
          </button>

          <label className="mt-6 flex items-center gap-2 text-sm text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmedBackup}
              onChange={(e) => setConfirmedBackup(e.target.checked)}
              className="h-4 w-4"
            />
            I have safely stored my 24-word recovery phrase. If I lose it, the wallet can't be recovered.
          </label>

          <div className="mt-4 flex justify-end">
            <button
              className="btn-primary"
              disabled={!confirmedBackup}
              onClick={() => {
                setFreshMnemonic(null);
                setMode('funded');
              }}
            >
              Continue
              <MIcon name="arrow_forward" size={14} />
            </button>
          </div>
        </div>
      )}

      {mode === 'funded' && wallet?.address && (
        <>
          <div className="section-title mb-3">Funding status</div>
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div className="text-xs text-text-muted uppercase tracking-wider">
                Sentinel mainnet deposit address
              </div>
              <span className="chip-ok">
                <MIcon name="verified" size={12} />
                Ready
              </span>
            </div>
            <div className="mt-3 flex items-center gap-4">
              <QRCode value={wallet.address} size={96} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-text break-all">{wallet.address}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim">
                  <span>{shortAddr(wallet.address, 10, 8)}</span>
                  <button
                    onClick={copyAddress}
                    className="text-accent hover:text-accent-strong flex items-center gap-1"
                  >
                    <MIcon name="content_copy" size={12} /> {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] text-text-dim uppercase tracking-wider">Current balance</div>
                <div className="mt-1 text-2xl font-semibold">
                  {fmtDVPN(wallet.balanceDVPN)}{' '}
                  <span className="text-text-muted text-lg">$P2P</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-dim uppercase tracking-wider">Recommended for deploy</div>
                <div className="mt-1 text-2xl font-semibold">
                  10.00 <span className="text-text-muted text-lg">$P2P</span>
                </div>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-border bg-bg-input p-3 text-xs text-text-muted leading-relaxed">
              <b className="text-text">Why this matters?</b> Your app wallet holds gas for
              transactions and receives rewards withdrawn from your nodes. Nodes have their
              own operator keys generated during `sentinel-dvpnx init`.
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <button className="btn-ghost" onClick={() => setMode('choose')}>
              <MIcon name="arrow_back" size={14} />
              Back to selection
            </button>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={doRefresh} disabled={refreshing}>
                <MIcon name="refresh" size={14} />
                {refreshing ? 'Querying chain…' : 'Refresh balance'}
              </button>
              <button className="btn-primary" onClick={() => navigate({ name: 'overview' })}>
                Proceed to dashboard
                <MIcon name="arrow_forward" size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  desc,
  cta,
  ctaIcon,
  onClick,
  busy,
  secondary,
}: {
  icon: string;
  title: string;
  desc: string;
  cta: string;
  ctaIcon: string;
  onClick: () => void;
  busy: boolean;
  secondary?: boolean;
}) {
  return (
    <div className="card p-6 flex flex-col">
      <div className="h-11 w-11 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center text-accent">
        <MIcon name={icon} size={22} />
      </div>
      <div className="mt-4 text-lg font-semibold text-text">{title}</div>
      <p className="mt-1.5 text-sm text-text-muted flex-1">{desc}</p>
      <button
        onClick={onClick}
        disabled={busy}
        className={secondary ? 'btn-secondary mt-5 w-full' : 'btn-primary mt-5 w-full'}
      >
        <MIcon name={ctaIcon} size={14} />
        {cta}
      </button>
    </div>
  );
}
