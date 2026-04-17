import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { LocalSystemReport, VpnServiceType } from '../../../shared/types';

/**
 * Deploy entry point.
 *
 * Left card: Docker health + moniker + pricing + service-type picker for
 * the local node. If Docker isn't reachable, the Initialize button stays
 * disabled and we surface the daemon error inline.
 * Right card: forward to Remote Setup (same fields, plus SSH creds).
 */
export function Deploy() {
  const { navigate, nodes, pushToast } = useApp();
  const [report, setReport] = useState<LocalSystemReport | null>(null);
  const [starting, setStarting] = useState(false);
  const [moniker, setMoniker] = useState(defaultMoniker());
  const [service, setService] = useState<VpnServiceType>('wireguard');
  const [gigabytePrice, setGigabytePrice] = useState('0.05');
  const [hourlyPrice, setHourlyPrice] = useState('0.001');
  const [port, setPort] = useState(7777);

  useEffect(() => {
    void window.api.system.report().then(setReport);
  }, []);

  const startLocal = async () => {
    setStarting(true);
    try {
      const { jobId } = await window.api.deploy.start({
        target: 'local',
        moniker: moniker.trim(),
        serviceType: service,
        gigabytePriceDVPN: Number(gigabytePrice) || 0,
        hourlyPriceDVPN: Number(hourlyPrice) || 0,
        port,
      });
      navigate({ name: 'progress', jobId, moniker: moniker.trim() });
    } catch (e) {
      pushToast({ title: 'Could not start deploy', body: (e as Error).message, tone: 'error' });
    } finally {
      setStarting(false);
    }
  };

  const localReady =
    report?.osCompatible && report?.memoryOk && report?.dockerReachable && moniker.trim().length >= 3;

  return (
    <div>
      <PageHeader
        title="Deploy a node"
        subtitle="Monetize your bandwidth by contributing to the decentralized VPN fleet. Choose where this node should run."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LOCAL */}
        <div className="card p-6 relative">
          <span className="absolute -top-2 right-5 chip-ok text-[10px]">This device</span>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center text-accent">
              <MIcon name="laptop_mac" size={22} />
            </div>
            <div>
              <div className="font-semibold text-text">Deploy on this PC</div>
              <div className="text-xs text-text-muted">
                Run sentinel-dvpnx in a Docker container on this machine.
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2.5">
            <Check
              label="OS compatibility"
              status={report ? (report.osCompatible ? 'ok' : 'err') : 'loading'}
              detail={report?.osLabel}
            />
            <Check
              label="Memory (RAM)"
              status={report ? (report.memoryOk ? 'ok' : 'warn') : 'loading'}
              detail={report ? `${(report.memoryMb / 1024).toFixed(1)} GB total` : undefined}
            />
            <Check
              label="Docker daemon"
              status={report ? (report.dockerReachable ? 'ok' : 'err') : 'loading'}
              detail={
                report
                  ? report.dockerReachable
                    ? report.dockerVersion ?? 'ok'
                    : (report.dockerError ?? 'not reachable').slice(0, 80)
                  : undefined
              }
            />
          </div>

          <div className="mt-5 space-y-3">
            <div>
              <div className="field-label">Moniker</div>
              <input
                value={moniker}
                onChange={(e) => setMoniker(e.target.value)}
                className="field-input font-mono"
                placeholder="my-dvpn-node"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="field-label">Service</div>
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value as VpnServiceType)}
                  className="field-input"
                >
                  <option value="wireguard">WireGuard</option>
                  <option value="v2ray">V2Ray</option>
                </select>
              </div>
              <div>
                <div className="field-label">Port</div>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 7777)}
                  className="field-input"
                />
              </div>
              <div>
                <div className="field-label">$P2P / GB</div>
                <input
                  type="number"
                  step="0.0001"
                  value={gigabytePrice}
                  onChange={(e) => setGigabytePrice(e.target.value)}
                  className="field-input"
                />
              </div>
            </div>
            <div>
              <div className="field-label">$P2P per hour (hourly plan)</div>
              <input
                type="number"
                step="0.0001"
                value={hourlyPrice}
                onChange={(e) => setHourlyPrice(e.target.value)}
                className="field-input"
              />
            </div>
          </div>

          <button
            onClick={startLocal}
            disabled={!report || starting || !localReady}
            className="btn-primary mt-6 w-full"
          >
            {starting ? 'Starting…' : 'Initialize local node'}
            <MIcon name="arrow_forward" size={14} />
          </button>

          {report && !report.dockerReachable && (
            <div className="mt-3 text-[11px] text-text-muted">
              Install{' '}
              <a
                href="https://www.docker.com/products/docker-desktop/"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-strong"
              >
                Docker Desktop
              </a>{' '}
              (macOS / Windows) or Docker Engine (Linux), then reopen this page.
            </div>
          )}
        </div>

        {/* REMOTE */}
        <div className="card p-6 flex flex-col">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-success/15 border border-success/30 grid place-items-center text-success">
              <MIcon name="cloud" size={22} />
            </div>
            <div>
              <div className="font-semibold text-text">Deploy on remote server</div>
              <div className="text-xs text-text-muted">
                We SSH into your VPS and run Docker-based install end-to-end.
              </div>
            </div>
          </div>

          <ul className="mt-5 space-y-2 text-sm text-text-muted">
            <li className="flex items-start gap-2">
              <MIcon name="check_circle" size={14} className="mt-0.5 text-success" />
              Works on Ubuntu / Debian hosts out of the box.
            </li>
            <li className="flex items-start gap-2">
              <MIcon name="check_circle" size={14} className="mt-0.5 text-success" />
              Installs Docker for you if missing.
            </li>
            <li className="flex items-start gap-2">
              <MIcon name="check_circle" size={14} className="mt-0.5 text-success" />
              SSH credentials live only in memory, never on disk.
            </li>
            <li className="flex items-start gap-2">
              <MIcon name="check_circle" size={14} className="mt-0.5 text-success" />
              Config is uploaded via SFTP, not interpolated into shell.
            </li>
          </ul>

          <div className="flex-1" />
          <button
            onClick={() => navigate({ name: 'remote-setup' })}
            className="btn-secondary mt-6 w-full"
          >
            Configure remote host
            <MIcon name="arrow_forward" size={14} />
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-xs text-text-dim">
        <span>
          {nodes.length} node{nodes.length === 1 ? '' : 's'} in inventory
        </span>
        <a
          className="text-accent hover:text-accent-strong inline-flex items-center gap-1"
          href="https://github.com/sentinel-official/sentinel-dvpnx"
          target="_blank"
          rel="noreferrer"
        >
          Upstream docs
          <MIcon name="open_in_new" size={12} />
        </a>
      </div>
    </div>
  );
}

function defaultMoniker(): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `dvpn-${suffix}`;
}

function Check({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'ok' | 'warn' | 'err' | 'loading';
  detail?: string;
}) {
  const ring =
    status === 'ok'
      ? 'bg-success/10 text-success border-success/30'
      : status === 'warn'
      ? 'bg-warning/10 text-warning border-warning/30'
      : status === 'err'
      ? 'bg-danger/10 text-danger border-danger/30'
      : 'bg-bg-elev text-text-muted border-border';
  const label_ = status === 'ok' ? 'Ready' : status === 'warn' ? 'Check' : status === 'err' ? 'Missing' : 'Checking…';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-input px-3 py-2.5">
      <div className="text-sm text-text">{label}</div>
      <div className="flex items-center gap-2 text-[11px]">
        {detail && <span className="text-text-dim truncate max-w-[260px]">{detail}</span>}
        <span className={`chip ${ring}`}>{label_}</span>
      </div>
    </div>
  );
}
