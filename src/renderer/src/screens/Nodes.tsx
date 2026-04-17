import { useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { fmtDVPN, relativeTime } from '../lib/format';

export function Nodes() {
  const { nodes, navigate, refreshStatus, liveStatuses, refreshNodes } = useApp();

  useEffect(() => {
    for (const n of nodes) void refreshStatus(n.id);
  }, [nodes, refreshStatus]);

  return (
    <div>
      <PageHeader
        title="Nodes"
        subtitle={`${nodes.length} deployed ${nodes.length === 1 ? 'node' : 'nodes'}`}
        right={
          <>
            <button
              className="btn-secondary"
              onClick={() => {
                void refreshNodes();
                for (const n of nodes) void refreshStatus(n.id);
              }}
            >
              <MIcon name="refresh" size={14} />
              Refresh
            </button>
            <button className="btn-primary" onClick={() => navigate({ name: 'deploy' })}>
              <MIcon name="add" size={14} />
              Deploy node
            </button>
          </>
        }
      />

      {nodes.length === 0 ? (
        <div className="card p-10 text-center">
          <MIcon name="dns" size={40} className="text-text-dim mx-auto" />
          <div className="mt-3 text-lg font-semibold">No nodes deployed yet</div>
          <p className="mt-1.5 text-sm text-text-muted max-w-md mx-auto">
            Spin up your first Sentinel dVPN node — locally on this machine via Docker, or
            remotely via SSH on any Linux VPS.
          </p>
          <button className="btn-primary mt-6" onClick={() => navigate({ name: 'deploy' })}>
            Start first deployment
            <MIcon name="arrow_forward" size={14} />
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden max-h-[calc(100vh-220px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] text-text-dim uppercase tracking-wider bg-bg-soft sticky top-0">
              <tr>
                <th className="text-left font-medium px-5 py-3">Moniker</th>
                <th className="text-left font-medium px-5 py-3">Where</th>
                <th className="text-left font-medium px-5 py-3">Status</th>
                <th className="text-left font-medium px-5 py-3">Service</th>
                <th className="text-left font-medium px-5 py-3">Balance</th>
                <th className="text-left font-medium px-5 py-3">Created</th>
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
                    <td className="px-5 py-3 font-medium text-text flex items-center gap-2">
                      <MIcon name="dns" size={16} className="text-text-muted" />
                      {n.moniker}
                    </td>
                    <td className="px-5 py-3 text-text-muted font-mono text-xs">
                      {n.target === 'local' ? `local:${n.port}` : `${n.host}:${n.port}`}
                    </td>
                    <td className="px-5 py-3">
                      {n.status === 'loading' ? (
                        <span className="chip-warn">● Starting</span>
                      ) : n.status === 'error' ? (
                        <span className="chip-err">● Error</span>
                      ) : n.status === 'offline' ? (
                        <span className="chip-err">● Offline</span>
                      ) : s?.reachable ? (
                        <span className="chip-ok">● Online</span>
                      ) : (
                        <span className="chip-warn">● Syncing</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-text-muted uppercase text-[10px] tracking-wider">
                      {n.serviceType}
                    </td>
                    <td className="px-5 py-3 text-text-muted">{fmtDVPN(n.balanceDVPN)} $P2P</td>
                    <td className="px-5 py-3 text-text-muted">{relativeTime(n.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
