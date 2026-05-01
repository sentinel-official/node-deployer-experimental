import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { QRCode } from '../components/QRCode';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, relativeTime, shortAddr } from '../lib/format';
import { KIND_ICON } from '../lib/events';
import type { AppEvent, SendTxResult } from '../../../shared/types';

export function Wallet() {
  const { wallet, nodes, events, refreshWallet, refreshNodes, confirm, pushToast, logoutWallet, navigate } =
    useApp();
  const [copied, setCopied] = useState(false);
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendTxResult | null>(null);
  const [walletSel, setWalletSel] = useState<string>('app');

  const selectedNode = walletSel === 'app' ? null : nodes.find((n) => n.id === walletSel) ?? null;
  const viewingOperator = !!selectedNode;
  const viewAddress = viewingOperator ? selectedNode!.operatorAddress : wallet?.address ?? null;
  const viewBalance = viewingOperator ? selectedNode!.balanceDVPN : wallet?.balanceDVPN ?? 0;
  const viewLabel = viewingOperator ? `${selectedNode!.moniker} operator` : 'App wallet';

  const walletHistory: AppEvent[] = useMemo(
    () =>
      events.filter((e) =>
        ['withdraw-sent', 'withdraw-failed', 'wallet-created', 'wallet-restored'].includes(
          e.kind,
        ),
      ),
    [events],
  );

  const gasHint = 0.002;
  const amountNum = Number(amount) || 0;
  const trimmedAddr = toAddr.trim();
  const balance = wallet?.balanceDVPN ?? 0;
  const addrError =
    trimmedAddr.length === 0
      ? null
      : !trimmedAddr.startsWith('sent1')
        ? 'Sentinel addresses must begin with "sent1".'
        : !/^sent1[0-9a-z]{38,58}$/.test(trimmedAddr)
          ? 'Address is malformed. Verify the bech32 string and try again.'
          : trimmedAddr === wallet?.address
            ? 'Recipient cannot be your own wallet address.'
            : null;
  const amountError =
    amount.trim().length === 0
      ? null
      : !Number.isFinite(amountNum) || amountNum <= 0
        ? 'Amount must be greater than zero.'
        : amountNum + gasHint > balance
          ? `Not enough P2P. You need ${fmtDVPN(amountNum + gasHint, 6)} $P2P in total — the amount you want to send plus a small network fee.`
          : null;
  const canSend =
    !busy &&
    /^sent1[0-9a-z]{38,58}$/.test(trimmedAddr) &&
    trimmedAddr !== wallet?.address &&
    amountNum > 0 &&
    amountNum + gasHint <= balance;

  const copy = async () => {
    if (!viewAddress) return;
    await navigator.clipboard.writeText(viewAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const send = async () => {
    const ok = await confirm({
      title: 'Send $P2P',
      body: `Send ${amountNum} $P2P to ${shortAddr(toAddr.trim(), 10, 6)}? A signed transaction will be broadcast to the Sentinel chain.`,
      tone: 'info',
      confirmLabel: 'Broadcast',
    });
    if (!ok) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await window.api.wallet.send({
        to: toAddr.trim(),
        amountDVPN: amountNum,
        memo: memo || undefined,
      });
      setResult(res);
      if (res.ok) {
        pushToast({
          title: 'Transaction broadcast',
          body: `Transaction hash: ${res.txHash?.slice(0, 16)}…`,
          tone: 'success',
        });
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
    <div className="flex flex-col h-full min-h-0 gap-3">
      <PageHeader
        title="Wallet"
        subtitle="Send $P2P, monitor transactions, and consolidate rewards from your nodes."
        right={
          <>
            <select
              className="field-input"
              value={walletSel}
              onChange={(e) => setWalletSel(e.target.value)}
              style={{ minWidth: 180, fontSize: 12.5, padding: '6px 8px' }}
              title="Switch wallet view"
            >
              <option value="app">App wallet</option>
              {nodes.length > 0 && <option disabled>──────────</option>}
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.moniker} · {fmtDVPN(n.balanceDVPN)} $P2P
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={() => void refreshWallet()}>
              <MIcon name="refresh" size={14} />
              Refresh balances
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Log out of this wallet?',
                  body:
                    'The encrypted recovery phrase will be removed from this device. You can only sign back in if you have a copy of the recovery phrase. Running nodes are not affected.',
                  tone: 'danger',
                  confirmLabel: 'Log out',
                  requireType: 'LOGOUT',
                });
                if (!ok) return;
                await logoutWallet();
                pushToast({
                  title: 'Logged out',
                  body: 'The encrypted wallet vault has been cleared from this device.',
                  tone: 'success',
                });
              }}
            >
              <MIcon name="logout" size={14} />
              Log out
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-3">
        <StatCard
          className="col-span-12 md:col-span-4"
          label={viewLabel}
          value={`${fmtDVPN(viewBalance)} $P2P`}
          caption={viewAddress ? shortAddr(viewAddress, 10, 6) : '—'}
          accent="accent"
        />
        <StatCard
          className="col-span-12 md:col-span-4"
          label="Node operators"
          value={`${fmtDVPN(totalNodeBalance)} $P2P`}
          caption={`${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
          accent="accent"
        />
        <StatCard
          className="col-span-12 md:col-span-4"
          label="Wallet events"
          value={walletHistory.length.toString()}
          caption="all time"
        />
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* DEPOSIT */}
        <div className="card col-span-12 lg:col-span-5">
          <div className="card-header">
            <div className="card-title flex items-center gap-2">
              <MIcon name="south" size={14} style={{ color: 'var(--accent)' }} />
              Receive $P2P
            </div>
          </div>
          <div className="card-body flex flex-col gap-3">
            <div
              className="flex flex-col items-center p-3"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {viewAddress ? (
                <>
                  <QRCode value={viewAddress} size={112} />
                  <div
                    className="mt-3 mono-inline text-[10px] break-all text-center"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {viewAddress}
                  </div>
                  <button className="btn btn-ghost mt-1 text-xs" onClick={copy}>
                    <MIcon name="content_copy" size={12} /> {copied ? 'Copied' : 'Copy address'}
                  </button>
                </>
              ) : (
                <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  Wallet has not been set up yet.
                </div>
              )}
            </div>
            <div
              className="text-[11px] leading-relaxed flex items-start gap-2"
              style={{ color: 'var(--text-dim)' }}
            >
              <MIcon name="lock" size={12} style={{ marginTop: 2 }} />
              Recovery phrase is encrypted by the OS keychain and never leaves this device.
            </div>
          </div>
        </div>

        {/* SEND */}
        <div className="card col-span-12 lg:col-span-7">
          <div className="card-header">
            <div className="card-title flex items-center gap-2">
              <MIcon name="north_east" size={14} style={{ color: 'var(--green)' }} />
              {viewingOperator ? 'Operator wallet' : 'Send $P2P'}
            </div>
          </div>
          {viewingOperator ? (
            <div className="card-body flex flex-col gap-2.5">
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                This is a read-only view of the on-chain balance for the{' '}
                <b style={{ color: 'var(--text)' }}>{selectedNode!.moniker}</b> operator
                address. Operator keys are held by sentinel-dvpnx on the host running the
                node — not by this app — so transfers can't be signed here.
              </div>
              <div
                className="px-3 py-2.5 text-xs flex flex-col gap-1"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-muted)',
                }}
              >
                <div className="flex justify-between">
                  <span>Operator</span>
                  <span className="mono-inline" style={{ color: 'var(--text)' }}>
                    {shortAddr(selectedNode!.operatorAddress, 12, 8)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Balance</span>
                  <span style={{ color: 'var(--text)' }}>
                    {fmtDVPN(selectedNode!.balanceDVPN)} $P2P
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Status</span>
                  <span style={{ color: 'var(--text)' }}>{selectedNode!.status}</span>
                </div>
              </div>
              <button
                className="btn btn-primary w-full"
                onClick={() => navigate({ name: 'node-details', id: selectedNode!.id })}
              >
                <MIcon name="open_in_new" size={14} />
                Open node · withdraw rewards
              </button>
            </div>
          ) : (
          <div className="card-body flex flex-col gap-2.5">
            <div>
              <div className="field-label">Recipient address</div>
              <input
                value={toAddr}
                onChange={(e) => setToAddr(e.target.value)}
                placeholder="sent1…"
                className="field-input mono-inline text-xs"
                aria-invalid={!!addrError}
              />
              {addrError && (
                <div
                  className="text-[11px] mt-1"
                  style={{ color: 'var(--red)' }}
                >
                  {addrError}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="field-label">Amount ($P2P)</div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  step="0.000001"
                  min="0"
                  placeholder="0.00"
                  className="field-input"
                  aria-invalid={!!amountError}
                />
                {amountError && (
                  <div
                    className="text-[11px] mt-1"
                    style={{ color: 'var(--red)' }}
                  >
                    {amountError}
                  </div>
                )}
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

            <div
              className="px-3 py-2.5 text-xs flex flex-col gap-1"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                className="flex items-center justify-between"
                style={{ color: 'var(--text-muted)' }}
              >
                <span>Estimated gas</span>
                <span>~{gasHint} $P2P</span>
              </div>
              <div
                className="flex items-center justify-between"
                style={{ color: 'var(--text)' }}
              >
                <span className="font-medium">Source balance</span>
                <span className="font-semibold">
                  {fmtDVPN(wallet?.balanceDVPN ?? 0)} $P2P
                </span>
              </div>
            </div>

            {result && (
              <div
                className={`callout ${result.ok ? 'callout-success' : 'callout-danger'}`}
              >
                {result.ok ? (
                  <>
                    Sent · height {result.height} · tx{' '}
                    <span className="mono-inline">{result.txHash?.slice(0, 20)}…</span>
                  </>
                ) : (
                  <>
                    {result.errorCode ? `[${result.errorCode}] ` : ''}
                    {result.error}
                  </>
                )}
              </div>
            )}

            <button
              className="btn btn-primary w-full"
              onClick={send}
              disabled={!canSend}
            >
              {busy ? 'Broadcasting…' : 'Send transaction'}
              <MIcon name="arrow_forward" size={14} />
            </button>
          </div>
          )}
        </div>
      </div>

      <div className="card flex flex-col">
        <div className="card-header">
          <div className="card-title">Wallet activity</div>
          <span className="mono-tag">{walletHistory.length} events</span>
        </div>
        {walletHistory.length === 0 ? (
          <div className="card-body">
            <div className="empty-state">
              <MIcon name="inbox" size={28} />
              <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No wallet transactions recorded yet.
              </div>
            </div>
          </div>
        ) : (
          <div>
            {walletHistory.slice(0, 100).map((e, idx) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 px-[22px] py-3"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <div
                    className="h-8 w-8 rounded-full grid place-items-center flex-shrink-0"
                    style={{
                      background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    <Icon size={16} weight="regular" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: 'var(--text)' }}
                      title={e.title}
                    >
                      {e.title}
                    </div>
                    <div
                      className="text-[11px] truncate mono-inline"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {e.subtitle || (e.txHash ? `tx ${e.txHash.slice(0, 20)}…` : '')}
                    </div>
                  </div>
                  {e.amountDVPN !== undefined && (
                    <div
                      className="text-sm font-semibold"
                      style={{
                        color:
                          e.amountDVPN > 0 ? 'var(--green)' : 'var(--text)',
                      }}
                    >
                      {e.amountDVPN > 0 ? '+' : ''}
                      {fmtDVPN(e.amountDVPN)} $P2P
                    </div>
                  )}
                  <div
                    className="text-[10px] whitespace-nowrap"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {relativeTime(e.timestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
