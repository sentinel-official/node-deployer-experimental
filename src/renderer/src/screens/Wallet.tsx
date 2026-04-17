import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { QRCode } from '../components/QRCode';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, relativeTime, shortAddr } from '../lib/format';
import { KIND_ICON_M, KIND_TONE } from '../lib/events';
import type { AppEvent, SendTxResult } from '../../../shared/types';

export function Wallet() {
  const { wallet, nodes, events, refreshWallet, refreshNodes, confirm, pushToast } = useApp();
  const [copied, setCopied] = useState(false);
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendTxResult | null>(null);

  const walletHistory: AppEvent[] = useMemo(
    () => events.filter((e) => ['withdraw-sent', 'withdraw-failed', 'wallet-created', 'wallet-restored'].includes(e.kind)),
    [events],
  );

  const gasHint = 0.002;
  const amountNum = Number(amount) || 0;
  const canSend =
    !busy &&
    /^sent1[0-9a-z]{38,58}$/.test(toAddr.trim()) &&
    amountNum > 0 &&
    amountNum + gasHint <= (wallet?.balanceDVPN ?? 0);

  const copy = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const send = async () => {
    const ok = await confirm({
      title: 'Send $P2P',
      body: `Send ${amountNum} $P2P to ${shortAddr(toAddr.trim(), 10, 6)}? This broadcasts a signed transaction to the Sentinel chain.`,
      tone: 'info',
      confirmLabel: 'Broadcast',
    });
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await window.api.wallet.send({ to: toAddr.trim(), amountDVPN: amountNum, memo: memo || undefined });
      setResult(res);
      if (res.ok) {
        pushToast({ title: 'Broadcast confirmed', body: `tx ${res.txHash?.slice(0, 16)}…`, tone: 'success' });
        setAmount('');
        setMemo('');
        await refreshWallet();
        await refreshNodes();
      } else {
        pushToast({ title: 'Broadcast failed', body: res.error, tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const totalNodeBalance = nodes.reduce((sum, n) => sum + n.balanceDVPN, 0);

  return (
    <div>
      <PageHeader
        title="Wallet"
        subtitle="Send $P2P, track transactions, and collect rewards from your nodes."
        right={
          <button className="btn-secondary" onClick={() => void refreshWallet()}>
            <MIcon name="refresh" size={14} />
            Refresh balances
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="App wallet"
          value={`${fmtDVPN(wallet?.balanceDVPN ?? 0)} $P2P`}
          caption={wallet?.address ? shortAddr(wallet.address, 10, 6) : '—'}
          accent="accent"
        />
        <StatCard
          label="Node operators"
          value={`${fmtDVPN(totalNodeBalance)} $P2P`}
          caption={`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
          accent="success"
        />
        <StatCard
          label="Wallet events"
          value={walletHistory.length.toString()}
          caption="all time"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* DEPOSIT */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <MIcon name="south" size={16} className="text-accent" />
            Receive $P2P
          </div>
          <p className="text-xs text-text-muted mb-4">
            Scan the QR or copy the address to send $P2P from your primary wallet or an exchange.
          </p>
          <div className="rounded-xl bg-bg-input border border-border p-6 flex flex-col items-center">
            {wallet?.address ? (
              <>
                <QRCode value={wallet.address} size={148} />
                <div className="mt-4 font-mono text-[11px] text-text-muted break-all text-center">
                  {wallet.address}
                </div>
                <button className="btn-ghost mt-2 text-xs" onClick={copy}>
                  <MIcon name="content_copy" size={12} /> {copied ? 'Copied' : 'Copy address'}
                </button>
              </>
            ) : (
              <div className="text-xs text-text-dim">Wallet not set up yet.</div>
            )}
          </div>
          <div className="mt-3 text-[11px] text-text-dim leading-relaxed flex items-start gap-2">
            <MIcon name="lock" size={12} className="mt-0.5" />
            Mnemonic encrypted with your OS keychain. Never leaves this device.
          </div>
        </div>

        {/* SEND */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
            <MIcon name="north_east" size={16} className="text-success" />
            Send $P2P
          </div>
          <p className="text-xs text-text-muted mb-4">
            Constructs a MsgSend and broadcasts via the healthy RPC. Gas is auto-estimated, with
            a conservative fallback.
          </p>

          <div className="field-label">Recipient address</div>
          <input
            value={toAddr}
            onChange={(e) => setToAddr(e.target.value)}
            placeholder="sent1…"
            className="field-input font-mono text-xs"
          />

          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="field-label">Amount ($P2P)</div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                step="0.000001"
                placeholder="0.00"
                className="field-input"
              />
            </div>
            <div>
              <div className="field-label">Memo (optional)</div>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="field-input"
                placeholder=""
              />
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-bg-input p-3 text-xs">
            <div className="flex items-center justify-between text-text-muted">
              <span>Estimated gas</span>
              <span>~{gasHint} $P2P</span>
            </div>
            <div className="flex items-center justify-between mt-1 text-text">
              <span className="font-medium">Source balance</span>
              <span className="font-semibold">{fmtDVPN(wallet?.balanceDVPN ?? 0)} $P2P</span>
            </div>
          </div>

          {result && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                result.ok
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
            >
              {result.ok ? (
                <>
                  Sent · height {result.height} · tx{' '}
                  <span className="font-mono">{result.txHash?.slice(0, 20)}…</span>
                </>
              ) : (
                <>
                  {result.errorCode ? `[${result.errorCode}] ` : ''}
                  {result.error}
                </>
              )}
            </div>
          )}

          <button className="btn-primary w-full mt-5" onClick={send} disabled={!canSend}>
            {busy ? 'Broadcasting…' : 'Send transaction'}
            <MIcon name="arrow_forward" size={14} />
          </button>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title">Wallet activity</div>
          <span className="text-xs text-text-dim">{walletHistory.length} events</span>
        </div>
        {walletHistory.length === 0 ? (
          <div className="card p-8 text-center text-text-muted text-sm">No wallet transactions yet.</div>
        ) : (
          <div className="card divide-y divide-border">
            {walletHistory.map((e) => {
              const tone = KIND_TONE[e.kind];
              const toneCls =
                tone === 'ok'
                  ? 'bg-success/15 text-success'
                  : tone === 'err'
                  ? 'bg-danger/15 text-danger'
                  : tone === 'warn'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-accent/15 text-accent';
              return (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`h-8 w-8 rounded-full grid place-items-center ${toneCls}`}>
                    <MIcon name={KIND_ICON_M[e.kind]} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text">{e.title}</div>
                    <div className="text-[11px] text-text-dim truncate">
                      {e.subtitle || (e.txHash ? `tx ${e.txHash.slice(0, 20)}…` : '')}
                    </div>
                  </div>
                  {e.amountDVPN !== undefined && (
                    <div className={`text-sm font-semibold ${e.amountDVPN > 0 ? 'text-success' : 'text-text'}`}>
                      {e.amountDVPN > 0 ? '+' : ''}
                      {fmtDVPN(e.amountDVPN)} $P2P
                    </div>
                  )}
                  <div className="text-[10px] text-text-dim whitespace-nowrap">{relativeTime(e.timestamp)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
