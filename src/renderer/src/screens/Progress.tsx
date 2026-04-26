import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ProgressRing } from '../components/ProgressRing';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { DeployPhase, DeployProgress } from '../../../shared/types';

interface Props {
  jobId: string;
  moniker: string;
}

const PHASE_LABEL: Record<DeployPhase, string> = {
  connecting: 'Establishing secure shell',
  preflight: 'Running preflight checks',
  'docker-check': 'Verifying Docker availability',
  'image-build': 'Preparing node image',
  keygen: 'Generating operator key',
  configure: 'Writing node configuration',
  starting: 'Starting node container',
  verifying: 'Waiting for first heartbeat',
  done: 'Node online',
  error: 'Deployment failed',
  cancelled: 'Deployment cancelled',
};

const PHASE_ORDER: DeployPhase[] = [
  'preflight',
  'connecting',
  'docker-check',
  'image-build',
  'keygen',
  'configure',
  'starting',
  'verifying',
  'done',
];

export function Progress({ jobId, moniker }: Props) {
  const { progress, navigate, setProgress, pushToast } = useApp();
  const logRef = useRef<HTMLPreElement | null>(null);
  // Each progress event carries its own log chunk; we splice every new chunk
  // into `lines`. Strict-mode runs effects twice in dev which would duplicate
  // each chunk — gate on the progress object identity so the same event never
  // gets consumed twice.
  const lastConsumedRef = useRef<DeployProgress | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [capturedMnemonic, setCapturedMnemonic] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [mnemonicVisible, setMnemonicVisible] = useState(false);

  useEffect(() => {
    if (!progress || progress.jobId !== jobId) return;
    if (lastConsumedRef.current === progress) return;
    lastConsumedRef.current = progress;
    setLines((prev) => {
      const next = [...prev];
      for (const line of (progress.log ?? '').split(/\r?\n/)) {
        if (line.trim()) next.push(line);
      }
      return next.slice(-500);
    });
    if (progress.mnemonicForBackup && !capturedMnemonic) {
      setCapturedMnemonic(progress.mnemonicForBackup);
    }
  }, [progress, jobId, capturedMnemonic]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length]);

  const isOurJob = progress && progress.jobId === jobId;
  const percent = isOurJob ? progress.percent : 0;
  const phase: DeployPhase = isOurJob ? progress.phase : 'connecting';
  const message = isOurJob ? progress.message : PHASE_LABEL[phase];
  const spinning = isOurJob && !['done', 'error'].includes(phase);
  const currentIdx = PHASE_ORDER.indexOf(phase);

  const onCancel = async () => {
    await window.api.deploy.cancel(jobId);
    setProgress(null);
    navigate({ name: 'nodes' });
  };

  const onDone = () => {
    if (capturedMnemonic && !backupConfirmed) {
      pushToast({
        title: 'Record the mnemonic before continuing',
        body: 'Confirm that you have stored the recovery phrase using the checkbox below.',
        tone: 'warn',
      });
      return;
    }
    setProgress(null);
    if (progress?.nodeId) navigate({ name: 'node-details', id: progress.nodeId });
    else navigate({ name: 'nodes' });
  };

  const statusTone =
    phase === 'done' ? 'chip-success' : phase === 'error' ? 'chip-danger' : 'chip-accent';
  const statusLabel =
    phase === 'done' ? 'Online' : phase === 'error' ? 'Failed' : 'In progress';

  return (
    <div className="flex flex-col h-full min-h-0 gap-4 overflow-y-auto">
      <PageHeader
        breadcrumb={
          <>
            Deploy · <span className="mono-inline">{jobId.slice(0, 13)}</span>
          </>
        }
        title={
          phase === 'done'
            ? 'Node deployed'
            : phase === 'error'
              ? 'Deployment failed'
              : 'Installing node'
        }
        subtitle={`Provisioning ${moniker}`}
        right={
          <>
            <span className={`chip ${statusTone}`}>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    phase === 'done'
                      ? 'var(--green)'
                      : phase === 'error'
                        ? 'var(--red)'
                        : 'var(--accent)',
                }}
              />
              {statusLabel}
            </span>
            {phase === 'done' ? (
              <button className="btn btn-primary" onClick={onDone}>
                <MIcon name="arrow_forward" size={14} />
                Open node
              </button>
            ) : phase === 'error' ? (
              <button className="btn btn-secondary" onClick={() => navigate({ name: 'nodes' })}>
                <MIcon name="arrow_back" size={14} />
                Back
              </button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={() => navigate({ name: 'overview' })}>
                  Run in background
                </button>
                <button className="btn btn-danger" onClick={onCancel}>
                  <MIcon name="close" size={14} />
                  Cancel
                </button>
              </>
            )}
          </>
        }
      />

      <div
        className={`grid grid-cols-12 gap-4 ${capturedMnemonic ? '' : 'flex-1 min-h-0'}`}
        style={capturedMnemonic ? { minHeight: 420 } : undefined}
      >
        <div className="card col-span-12 lg:col-span-4 flex flex-col">
          <div className="card-body flex flex-col items-center gap-4">
            <ProgressRing
              percent={percent}
              spinning={Boolean(spinning)}
              label={phase === 'done' ? 'Complete' : 'Progress'}
              sublabel={message}
            />
            <div className="text-center">
              <div
                className="text-[11px] uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Current phase
              </div>
              <div className="text-sm font-semibold mt-1" style={{ color: 'var(--text)' }}>
                {PHASE_LABEL[phase]}
              </div>
            </div>
          </div>

          <div
            className="px-[22px] py-4"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <div
              className="text-[11px] uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-muted)' }}
            >
              Pipeline
            </div>
            <ol className="flex flex-col gap-2">
              {PHASE_ORDER.slice(0, -1).map((p, idx) => {
                const state =
                  phase === 'error' && idx === currentIdx
                    ? 'error'
                    : idx < currentIdx || phase === 'done'
                      ? 'done'
                      : idx === currentIdx
                        ? 'active'
                        : 'pending';
                const dot =
                  state === 'done'
                    ? 'var(--green)'
                    : state === 'active'
                      ? 'var(--accent)'
                      : state === 'error'
                        ? 'var(--red)'
                        : 'var(--border-strong)';
                const textColor =
                  state === 'pending' ? 'var(--text-dim)' : 'var(--text)';
                return (
                  <li key={p} className="flex items-center gap-3 text-xs">
                    <span
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{
                        background: dot,
                        boxShadow:
                          state === 'active' ? '0 0 0 4px var(--accent-glow)' : 'none',
                      }}
                    />
                    <span style={{ color: textColor }}>{PHASE_LABEL[p]}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="card col-span-12 lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
          <div className="card-header">
            <div className="card-title flex items-center gap-2">
              <MIcon name="terminal" size={14} />
              Live deploy log
            </div>
            <span className="mono-tag">deploy.log</span>
          </div>
          <div className="flex-1 min-h-0 p-[22px]">
            <pre
              ref={logRef}
              className="h-full w-full overflow-auto text-[12px] leading-[1.65] whitespace-pre-wrap"
              style={{
                fontFamily: 'var(--font-mono)',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                padding: '14px 16px',
              }}
            >
              {lines.length ? lines.join('\n') : '[waiting for output…]'}
            </pre>
          </div>
        </div>
      </div>

      {capturedMnemonic && phase !== 'error' && (
        <div
          className="flex-shrink-0"
          style={{
            background: 'var(--yellow-dim)',
            border: '1px solid color-mix(in srgb, var(--yellow) 35%, transparent)',
            borderRadius: 'var(--radius)',
            padding: '10px 12px',
            color: 'var(--text)',
          }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div
              className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: 'var(--yellow)' }}
            >
              <MIcon name="warning" size={14} />
              Node operator recovery phrase — displayed once
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setMnemonicVisible((v) => !v)}
              >
                <MIcon name={mnemonicVisible ? 'visibility_off' : 'visibility'} size={12} />
                {mnemonicVisible ? 'Hide recovery phrase' : 'Show recovery phrase'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!mnemonicVisible}
                onClick={async () => {
                  await navigator.clipboard.writeText(capturedMnemonic);
                  pushToast({ title: 'Recovery phrase copied to clipboard', tone: 'success' });
                }}
              >
                <MIcon name="content_copy" size={12} />
                Copy
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  if (!progress?.nodeId) return;
                  const res = await window.api.nodes.backupMnemonic(
                    progress.nodeId,
                    capturedMnemonic,
                  );
                  if (res.ok) pushToast({ title: 'Encrypted backup saved', tone: 'success' });
                  else pushToast({ title: 'Unable to save backup', body: res.error, tone: 'error' });
                }}
              >
                <MIcon name="lock" size={12} />
                Save backup
              </button>
            </div>
          </div>
          <div
            className="mt-2 grid"
            style={{
              gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
              gap: 4,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 10px',
            }}
          >
            {capturedMnemonic.trim().split(/\s+/).map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 min-w-0"
                style={{ padding: '3px 6px' }}
              >
                <span
                  className="tabular-nums flex-shrink-0"
                  style={{ color: 'var(--text-dim)', fontSize: 9, width: 14 }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className="truncate"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: mnemonicVisible ? 'var(--text)' : 'var(--text-dim)',
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: mnemonicVisible ? 'normal' : '1px',
                  }}
                  title={mnemonicVisible ? word : 'hidden'}
                >
                  {mnemonicVisible ? word : '••••••'}
                </span>
              </div>
            ))}
          </div>
          <label
            className="mt-2 flex items-center gap-2 text-[11px] cursor-pointer select-none"
            style={{ color: 'var(--text-muted)' }}
          >
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            I have securely stored or backed up this node's recovery phrase.
          </label>
        </div>
      )}
    </div>
  );
}
