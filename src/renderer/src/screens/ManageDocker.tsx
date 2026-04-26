import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { DockerOverview } from '../../../shared/types';

const REFRESH_MS = 5000;

export function ManageDocker() {
  const { pushToast, confirm } = useApp();
  const [overview, setOverview] = useState<DockerOverview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await window.api.docker.overview();
      setOverview(o);
    } catch (e) {
      setOverview({
        reachable: false,
        error: (e as Error).message,
        containers: { total: 0, running: 0, paused: 0, stopped: 0 },
        images: { count: 0, sizeBytes: 0 },
        sentinelContainers: [],
        sentinelImages: [],
      });
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timer.current = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const onStart = async () => {
    setBusy('start');
    try {
      const r = await window.api.docker.start();
      if (r.started) {
        pushToast({
          title: 'Docker Desktop is starting',
          body: 'The daemon typically becomes reachable within 10 to 30 seconds.',
          tone: 'info',
        });
      } else {
        pushToast({
          title: 'Unable to launch Docker Desktop',
          body: r.error ?? 'Install Docker Desktop from docker.com/products/docker-desktop and try again.',
          tone: 'error',
        });
      }
    } finally {
      setBusy(null);
      void load();
    }
  };

  const onForceQuit = async () => {
    const ok = await confirm({
      title: 'Force-quit Docker Desktop?',
      body:
        'Kills all Docker processes, runs wsl --shutdown, and stops com.docker.service. Use this only when Docker is wedged on "Starting the Docker Engine…" and the tray Quit does nothing. Running containers stop immediately.',
      tone: 'danger',
      confirmLabel: 'Force-quit',
    });
    if (!ok) return;
    setBusy('force-quit');
    try {
      const r = await window.api.docker.forceQuit();
      const failed = r.steps.filter((s) => !s.ok);
      if (r.quit && failed.length === 0) {
        pushToast({
          title: 'Docker Desktop terminated',
          body: `${r.steps.length} steps completed. Wait ~10 seconds before restarting Docker.`,
          tone: 'success',
        });
      } else {
        const failedNames = failed.map((s) => s.name).join(', ') || r.error || 'unknown';
        pushToast({
          title: 'Force-quit finished with errors',
          body: `Some steps did not succeed: ${failedNames}.`,
          tone: 'warn',
        });
      }
    } catch (e) {
      pushToast({
        title: 'Force-quit failed',
        body: (e as Error).message,
        tone: 'error',
      });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const onStopSentinel = async () => {
    const ok = await confirm({
      title: 'Stop all Sentinel containers?',
      body: 'Takes every local Sentinel node offline. Earnings pause until you restart them from My Nodes. Container data stays on disk.',
      tone: 'warning',
      confirmLabel: 'Stop containers',
    });
    if (!ok) return;
    setBusy('stop-sentinel');
    try {
      const r = await window.api.docker.stopAllSentinel();
      pushToast({
        title: r.failed > 0 ? 'Stopped with errors' : 'Sentinel containers stopped',
        body:
          r.stopped === 0
            ? 'No running Sentinel containers found.'
            : `${r.stopped} container${r.stopped === 1 ? '' : 's'} stopped${r.failed > 0 ? ` · ${r.failed} failed` : ''}.`,
        tone: r.failed > 0 ? 'warn' : 'success',
      });
    } catch (e) {
      pushToast({ title: 'Unable to stop containers', body: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const onPrune = async () => {
    const ok = await confirm({
      title: 'Prune dangling images?',
      body: 'Drops orphaned image layers from old builds. Tagged sentinel-dvpnx images are kept.',
      tone: 'info',
      confirmLabel: 'Prune now',
    });
    if (!ok) return;
    setBusy('prune');
    try {
      const r = await window.api.docker.prune();
      pushToast({
        title: r.removed === 0 ? 'Nothing to prune' : 'Prune complete',
        body:
          r.removed === 0
            ? 'No dangling images found.'
            : `${r.removed} image${r.removed === 1 ? '' : 's'} removed · ${formatBytes(r.reclaimedBytes)} reclaimed.`,
        tone: 'success',
      });
    } catch (e) {
      pushToast({ title: 'Unable to prune images', body: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
      void load();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <PageHeader
        title="Manage Docker"
        subtitle="Daemon status, Sentinel containers, and recovery."
        right={
          <button
            className="btn btn-secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            <MIcon name="refresh" size={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0 overflow-auto">
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-3 min-h-0">
          <DaemonCard
            overview={overview}
            loaded={loaded}
            busy={busy}
            onStart={onStart}
            onForceQuit={onForceQuit}
          />
          <SentinelContainersCard overview={overview} loaded={loaded} />
          <SentinelImagesCard overview={overview} loaded={loaded} onPrune={onPrune} busy={busy} />
        </div>

        <div className="col-span-12 lg:col-span-4 flex flex-col gap-3 min-h-0">
          {loaded && overview?.reachable && (
            <ActionsCard
              overview={overview}
              loaded={loaded}
              busy={busy}
              onStart={onStart}
              onForceQuit={onForceQuit}
              onStopSentinel={onStopSentinel}
              onPrune={onPrune}
            />
          )}
          <SystemCard overview={overview} loaded={loaded} />
        </div>
      </div>
    </div>
  );
}

function DaemonCard({
  overview,
  loaded,
  busy,
  onStart,
  onForceQuit,
}: {
  overview: DockerOverview | null;
  loaded: boolean;
  busy: string | null;
  onStart: () => void;
  onForceQuit: () => void;
}) {
  const reachable = overview?.reachable ?? false;
  const dotColor = !loaded ? 'var(--text-muted)' : reachable ? 'var(--green)' : 'var(--red)';
  const headline = !loaded
    ? 'Probing Docker…'
    : reachable
      ? `Docker Engine ${overview?.version ?? ''}`
      : reasonHeadline(overview?.reason);
  const sub = !loaded
    ? 'Querying the local Docker Engine API.'
    : reachable
      ? `${overview?.os ?? '—'} · ${overview?.arch ?? ''} · API ${overview?.apiVersion ?? '?'}`
      : overview?.error ?? 'The Docker daemon is not responding on any socket.';
  // Render the metric grid when we expect Docker to be reachable. Once
  // `loaded` is true and we know it's not reachable, swap in the action
  // buttons. The first paint always shows the grid as a stable skeleton so
  // the card height doesn't shift between probe and result.
  const showStats = !loaded || reachable;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title flex items-center gap-2">
          <MIcon name="deployed_code" size={14} />
          Docker daemon
        </div>
      </div>
      <div className="card-body flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-block rounded-full"
            style={{ width: 10, height: 10, background: dotColor }}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
              {headline}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {sub}
            </div>
          </div>
        </div>

        {showStats ? (
          <div className="grid grid-cols-4 gap-2">
            <Stat
              label="Containers"
              value={loaded && overview ? String(overview.containers.total) : '—'}
            />
            <Stat
              label="Running"
              value={loaded && overview ? String(overview.containers.running) : '—'}
              accent
            />
            <Stat
              label="Images"
              value={loaded && overview ? String(overview.images.count) : '—'}
            />
            <Stat
              label="Image disk"
              value={loaded && overview ? formatBytes(overview.images.sizeBytes) : '—'}
            />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {overview?.desktop?.startable && (
              <button
                className="btn btn-primary"
                onClick={onStart}
                disabled={busy !== null}
              >
                <MIcon name="play_arrow" size={14} />
                {busy === 'start' ? 'Starting…' : 'Start Docker Desktop'}
              </button>
            )}
            {!overview?.desktop?.installed && overview?.reason === 'desktop-not-installed' && (
              <a
                className="btn btn-primary"
                href="https://www.docker.com/products/docker-desktop/"
                target="_blank"
                rel="noreferrer"
              >
                <MIcon name="open_in_new" size={14} />
                Install Docker Desktop
              </a>
            )}
            {overview?.desktop?.installed && (
              <button
                className="btn btn-danger"
                onClick={onForceQuit}
                disabled={busy !== null}
                title="Use only when Docker is wedged on 'Starting the Docker Engine…'. Kills Docker processes, runs wsl --shutdown, stops com.docker.service."
              >
                <MIcon name="bolt" size={14} />
                {busy === 'force-quit' ? 'Force-quitting…' : 'Force-quit Docker'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SentinelContainersCard({
  overview,
  loaded,
}: {
  overview: DockerOverview | null;
  loaded: boolean;
}) {
  const list = overview?.sentinelContainers ?? [];
  const reachable = overview?.reachable ?? false;
  const countLabel = !loaded ? '…' : reachable ? `${list.length} found` : 'unavailable';
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title flex items-center gap-2">
          <MIcon name="dns" size={14} />
          Sentinel containers
          <span
            className="text-[11px] font-normal ml-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {countLabel}
          </span>
        </div>
      </div>
      <div className="card-body" style={{ minHeight: 64 }}>
        {!loaded ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading container inventory…
          </div>
        ) : !reachable ? (
          <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <MIcon name="info" size={14} />
            <span>
              The container inventory is queried from the Docker Engine API. Start Docker Desktop
              to view your Sentinel containers. Previously deployed containers remain on disk.
            </span>
          </div>
        ) : list.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No containers found with the <code className="mono-inline">sentinel-dvpn-</code> prefix.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {list.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs py-1.5 px-2 rounded"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-block rounded-full flex-shrink-0"
                    style={{
                      width: 8,
                      height: 8,
                      background: c.state === 'running' ? 'var(--green)' : 'var(--text-muted)',
                    }}
                  />
                  <span className="font-semibold truncate" style={{ color: 'var(--text)' }}>
                    {c.name}
                  </span>
                </div>
                <div className="text-[11px] flex-shrink-0 ml-2" style={{ color: 'var(--text-muted)' }}>
                  {c.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SentinelImagesCard({
  overview,
  loaded,
  onPrune,
  busy,
}: {
  overview: DockerOverview | null;
  loaded: boolean;
  onPrune: () => void;
  busy: string | null;
}) {
  const list = overview?.sentinelImages ?? [];
  const reachable = overview?.reachable ?? false;
  const countLabel = !loaded ? '…' : reachable ? `${list.length} tagged` : 'unavailable';
  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="card-title flex items-center gap-2">
          <MIcon name="layers" size={14} />
          Sentinel images
          <span
            className="text-[11px] font-normal ml-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {countLabel}
          </span>
        </div>
        {reachable && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={onPrune}
            disabled={busy !== null}
            title="Removes orphaned image layers left behind by previous builds. Tagged sentinel-dvpnx images are retained."
          >
            <MIcon name="cleaning_services" size={12} />
            {busy === 'prune' ? 'Pruning…' : 'Prune dangling'}
          </button>
        )}
      </div>
      <div className="card-body" style={{ minHeight: 64 }}>
        {!loaded ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading image inventory…
          </div>
        ) : !reachable ? (
          <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <MIcon name="info" size={14} />
            <span>
              The image inventory is queried from the Docker Engine API. Start Docker Desktop to
              view cached <code className="mono-inline">sentinel-dvpnx</code> images. Previously
              pulled layers remain on disk while Docker is offline.
            </span>
          </div>
        ) : list.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No <code className="mono-inline">sentinel-dvpnx</code> images cached yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {list.map((img) => (
              <div
                key={img.id}
                className="flex items-center justify-between text-xs py-1.5 px-2 rounded mono-inline"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
              >
                <span className="truncate" style={{ color: 'var(--text)' }}>
                  {img.tag}
                </span>
                <span className="ml-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(img.sizeBytes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionsCard({
  overview,
  loaded,
  busy,
  onStart,
  onForceQuit,
  onStopSentinel,
  onPrune,
}: {
  overview: DockerOverview | null;
  loaded: boolean;
  busy: string | null;
  onStart: () => void;
  onForceQuit: () => void;
  onStopSentinel: () => void;
  onPrune: () => void;
}) {
  const reachable = overview?.reachable ?? false;
  const hasRunningSentinel =
    (overview?.sentinelContainers ?? []).some((c) => c.state === 'running');
  if (!loaded) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title">Actions</div>
        </div>
        <div className="card-body" style={{ minHeight: 96 }}>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading available actions…
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Actions</div>
      </div>
      <div className="card-body flex flex-col gap-2">
        {!reachable && overview?.desktop?.startable && (
          <button
            className="btn btn-primary w-full"
            onClick={onStart}
            disabled={busy !== null}
          >
            <MIcon name="play_arrow" size={14} />
            {busy === 'start' ? 'Starting Docker…' : 'Start Docker Desktop'}
          </button>
        )}
        {reachable && (
          <>
            <button
              className="btn btn-secondary w-full"
              onClick={onStopSentinel}
              disabled={busy !== null || !hasRunningSentinel}
              title={!hasRunningSentinel ? 'No Sentinel containers are currently running.' : undefined}
            >
              <MIcon name="stop_circle" size={14} />
              {busy === 'stop-sentinel' ? 'Stopping…' : 'Stop all Sentinel containers'}
            </button>
            <button
              className="btn btn-secondary w-full"
              onClick={onPrune}
              disabled={busy !== null}
              title="Removes orphaned image layers left behind by previous builds. Tagged sentinel-dvpnx images are retained."
            >
              <MIcon name="cleaning_services" size={14} />
              {busy === 'prune' ? 'Pruning…' : 'Prune dangling images'}
            </button>
          </>
        )}
        {overview?.desktop?.installed && (
          <button
            className="btn btn-danger w-full"
            onClick={onForceQuit}
            disabled={busy !== null}
            title="Last-resort recovery when Docker Desktop is unresponsive. Terminates all Docker processes, runs wsl --shutdown, and stops com.docker.service via the Service Control Manager."
          >
            <MIcon name="bolt" size={14} />
            {busy === 'force-quit' ? 'Force-quitting…' : 'Force-quit Docker'}
          </button>
        )}
        {reachable && (
          <div
            className="text-[11px] leading-relaxed mt-1 pt-2"
            style={{ borderTop: '1px solid var(--border)', color: 'var(--text-dim)' }}
          >
            Force-quit is a last-resort recovery action. Use it only when Docker Desktop is
            stuck on "Starting the Docker Engine…" and the tray menu is unresponsive. All
            local node earnings will be paused until Docker is restarted.
          </div>
        )}
      </div>
    </div>
  );
}

function SystemCard({
  overview,
  loaded,
}: {
  overview: DockerOverview | null;
  loaded: boolean;
}) {
  // Hide once we know Docker isn't reachable. While loading, render a
  // skeleton with placeholder rows so the right column is the same height
  // it'll be after data arrives.
  if (loaded && !overview?.reachable) return null;
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">System</div>
      </div>
      <div className="card-body flex flex-col gap-1.5 text-xs">
        <Row k="Engine" v={overview?.version ?? '—'} />
        <Row k="API" v={overview?.apiVersion ?? '—'} />
        <Row k="OS" v={overview?.os ?? '—'} />
        <Row k="Kernel" v={overview?.kernel ?? '—'} />
        <Row k="Arch" v={overview?.arch ?? '—'} />
        <Row k="CPUs" v={overview?.ncpu ? String(overview.ncpu) : '—'} />
        <Row
          k="Memory"
          v={overview?.totalMemoryMb ? `${(overview.totalMemoryMb / 1024).toFixed(1)} GB` : '—'}
        />
        <Row k="Root dir" v={overview?.rootDir ?? '—'} mono />
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span
        className={`truncate ${mono ? 'mono-inline' : ''}`}
        style={{ color: 'var(--text)' }}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-1 px-3 py-4 rounded"
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        minHeight: 78,
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      <div
        className="font-semibold text-lg leading-none tabular-nums"
        style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}

function reasonHeadline(reason: DockerOverview['reason']): string {
  switch (reason) {
    case 'desktop-not-installed':
      return 'Docker Desktop is not installed';
    case 'desktop-not-running':
      return 'Docker Desktop is not running';
    case 'engine-not-running':
      return 'The Docker Engine is not running';
    default:
      return 'The Docker daemon is unreachable';
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
