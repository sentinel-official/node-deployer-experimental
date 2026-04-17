import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ProgressRing } from '../components/ProgressRing';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { DeployPhase } from '../../../shared/types';

interface Props {
  jobId: string;
  moniker: string;
}

const PHASE_LABEL: Record<DeployPhase, string> = {
  connecting: 'Opening secure shell',
  preflight: 'Preflight checks',
  'docker-check': 'Checking Docker',
  'image-build': 'Preparing node image',
  keygen: 'Generating operator key',
  configure: 'Writing node config',
  starting: 'Starting node container',
  verifying: 'Waiting for first heartbeat',
  done: 'Node is online',
  error: 'Deployment failed',
};

/**
 * Deploy progress screen.
 *
 *   • Live log stream piped from main's deploy.ts via IPC progress events.
 *   • During the keygen phase we capture the generated mnemonic and
 *     present a one-time backup dialog the user must acknowledge.
 */
export function Progress({ jobId, moniker }: Props) {
  const { progress, navigate, setProgress, pushToast } = useApp();
  const logRef = useRef<HTMLPreElement | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [capturedMnemonic, setCapturedMnemonic] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  useEffect(() => {
    if (!progress || progress.jobId !== jobId) return;
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

  const onCancel = async () => {
    await window.api.deploy.cancel(jobId);
    setProgress(null);
    navigate({ name: 'deploy' });
  };

  const onDone = () => {
    if (capturedMnemonic && !backupConfirmed) {
      pushToast({
        title: 'Write down the mnemonic first',
        body: 'Tick the confirmation below before leaving this screen.',
        tone: 'warn',
      });
      return;
    }
    setProgress(null);
    if (progress?.nodeId) navigate({ name: 'node-details', id: progress.nodeId });
    else navigate({ name: 'nodes' });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-dim">
        <span>Task ID</span>
        <span className="font-mono text-text-muted">{jobId.slice(0, 13)}</span>
      </div>
      <PageHeader
        title={phase === 'done' ? 'Node deployed' : phase === 'error' ? 'Deployment failed' : 'Installing node'}
        subtitle={`Provisioning ${moniker}`}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-4 overflow-y-auto pr-1">
        <div className="card p-6 lg:col-span-2 flex flex-col items-center h-fit">
          <ProgressRing
            percent={percent}
            spinning={Boolean(spinning)}
            label={phase === 'done' ? 'Complete' : 'Progress'}
            sublabel={message}
          />
          <div className="mt-6 text-center text-sm text-text-muted">{PHASE_LABEL[phase]}</div>

          <div className="mt-6 w-full flex gap-2">
            {phase === 'done' ? (
              <button className="btn-primary flex-1" onClick={onDone}>
                <MIcon name="arrow_forward" size={14} />
                Open node details
              </button>
            ) : phase === 'error' ? (
              <button className="btn-secondary flex-1" onClick={() => navigate({ name: 'deploy' })}>
                <MIcon name="arrow_back" size={14} />
                Back to deploy
              </button>
            ) : (
              <>
                <button className="btn-primary flex-1" onClick={() => navigate({ name: 'overview' })}>
                  Run in background
                </button>
                <button className="btn-secondary flex-1" onClick={onCancel}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div className="card lg:col-span-3 flex flex-col overflow-hidden h-full min-h-[320px]">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
            <div className="section-title flex items-center gap-2">
              <MIcon name="terminal" size={14} />
              Live deploy log
            </div>
            <span className="text-[10px] text-text-dim font-mono">deploy.log</span>
          </div>
          <pre
            ref={logRef}
            className="flex-1 min-h-0 p-4 text-[11px] font-mono text-text-muted overflow-y-auto bg-bg-soft leading-[1.6] whitespace-pre-wrap"
          >
{lines.length ? lines.join('\n') : '[waiting for output…]'}
          </pre>
        </div>
      </div>

      {capturedMnemonic && phase !== 'error' && (
        <div className="card-elev p-6 border-warning/40 mt-6">
          <div className="flex items-center gap-2 text-warning text-xs uppercase tracking-wider font-semibold mb-2">
            <MIcon name="warning" size={16} />
            Node operator mnemonic — shown exactly once
          </div>
          <div className="font-mono text-sm text-text bg-bg-input rounded-lg p-4 border border-border leading-relaxed break-words">
            {capturedMnemonic}
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            This is the key the node uses to sign on-chain messages. Store it securely — you
            can also save an encrypted backup inside this app.
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              className="btn-ghost text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(capturedMnemonic);
                pushToast({ title: 'Mnemonic copied', tone: 'success' });
              }}
            >
              <MIcon name="content_copy" size={14} />
              Copy
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={async () => {
                if (!progress?.nodeId) return;
                const res = await window.api.nodes.backupMnemonic(progress.nodeId, capturedMnemonic);
                if (res.ok) pushToast({ title: 'Encrypted backup saved', tone: 'success' });
                else pushToast({ title: 'Backup failed', body: res.error, tone: 'error' });
              }}
            >
              <MIcon name="lock" size={14} />
              Save encrypted backup in app
            </button>
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm text-text cursor-pointer select-none">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="h-4 w-4"
            />
            I have safely stored (or backed up) this node's mnemonic.
          </label>
        </div>
      )}
    </div>
  );
}
