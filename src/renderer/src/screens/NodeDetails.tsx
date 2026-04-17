import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { BarChart } from '../components/BarChart';
import { QRCode } from '../components/QRCode';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, shortAddr } from '../lib/format';
import type { DeployedNode, MetricsSample, NodeLiveStatus } from '../../../shared/types';

interface Props {
  id: string;
}

export function NodeDetails({ id }: Props) {
  const { nodes, wallet, navigate, refreshStatus, liveStatuses, refreshNodes, pushToast, confirm } = useApp();
  const [node, setNode] = useState<DeployedNode | null>(null);
  const [status, setStatus] = useState<NodeLiveStatus | null>(null);
  const [history, setHistory] = useState<MetricsSample[]>([]);
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [busy, setBusy] = useState<'' | 'start' | 'restart' | 'stop' | 'remove' | 'withdraw' | 'pricing'>('');
  const [editingPricing, setEditingPricing] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  useEffect(() => setNode(nodes.find((n) => n.id === id) ?? null), [id, nodes]);

  // Live status + history polling
  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const s = await refreshStatus(id);
      if (!mounted) return;
      setStatus(s);
      const h = await window.api.nodes.history(id, range);
      if (!mounted) return;
      setHistory(h);
    };
    void tick();
    const iv = setInterval(tick, 15_000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
    // `range` intentionally in deps so switching windows re-fetches.
  }, [id, refreshStatus, range]);

  useEffect(() => setStatus(liveStatuses[id] ?? null), [liveStatuses, id]);

  const bars = useMemo(() => {
    // Peer count per sample; fill gaps with 0
    if (history.length === 0) return [];
    return history.map((s) => s.peers);
  }, [history]);

  const chartLabels = useMemo(() => {
    if (history.length < 2) return undefined;
    const first = new Date(history[0].ts);
    const last = new Date(history[history.length - 1].ts);
    const fmt = (d: Date) =>
      range === '1h' || range === '24h'
        ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return [fmt(first), fmt(last)];
  }, [history, range]);

  if (!node) {
    return (
      <div className="card p-10 text-center text-text-muted">
        <MIcon name="dns" size={40} className="text-text-dim mx-auto" />
        <div className="mt-3">Node not found — it may have been removed.</div>
        <button className="btn-secondary mt-4" onClick={() => navigate({ name: 'nodes' })}>
          Back to nodes
        </button>
      </div>
    );
  }

  const onStart = async () => {
    setBusy('start');
    try {
      await window.api.nodes.start(id);
      await refreshNodes();
      pushToast({ title: `Starting ${node.moniker}`, tone: 'info' });
    } catch (e) {
      pushToast({ title: 'Start failed', body: (e as Error).message, tone: 'error' });
    } finally {
      setBusy('');
    }
  };
  const onRestart = async () => {
    setBusy('restart');
    try {
      await window.api.nodes.restart(id);
      await refreshNodes();
      pushToast({ title: `Restarted ${node.moniker}`, tone: 'success' });
    } catch (e) {
      pushToast({ title: 'Restart failed', body: (e as Error).message, tone: 'error' });
    } finally {
      setBusy('');
    }
  };
  const onStop = async () => {
    const ok = await confirm({
      title: `Stop ${node.moniker}?`,
      body: 'The node will stop serving traffic and not earn rewards until you start it again.',
      tone: 'warning',
      confirmLabel: 'Stop node',
    });
    if (!ok) return;
    setBusy('stop');
    try {
      await window.api.nodes.stop(id);
      await refreshNodes();
      pushToast({ title: `Stopped ${node.moniker}`, tone: 'info' });
    } finally {
      setBusy('');
    }
  };
  const onRemove = async () => {
    const ok = await confirm({
      title: `Remove ${node.moniker}?`,
      body: 'The container and its local data directory will be deleted. The on-chain operator key and earned rewards are NOT deleted by this action — withdraw rewards first if you want them.',
      tone: 'danger',
      confirmLabel: 'Permanently remove',
      requireType: node.moniker,
    });
    if (!ok) return;
    setBusy('remove');
    try {
      await window.api.nodes.remove(id);
      pushToast({ title: `Removed ${node.moniker}`, tone: 'info' });
      navigate({ name: 'nodes' });
    } finally {
      setBusy('');
    }
  };

  const openWithdraw = () => {
    if (!wallet?.address) {
      pushToast({ title: 'App wallet not set up', tone: 'error' });
      return;
    }
    if (!(node.balanceDVPN > 0.001)) {
      pushToast({ title: 'Nothing to withdraw', body: 'Node balance is effectively zero.', tone: 'warn' });
      return;
    }
    setWithdrawOpen(true);
  };

  const doWithdraw = async (amount: number, to: string) => {
    setBusy('withdraw');
    try {
      const res = await window.api.nodes.withdraw({ nodeId: id, to, amountDVPN: amount });
      if (res.ok) {
        pushToast({
          title: 'Withdrawal broadcast',
          body: `tx ${res.txHash?.slice(0, 16)}…`,
          tone: 'success',
        });
        await refreshNodes();
        setWithdrawOpen(false);
      } else {
        pushToast({ title: 'Withdrawal failed', body: res.error, tone: 'error' });
      }
    } finally {
      setBusy('');
    }
  };

  const uptime = formatDuration(status?.uptimeMs ?? 0);

  return (
    <div>
      <PageHeader
        breadcrumb={
          <div className="flex items-center gap-1.5">
            <button className="hover:text-text" onClick={() => navigate({ name: 'nodes' })}>
              Nodes
            </button>
            <MIcon name="chevron_right" size={12} />
            <span className="text-text-muted">{node.moniker}</span>
          </div>
        }
        title="Node details"
        right={
          <>
            <button className="btn-secondary" onClick={() => void refreshStatus(id)}>
              <MIcon name="refresh" size={14} />
              Refresh
            </button>
            {node.status === 'offline' ? (
              <button className="btn-secondary" onClick={onStart} disabled={!!busy}>
                <MIcon name="play_arrow" size={14} />
                {busy === 'start' ? 'Starting…' : 'Start'}
              </button>
            ) : (
              <button className="btn-secondary" onClick={onRestart} disabled={!!busy}>
                <MIcon name="restart_alt" size={14} />
                {busy === 'restart' ? 'Restarting…' : 'Restart'}
              </button>
            )}
            <button
              className="btn-secondary text-danger border-danger/30"
              onClick={onStop}
              disabled={!!busy || node.status === 'offline'}
            >
              <MIcon name="stop" size={14} />
              {busy === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        {/* Balance + withdraw */}
        <div className="col-span-12 lg:col-span-4 card p-6 bg-gradient-to-br from-accent/20 to-bg-card">
          <div className="text-[11px] uppercase tracking-wider text-accent font-semibold">
            Node operator balance
          </div>
          <div className="mt-1 text-3xl font-semibold">
            {fmtDVPN(node.balanceDVPN)}{' '}
            <span className="text-lg text-text-muted">$P2P</span>
          </div>
          <div className="mt-1 text-[11px] text-text-dim font-mono break-all">
            {node.operatorAddress || '(awaiting init)'}
          </div>
          <button
            className="btn-primary w-full mt-5"
            onClick={openWithdraw}
            disabled={!!busy || node.balanceDVPN < 0.001}
          >
            <MIcon name="north_east" size={14} />
            {busy === 'withdraw' ? 'Broadcasting…' : 'Withdraw to app wallet'}
          </button>
          <div className="mt-2 text-[10px] text-text-dim">
            Executes <span className="font-mono">sentinel-dvpnx tx bank send</span> inside the node
            container.
          </div>
        </div>

        {/* Live stats */}
        <div className="col-span-12 lg:col-span-8 grid grid-cols-4 gap-4">
          <MiniStat
            label="Chain status"
            value={status?.reachable ? formatChainStatus(status.chainStatus) : 'Not registered'}
            accent={status?.reachable}
          />
          <MiniStat
            label="Active sessions"
            value={status?.reachable ? String(status.sessions) : '—'}
          />
          <MiniStat
            label="Traffic served"
            value={status?.reachable ? formatBytes(status.bytesIn + status.bytesOut) : '—'}
          />
          <MiniStat label="Uptime" value={uptime} />
        </div>

        {/* Chart */}
        <div className="col-span-12 lg:col-span-8 card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title">Peer count history</div>
            <div className="flex gap-1 text-[10px]">
              {(['1h', '24h', '7d'] as const).map((w) => (
                <button
                  key={w}
                  className={`px-2 py-0.5 rounded ${
                    w === range
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'text-text-dim border border-border hover:text-text'
                  }`}
                  onClick={() => setRange(w)}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          {history.length === 0 ? (
            <div className="h-[180px] grid place-items-center text-text-dim text-sm">
              {status?.error
                ? status.error
                : 'Waiting for the first sample — the poller runs every 60 seconds.'}
            </div>
          ) : (
            <BarChart data={bars} height={180} labels={chartLabels} />
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title">Node origin</div>
            <button
              className="btn-ghost text-[11px]"
              onClick={() => setEditingPricing(true)}
              title="Update gigabyte / hourly prices on chain"
            >
              <MIcon name="edit" size={12} />
              Pricing
            </button>
          </div>
          <div className="flex items-center gap-3">
            <QRCode value={node.operatorAddress || 'sent1pending'} size={72} />
            <div className="min-w-0">
              <div className="text-sm text-text truncate">{node.region ?? 'Remote'}</div>
              <div className="text-[11px] text-text-dim">
                {node.target === 'remote' ? 'Remote via SSH' : 'Local via Docker'}
              </div>
              <div className="text-[10px] text-text-dim font-mono mt-1 break-all">
                {node.host ?? '127.0.0.1'}:{node.port}
              </div>
              <div className="text-[10px] text-text-dim mt-0.5">
                {node.serviceType} · {fmtDVPN(node.gigabytePriceDVPN, 4)} $P2P / GB ·{' '}
                {fmtDVPN(node.hourlyPriceDVPN, 4)} $P2P / hr
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <span className="text-text-dim">Operator key</span>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(node.operatorAddress);
                pushToast({ title: 'Address copied', tone: 'success' });
              }}
              className="text-accent hover:text-accent-strong flex items-center gap-1"
            >
              <MIcon name="content_copy" size={12} /> {shortAddr(node.operatorAddress, 8, 6)}
            </button>
          </div>
          {status?.chainAddress && (
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-text-dim">Node key</span>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(status.chainAddress!);
                  pushToast({ title: 'Node address copied', tone: 'success' });
                }}
                className="text-accent hover:text-accent-strong flex items-center gap-1"
              >
                <MIcon name="content_copy" size={12} /> {shortAddr(status.chainAddress, 8, 6)}
              </button>
            </div>
          )}
        </div>

        {/* Active subscriptions / sessions from on-chain */}
        <div className="col-span-12 card p-5">
          <div className="flex items-center gap-2 mb-3">
            <MIcon name="groups" size={14} />
            <div className="section-title">Active subscriptions</div>
            <div className="flex-1" />
            {status?.reachable && (
              <span className="text-[10px] text-text-dim">
                {status.activeSubscriptions.length} live · showing up to 20
              </span>
            )}
          </div>
          {!status?.reachable ? (
            <div className="text-xs text-text-dim">
              Subscriptions are queried on-chain — waiting for the first probe.
            </div>
          ) : status.activeSubscriptions.length === 0 ? (
            <div className="text-xs text-text-dim">
              No active subscriptions. They appear here the moment a user purchases bandwidth
              from this node.
            </div>
          ) : (
            <div className="space-y-2">
              {status.activeSubscriptions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-bg-input px-3 py-2"
                >
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-accent/40 to-success/40" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-text truncate font-mono">
                      {s.subscriberShort}
                    </div>
                    <div className="text-[10px] text-text-dim">
                      {formatBytes(s.bytesIn + s.bytesOut)} · {formatDuration(s.durationSeconds * 1000)}
                    </div>
                  </div>
                  {s.status && <span className="chip-muted text-[10px]">{s.status}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs */}
        <div className="col-span-12 card p-5">
          <div className="flex items-center gap-2 mb-3">
            <MIcon name="terminal" size={14} />
            <div className="section-title">Live logs</div>
            <div className="flex-1" />
            <button className="btn-ghost text-xs" onClick={() => void refreshStatus(id)}>
              <MIcon name="refresh" size={12} />
              Re-fetch
            </button>
          </div>
          {status?.logTail && status.logTail.length > 0 ? (
            <pre className="text-[10px] font-mono text-text-muted leading-[1.6] max-h-72 overflow-y-auto whitespace-pre-wrap">
{status.logTail.join('\n')}
            </pre>
          ) : (
            <div className="text-xs text-text-dim">No log output captured yet.</div>
          )}
          <div className="mt-3 flex items-center justify-end">
            <button className="btn-ghost text-xs text-danger" onClick={onRemove} disabled={!!busy}>
              <MIcon name="delete" size={12} />
              Remove node
            </button>
          </div>
        </div>
      </div>

      {withdrawOpen && wallet?.address && (
        <WithdrawEditor
          nodeBalance={node.balanceDVPN}
          defaultTo={wallet.address}
          pending={busy === 'withdraw'}
          onCancel={() => setWithdrawOpen(false)}
          onSubmit={(amount, to) => doWithdraw(amount, to)}
        />
      )}

      {editingPricing && (
        <PricingEditor
          initialGiga={node.gigabytePriceDVPN}
          initialHour={node.hourlyPriceDVPN}
          onCancel={() => setEditingPricing(false)}
          onSubmit={async (giga, hour) => {
            setBusy('pricing');
            try {
              const res = await window.api.nodes.updatePricing({
                nodeId: id,
                gigabytePriceDVPN: giga,
                hourlyPriceDVPN: hour,
              });
              if (res.ok) {
                pushToast({
                  title: 'Pricing updated',
                  body: `tx ${res.txHash?.slice(0, 16)}…`,
                  tone: 'success',
                });
                await refreshNodes();
                await refreshStatus(id);
                setEditingPricing(false);
              } else {
                pushToast({ title: 'Pricing update failed', body: res.error, tone: 'error' });
              }
            } finally {
              setBusy('');
            }
          }}
        />
      )}
    </div>
  );
}

function WithdrawEditor({
  nodeBalance,
  defaultTo,
  pending,
  onCancel,
  onSubmit,
}: {
  nodeBalance: number;
  defaultTo: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (amount: number, to: string) => void | Promise<void>;
}) {
  const GAS_BUFFER = 0.03; // leave ~30k udvpn for the broadcast fee
  const OPS_BUFFER = 0.5; // suggested reserve to cover future node txs
  const maxWithdrawable = Math.max(0, nodeBalance - GAS_BUFFER);
  const suggested = Math.max(0, nodeBalance - GAS_BUFFER - OPS_BUFFER);
  const [amount, setAmount] = useState(suggested.toFixed(6));
  const [to, setTo] = useState(defaultTo);

  const amountNum = Number(amount) || 0;
  const valid =
    amountNum > 0 &&
    amountNum <= maxWithdrawable &&
    /^sent1[0-9a-z]{38,58}$/.test(to.trim());
  const leaving = Math.max(0, nodeBalance - amountNum - GAS_BUFFER);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm no-drag">
      <div className="card-elev w-[480px] max-w-[92vw] p-6">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-success/15 text-success grid place-items-center flex-shrink-0">
            <MIcon name="north_east" size={20} />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-text">Withdraw from node</div>
            <div className="mt-1 text-sm text-text-muted">
              Broadcasts a MsgSend from the node's operator key. Leaving a small reserve on the
              node key is recommended — the node spends $P2P on gas for its own periodic status
              updates and session settlements.
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-bg-input p-3 text-xs">
          <div className="flex items-center justify-between text-text-muted">
            <span>Node balance</span>
            <span className="font-semibold text-text">{fmtDVPN(nodeBalance)} $P2P</span>
          </div>
          <div className="flex items-center justify-between text-text-muted mt-0.5">
            <span>Estimated gas</span>
            <span>~{GAS_BUFFER} $P2P</span>
          </div>
          <div className="flex items-center justify-between text-text-muted mt-0.5">
            <span>Max withdrawable</span>
            <span>{fmtDVPN(maxWithdrawable)} $P2P</span>
          </div>
        </div>

        <div className="mt-4">
          <div className="field-label">Amount ($P2P)</div>
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              step="0.000001"
              min="0"
              max={maxWithdrawable}
              className="field-input flex-1"
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setAmount(maxWithdrawable.toFixed(6))}
              title="Use everything minus the gas buffer"
            >
              Max
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setAmount(suggested.toFixed(6))}
              title={`Leave ${OPS_BUFFER} $P2P on the node for future operations`}
            >
              Suggested
            </button>
          </div>
          <div className="mt-1.5 text-[11px] text-text-dim">
            Node will retain <span className="text-text">{fmtDVPN(leaving)} $P2P</span> after the
            transaction.
          </div>
        </div>

        <div className="mt-4">
          <div className="field-label">Destination address</div>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="field-input font-mono text-xs"
          />
          <div className="mt-1 text-[11px] text-text-dim">
            Defaults to your app wallet. Change it to send to an external address.
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!valid || pending}
            onClick={() => onSubmit(amountNum, to.trim())}
          >
            {pending ? 'Broadcasting…' : `Withdraw ${fmtDVPN(amountNum)} $P2P`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PricingEditor({
  initialGiga,
  initialHour,
  onCancel,
  onSubmit,
}: {
  initialGiga: number;
  initialHour: number;
  onCancel: () => void;
  onSubmit: (giga: number, hour: number) => void | Promise<void>;
}) {
  const [giga, setGiga] = useState(String(initialGiga));
  const [hour, setHour] = useState(String(initialHour));
  const [pending, setPending] = useState(false);
  const valid = Number(giga) >= 0 && Number(hour) >= 0;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-sm no-drag">
      <div className="card-elev w-[440px] max-w-[92vw] p-6">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/15 text-accent grid place-items-center flex-shrink-0">
            <MIcon name="price_change" size={20} />
          </div>
          <div className="flex-1">
            <div className="text-base font-semibold text-text">Update node pricing</div>
            <div className="mt-1 text-sm text-text-muted">
              Broadcasts MsgUpdateNodeDetails signed by this node's operator key.
              Fees are visible to subscribers immediately on chain.
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="field-label">$P2P per GB</div>
            <input
              value={giga}
              onChange={(e) => setGiga(e.target.value)}
              type="number"
              step="0.0001"
              className="field-input"
            />
          </div>
          <div>
            <div className="field-label">$P2P per hour</div>
            <input
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              type="number"
              step="0.0001"
              className="field-input"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!valid || pending}
            onClick={async () => {
              setPending(true);
              try {
                await onSubmit(Number(giga), Number(hour));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? 'Broadcasting…' : 'Broadcast update'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ? 'text-accent' : 'text-text'}`}>
        {value}
      </div>
    </div>
  );
}

function formatChainStatus(s?: string): string {
  if (!s) return '—';
  // Raw values from the proto: STATUS_ACTIVE=1, STATUS_INACTIVE=2, etc.
  const map: Record<string, string> = {
    '1': 'Active',
    '2': 'Inactive',
    '3': 'Active (pending)',
    STATUS_ACTIVE: 'Active',
    STATUS_INACTIVE: 'Inactive',
    STATUS_ACTIVE_PENDING: 'Active (pending)',
  };
  return map[s] ?? s;
}

function formatDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
