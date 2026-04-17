import { useEffect, useMemo } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, relativeTime } from '../lib/format';
import { KIND_TONE, KIND_ICON_M } from '../lib/events';
import type { NodeStatus } from '../../../shared/types';

export function Overview() {
  const { nodes, events, navigate, refreshWallet, refreshNodes, refreshEvents, liveStatuses, refreshStatus } =
    useApp();

  useEffect(() => {
    for (const n of nodes) void refreshStatus(n.id);
  }, [nodes, refreshStatus]);

  const totals = useMemo(() => {
    let peers = 0;
    let reachable = 0;
    for (const n of nodes) {
      const s = liveStatuses[n.id];
      if (s?.reachable) {
        reachable++;
        peers += s.sessions;
      }
    }
    const earned = nodes.reduce((sum, n) => sum + n.balanceDVPN, 0);
    const uptimePct = nodes.length === 0 ? 0 : (reachable / nodes.length) * 100;
    return { peers, earned, uptimePct, reachable };
  }, [nodes, liveStatuses]);

  const refreshAll = () => {
    void refreshWallet();
    void refreshNodes();
    void refreshEvents();
    for (const n of nodes) void refreshStatus(n.id);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Dashboard"
        subtitle="Real-time status of your decentralized VPN infrastructure."
        right={
          <>
            <button className="btn-secondary" onClick={refreshAll} title="Refresh (⌘R)">
              <MIcon name="refresh" size={14} />
              Refresh
            </button>
            <button className="btn-primary" onClick={() => navigate({ name: 'deploy' })}>
              <MIcon name="add" size={14} />
              Deploy a node
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 grid grid-cols-12 gap-4 overflow-hidden">
        <div className="col-span-12 lg:col-span-8 space-y-4 min-h-0 overflow-y-auto pr-1">
          <div className="card p-6 bg-gradient-to-br from-accent/20 via-bg-card to-bg-card">
            <div className="text-[11px] uppercase tracking-wider text-accent font-semibold">
              Expand your network reach
            </div>
            <div className="mt-1 text-lg font-semibold text-text max-w-md">
              Increase your presence on the decentralized VPN network by deploying
              another node across diverse locations.
            </div>
            <button className="btn-primary mt-5" onClick={() => navigate({ name: 'deploy' })}>
              <MIcon name="rocket_launch" size={14} />
              Deploy another node
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Connected peers"
              value={totals.peers.toString()}
              caption={nodes.length === 0 ? 'Deploy a node to start' : `across ${totals.reachable} online nodes`}
              accent="accent"
            />
            <StatCard
              label="Uptime score"
              value={`${totals.uptimePct.toFixed(1)}%`}
              caption={`${totals.reachable} / ${nodes.length} reachable`}
              accent="success"
            />
            <StatCard
              label="On-chain rewards"
              value={`${fmtDVPN(totals.earned)} $P2P`}
              caption="Node operator balance total"
            />
          </div>

          <div className="card">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="section-title">Network nodes</div>
              <button
                className="text-xs text-accent hover:text-accent-strong inline-flex items-center gap-1"
                onClick={() => navigate({ name: 'nodes' })}
              >
                View all <MIcon name="arrow_forward" size={12} />
              </button>
            </div>
            {nodes.length === 0 ? (
              <div className="px-5 py-10 text-center text-text-muted text-sm">
                No nodes yet. Deploy your first one to start earning rewards.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] text-text-dim uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-medium px-5 py-2">Moniker</th>
                    <th className="text-left font-medium px-5 py-2">Status</th>
                    <th className="text-left font-medium px-5 py-2">Host</th>
                    <th className="text-left font-medium px-5 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n) => {
                    const s = liveStatuses[n.id];
                    return (
                      <tr
                        key={n.id}
                        onClick={() => navigate({ name: 'node-details', id: n.id })}
                        className="border-t border-border hover:bg-bg-elev/60 cursor-pointer"
                      >
                        <td className="px-5 py-3 font-medium text-text">{n.moniker}</td>
                        <td className="px-5 py-3">
                          <StatusChip status={n.status} reachable={s?.reachable} />
                        </td>
                        <td className="px-5 py-3 text-text-muted font-mono text-xs">
                          {n.host ?? 'localhost'}:{n.port}
                        </td>
                        <td className="px-5 py-3 text-text-muted">
                          {fmtDVPN(n.balanceDVPN)} $P2P
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4 min-h-0 overflow-y-auto pr-1">
          <div className="card p-5">
            <div className="section-title mb-3">Recent activity</div>
            {events.length === 0 ? (
              <div className="text-xs text-text-dim">No activity yet.</div>
            ) : (
              <ul className="space-y-3 max-h-[360px] overflow-y-auto pr-1 -mr-1">
                {events.slice(0, 30).map((e) => {
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
                    <li key={e.id} className="flex items-start gap-3">
                      <div className={`mt-0.5 h-7 w-7 rounded-md grid place-items-center ${toneCls}`}>
                        <MIcon name={KIND_ICON_M[e.kind]} size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-text">{e.title}</div>
                        {e.subtitle && (
                          <div className="text-[11px] text-text-muted truncate">{e.subtitle}</div>
                        )}
                      </div>
                      <div className="text-[10px] text-text-dim whitespace-nowrap">
                        {relativeTime(e.timestamp)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card p-5">
            <div className="section-title mb-2">App wallet</div>
            <AppWalletSummary />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, reachable }: { status: NodeStatus; reachable?: boolean }) {
  if (status === 'loading') return <span className="chip-warn">● Starting</span>;
  if (status === 'error') return <span className="chip-err">● Error</span>;
  if (status === 'offline') return <span className="chip-err">● Offline</span>;
  return reachable ? (
    <span className="chip-ok">● Online</span>
  ) : (
    <span className="chip-warn">● Syncing</span>
  );
}

function AppWalletSummary() {
  const { wallet, navigate } = useApp();
  if (!wallet?.address) {
    return (
      <button className="btn-primary w-full" onClick={() => navigate({ name: 'wallet-setup' })}>
        <MIcon name="shield" size={14} />
        Set up wallet
      </button>
    );
  }
  return (
    <>
      <div className="text-2xl font-semibold">
        {fmtDVPN(wallet.balanceDVPN)} <span className="text-text-muted text-lg">$P2P</span>
      </div>
      <div className="mt-1 text-[11px] text-text-dim font-mono truncate">{wallet.address}</div>
      <button className="btn-secondary mt-3 w-full" onClick={() => navigate({ name: 'wallet' })}>
        <MIcon name="arrow_forward" size={14} />
        Open wallet
      </button>
    </>
  );
}
