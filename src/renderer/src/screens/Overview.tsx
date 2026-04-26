import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, relativeTime } from '../lib/format';
import { KIND_ICON } from '../lib/events';
import type { NodeStatus } from '../../../shared/types';

const STAT_COL = 'col-span-6 lg:col-span-3';

export function Overview() {
  const {
    nodes,
    events,
    navigate,
    refreshWallet,
    refreshNodes,
    refreshEvents,
    liveStatuses,
    refreshStatus,
  } = useApp();

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
    const liquidBalance = nodes.reduce((sum, n) => sum + n.balanceDVPN, 0);
    return { peers, liquidBalance, reachable };
  }, [nodes, liveStatuses]);

  const [lastRefreshed, setLastRefreshed] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const refreshAll = () => {
    void refreshWallet();
    void refreshNodes();
    void refreshEvents();
    for (const n of nodes) void refreshStatus(n.id);
    setLastRefreshed(Date.now());
  };

  const staleSeconds = Math.floor((now - lastRefreshed) / 1000);
  const stale = staleSeconds > 90;

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <PageHeader
        title="Dashboard"
        subtitle="Real-time status of your decentralized VPN infrastructure."
        right={
          <>
            <span
              className="text-[11px] mr-1"
              style={{ color: stale ? 'var(--yellow, #f5b04a)' : 'var(--text-dim)' }}
              title={new Date(lastRefreshed).toLocaleString()}
            >
              {stale ? 'Stale · ' : 'Updated '}
              {relativeTime(new Date(lastRefreshed).toISOString())}
            </span>
            <button className="btn btn-secondary" onClick={refreshAll} title="Refresh">
              <MIcon name="refresh" size={14} />
              Refresh
            </button>
            <button
              className="btn btn-primary"
              onClick={() => navigate({ name: 'deploy-local' })}
            >
              <MIcon name="add" size={14} />
              Deploy a node
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-4">
        <StatCard
          className={STAT_COL}
          label="Connected peers"
          value={totals.peers.toString()}
          caption={nodes.length === 0 ? 'Deploy a node to start' : ' '}
        />
        <StatCard
          className={STAT_COL}
          label="Number of nodes"
          value={nodes.length.toString()}
          caption={nodes.length === 0 ? 'None deployed' : `${totals.reachable} online`}
        />
        <StatCard
          className={STAT_COL}
          label="Total node balance"
          value={`${fmtDVPN(totals.liquidBalance)} $P2P`}
          caption="Sum across all node operators"
        />
        <StatCard
          className={STAT_COL}
          label="Recent events"
          value={events.length.toString()}
          caption={events[0] ? relativeTime(events[0].timestamp) : 'no activity yet'}
        />
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-8 flex flex-col min-h-0 gap-4">
          {nodes.length === 0 ? (
            <div className="card flex-1 min-h-0 overflow-hidden flex flex-col">
              <div className="card-header">
                <div className="card-title">My nodes</div>
              </div>
              <div className="card-body flex-1">
                <div className="empty-state">
                  <MIcon name="dns" size={28} />
                  <div className="font-semibold" style={{ color: 'var(--text)' }}>
                    No nodes yet
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Deploy your first node to start earning rewards.
                  </div>
                  <button
                    className="btn btn-primary mt-2"
                    onClick={() => navigate({ name: 'deploy-local' })}
                  >
                    <MIcon name="rocket_launch" size={14} />
                    Deploy a node
                  </button>
                </div>
              </div>
            </div>
          ) : (
              <button
                type="button"
                onClick={() => navigate({ name: 'nodes' })}
                className="card text-left transition-colors"
                style={{ cursor: 'pointer' }}
                title="Open My Nodes"
              >
                <div className="card-body flex items-center gap-3 py-3">
                  <div
                    className="h-9 w-9 rounded-md grid place-items-center flex-shrink-0"
                    style={{
                      background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                      color: 'var(--accent)',
                    }}
                  >
                    <MIcon name="dns" size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      Added nodes ({nodes.length})
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {totals.reachable} online · view all in My Nodes
                    </div>
                  </div>
                  <span
                    className="text-[11px] flex items-center gap-1"
                    style={{ color: 'var(--accent)' }}
                  >
                    View here
                    <MIcon name="arrow_forward" size={14} />
                  </span>
                </div>
              </button>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 flex flex-col min-h-0">
          <div className="card flex flex-col min-h-0 overflow-hidden flex-1">
            <div className="card-header">
              <div className="card-title">Recent activity</div>
            </div>
            <div className="card-body flex-1 min-h-0 overflow-auto">
              {events.length === 0 ? (
                <div
                  className="text-xs text-center py-6"
                  style={{ color: 'var(--text-dim)' }}
                >
                  No activity yet.
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {events.slice(0, 20).map((e) => {
                    const Icon = KIND_ICON[e.kind];
                    return (
                      <li key={e.id} className="flex items-start gap-3">
                        <div
                          className="h-7 w-7 rounded-md grid place-items-center flex-shrink-0"
                          style={{
                            background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                            color: 'var(--accent)',
                          }}
                        >
                          <Icon size={14} weight="regular" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-xs font-medium"
                            style={{ color: 'var(--text)' }}
                          >
                            {e.title}
                          </div>
                          {e.subtitle && (
                            <div
                              className="text-[11px] truncate"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {e.subtitle}
                            </div>
                          )}
                        </div>
                        <div
                          className="text-[10px] whitespace-nowrap"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          {relativeTime(e.timestamp)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status, reachable }: { status: NodeStatus; reachable?: boolean }) {
  if (status === 'loading')
    return (
      <span className="chip chip-warn">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--yellow)' }}
        />
        Starting
      </span>
    );
  if (status === 'error')
    return (
      <span className="chip chip-danger">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--red)' }} />
        Error
      </span>
    );
  if (status === 'offline')
    return (
      <span className="chip chip-danger">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--red)' }} />
        Offline
      </span>
    );
  return reachable ? (
    <span className="chip chip-success">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--green)' }} />
      Online
    </span>
  ) : (
    <span className="chip chip-warn">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--yellow)' }} />
      Syncing
    </span>
  );
}

