import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import { ProtocolTiles } from './DeployLocal';
import type {
  DeployPhase,
  DeployProgress,
  SSHCredentials,
  SSHTestResult,
  VpnServiceType,
} from '../../../shared/types';

type RowStatus =
  | 'idle'
  | 'testing'
  | 'test-ok'
  | 'test-fail'
  | 'queued'
  | 'deploying'
  | 'done'
  | 'error';

interface Row {
  id: string;
  host: string;
  port: number;
  username: string;
  moniker: string;
  nodePort: number;
  remoteUrlOverride: string;
  status: RowStatus;
  testMessage?: string;
  jobId?: string;
  phase?: DeployPhase;
  percent?: number;
  message?: string;
}

const TERMINAL_PHASES = new Set<DeployPhase>(['done', 'error', 'cancelled']);

function newRow(seed?: Partial<Row>): Row {
  return {
    id: Math.random().toString(36).slice(2, 10),
    host: '',
    port: 22,
    username: 'root',
    moniker: `dvpn-${Math.random().toString(36).slice(2, 6)}`,
    nodePort: 7777,
    remoteUrlOverride: '',
    status: 'idle',
    ...seed,
  };
}

function applyUrlPattern(pattern: string, host: string, nodePort: number): string {
  return pattern.replace(/\{host\}/g, host).replace(/\{port\}/g, String(nodePort));
}

function effectiveRemoteUrl(row: Row, pattern: string): string {
  const raw = row.remoteUrlOverride.trim() || applyUrlPattern(pattern.trim(), row.host, row.nodePort);
  return raw.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

function statusTone(s: RowStatus): { color: string; label: string } {
  switch (s) {
    case 'idle': return { color: 'var(--text-muted)', label: 'Idle' };
    case 'testing': return { color: 'var(--text)', label: 'Testing…' };
    case 'test-ok': return { color: 'var(--green)', label: 'SSH OK' };
    case 'test-fail': return { color: 'var(--red)', label: 'SSH failed' };
    case 'queued': return { color: 'var(--text-muted)', label: 'Queued' };
    case 'deploying': return { color: 'var(--accent)', label: 'Deploying' };
    case 'done': return { color: 'var(--green)', label: 'Done' };
    case 'error': return { color: 'var(--red)', label: 'Error' };
  }
}

export function DeploySshBatch() {
  const { navigate, pushToast } = useApp();

  // Shared SSH credentials.
  const [authMode, setAuthMode] = useState<'key' | 'password'>('key');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');

  // Shared deploy params.
  const [service, setService] = useState<VpnServiceType>('wireguard');
  const [gigabytePrice, setGigabytePrice] = useState('0.05');
  const [hourlyPrice, setHourlyPrice] = useState('0.001');
  const [remoteUrlPattern, setRemoteUrlPattern] = useState('{host}:{port}');

  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [paste, setPaste] = useState('');
  const [showCli, setShowCli] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  // Subscribe to deploy progress and merge into the matching row.
  useEffect(() => {
    const unsub = window.api.deploy.onProgress((p: DeployProgress) => {
      setRows((prev) => prev.map((r) => {
        if (r.jobId !== p.jobId) return r;
        const next: Row = { ...r, phase: p.phase, percent: p.percent, message: p.message };
        if (p.phase === 'done') next.status = 'done';
        else if (p.phase === 'error' || p.phase === 'cancelled') next.status = 'error';
        else next.status = 'deploying';
        return next;
      }));
    });
    return () => { try { unsub?.(); } catch { /* noop */ } };
  }, []);

  const sharedCreds = (host: string, port: number, username: string): SSHCredentials => ({
    host,
    port,
    username,
    privateKey: authMode === 'key' ? privateKey : undefined,
    passphrase: authMode === 'key' && passphrase ? passphrase : undefined,
    password: authMode === 'password' ? password : undefined,
  });

  const credentialsValid = authMode === 'key' ? privateKey.trim().length > 0 : password.length > 0;
  const validRows = rows.filter((r) => r.host.trim() && r.username.trim() && r.moniker.trim().length >= 3 && r.nodePort >= 1024 && r.nodePort <= 65535);
  const canRun = !running && credentialsValid && validRows.length > 0;
  const allTestedOk = validRows.length > 0 && validRows.every((r) => r.status === 'test-ok' || r.status === 'done');

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, newRow({ nodePort: 7777 + prev.length })]);
  const removeRow = (id: string) => setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)));

  const importPaste = () => {
    const lines = paste.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const parsed: Row[] = lines.slice(0, 50).map((line, idx) => {
      const parts = line.split(',').map((s) => s.trim());
      const host = parts[0] ?? '';
      const username = parts[1] || 'root';
      const sshPort = Number(parts[2]) || 22;
      const moniker = parts[3] || `dvpn-${Math.random().toString(36).slice(2, 6)}`;
      const np = Number(parts[4]);
      const nodePort = Number.isInteger(np) && np >= 1024 && np <= 65535 ? np : 7777 + idx;
      return newRow({ host, username, port: sshPort, moniker, nodePort });
    });
    setRows(parsed);
    setPaste('');
    pushToast({ title: 'Imported', body: `${parsed.length} host${parsed.length === 1 ? '' : 's'} loaded`, tone: 'success' });
  };

  const testAll = async () => {
    if (!credentialsValid) {
      pushToast({ title: 'Credentials missing', body: authMode === 'key' ? 'Paste a private key first.' : 'Enter the SSH password first.', tone: 'warn' });
      return;
    }
    const targets = rows.filter((r) => r.host.trim() && r.username.trim());
    if (targets.length === 0) return;

    setRows((prev) => prev.map((r) => (targets.find((t) => t.id === r.id) ? { ...r, status: 'testing', testMessage: undefined } : r)));

    await Promise.all(targets.map(async (r) => {
      try {
        const result: SSHTestResult = await window.api.ssh.test(sharedCreds(r.host.trim(), r.port, r.username.trim()));
        updateRow(r.id, {
          status: result.ok ? 'test-ok' : 'test-fail',
          testMessage: result.ok ? `${result.latencyMs}ms · ${result.osInfo}` : result.message,
        });
      } catch (e) {
        updateRow(r.id, { status: 'test-fail', testMessage: (e as Error).message });
      }
    }));
  };

  const deployAll = async () => {
    if (!canRun) return;
    if (!allTestedOk) {
      pushToast({ title: 'Test SSH first', body: 'Run "Test all" and resolve any failures before deploying.', tone: 'warn' });
      return;
    }
    setRunning(true);
    cancelRef.current = false;

    // Sequential chain broadcasts to avoid wallet sequence collisions.
    setRows((prev) => prev.map((r) => (validRows.find((v) => v.id === r.id) ? { ...r, status: 'queued', phase: undefined, percent: undefined, message: undefined } : r)));

    for (const row of validRows) {
      if (cancelRef.current) break;
      try {
        const { jobId } = await window.api.deploy.start({
          target: 'remote',
          moniker: row.moniker.trim(),
          serviceType: service,
          port: row.nodePort,
          gigabytePriceDVPN: Number(gigabytePrice) || 0,
          hourlyPriceDVPN: Number(hourlyPrice) || 0,
          remoteUrl: effectiveRemoteUrl(row, remoteUrlPattern) || undefined,
          ssh: sharedCreds(row.host.trim(), row.port, row.username.trim()),
        });
        updateRow(row.id, { jobId, status: 'deploying' });

        // Wait until this row reaches a terminal phase before broadcasting next.
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            const cur = rowsRef.current.find((x) => x.id === row.id);
            if (cur && cur.phase && TERMINAL_PHASES.has(cur.phase)) {
              clearInterval(timer);
              resolve();
            }
          }, 400);
        });
      } catch (e) {
        updateRow(row.id, { status: 'error', message: (e as Error).message });
      }
    }
    setRunning(false);
  };

  // Mirror rows into a ref so the deployAll loop can read the latest phase
  // without re-running the effect on every state change.
  const rowsRef = useRef<Row[]>(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const cliCommands = useMemo(() => {
    return validRows.map((r) => {
      const ssh: Record<string, unknown> = {
        host: r.host.trim(),
        port: r.port,
        username: r.username.trim(),
      };
      if (authMode === 'key') {
        ssh.privateKey = privateKey ? '<paste key here>' : '<paste key here>';
        if (passphrase) ssh.passphrase = '<passphrase>';
      } else {
        ssh.password = '<password>';
      }
      const url = effectiveRemoteUrl(r, remoteUrlPattern);
      const sshJson = JSON.stringify(ssh);
      const escapedSsh = sshJson.replace(/'/g, "'\\''");
      return `deploy.start --target remote --moniker ${r.moniker} --gb ${Number(gigabytePrice) || 0} --hr ${Number(hourlyPrice) || 0} --service ${service} --port ${r.nodePort}${url ? ` --remoteUrl ${url}` : ''} --ssh '${escapedSsh}'`;
    });
  }, [validRows, authMode, privateKey, passphrase, gigabytePrice, hourlyPrice, service, remoteUrlPattern]);

  const cliBlock = useMemo(() => cliCommands.join('\n\n'), [cliCommands]);

  const copyCli = async () => {
    try {
      await navigator.clipboard.writeText(cliBlock);
      pushToast({ title: 'Copied', body: `${cliCommands.length} command${cliCommands.length === 1 ? '' : 's'} on clipboard`, tone: 'success' });
    } catch (e) {
      pushToast({ title: 'Copy failed', body: (e as Error).message, tone: 'error' });
    }
  };

  // Aggregate header counts.
  const counts = useMemo(() => {
    const total = rows.length;
    const tested = rows.filter((r) => r.status === 'test-ok').length;
    const deploying = rows.filter((r) => r.status === 'deploying' || r.status === 'queued').length;
    const done = rows.filter((r) => r.status === 'done').length;
    const failed = rows.filter((r) => r.status === 'test-fail' || r.status === 'error').length;
    return { total, tested, deploying, done, failed };
  }, [rows]);

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <PageHeader
        title="Deploy SSH · Batch"
        subtitle="Provision many SSH targets in one pass. Chain broadcasts run one-at-a-time to keep wallet sequences clean."
        right={
          <div className="flex items-center gap-1 p-0.5 rounded-md" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate({ name: 'deploy-ssh' })}
              title="Switch to single host"
            >
              <MIcon name="dns" size={14} /> Single host
            </button>
            <button className="btn btn-primary btn-sm" style={{ pointerEvents: 'none' }} title="Batch">
              <MIcon name="grid_view" size={14} /> Batch
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left: hosts + controls */}
        <div className="card col-span-12 lg:col-span-8 flex flex-col min-h-0 overflow-hidden">
          <div className="card-header flex items-center justify-between">
            <div className="card-title flex items-center gap-2">
              <MIcon name="dns" size={14} />
              Hosts ({rows.length})
            </div>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span><b style={{ color: 'var(--green)' }}>{counts.tested}</b> tested</span>
              <span><b style={{ color: 'var(--accent)' }}>{counts.deploying}</b> in flight</span>
              <span><b style={{ color: 'var(--green)' }}>{counts.done}</b> done</span>
              <span><b style={{ color: 'var(--red)' }}>{counts.failed}</b> failed</span>
            </div>
          </div>
          <div className="card-body flex flex-col gap-2 flex-1 min-h-0 overflow-auto">
            {/* Paste import */}
            <details>
              <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                Paste CSV (host, user, sshPort, moniker, nodePort) — one per line
              </summary>
              <div className="flex flex-col gap-2 mt-2">
                <textarea
                  rows={3}
                  className="field-input mono-inline text-xs"
                  placeholder={'1.2.3.4, root, 22, dvpn-a, 7777\n5.6.7.8, root, 22, dvpn-b, 7778'}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <div className="flex justify-end">
                  <button className="btn btn-secondary btn-sm" onClick={importPaste} disabled={!paste.trim()}>
                    Import & replace rows
                  </button>
                </div>
              </div>
            </details>

            {/* Hosts table */}
            <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <div className="grid text-[11px] uppercase tracking-wider px-2 py-1.5"
                style={{ gridTemplateColumns: '1.6fr 0.5fr 0.8fr 1.1fr 0.6fr 1.4fr 0.9fr 28px', background: 'var(--bg-input)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <div>Host</div>
                <div>Port</div>
                <div>User</div>
                <div>Moniker</div>
                <div>Node port</div>
                <div>Public URL override</div>
                <div>Status</div>
                <div />
              </div>
              {rows.map((r) => {
                const tone = statusTone(r.status);
                const portValid = Number.isInteger(r.nodePort) && r.nodePort >= 1024 && r.nodePort <= 65535;
                return (
                  <div key={r.id} className="grid items-center px-2 py-1.5 gap-1"
                    style={{ gridTemplateColumns: '1.6fr 0.5fr 0.8fr 1.1fr 0.6fr 1.4fr 0.9fr 28px', borderBottom: '1px solid var(--border)' }}>
                    <input className="field-input mono-inline text-xs" value={r.host}
                      onChange={(e) => updateRow(r.id, { host: e.target.value })} placeholder="1.2.3.4" />
                    <input className="field-input text-xs" type="number" value={r.port}
                      onChange={(e) => updateRow(r.id, { port: Number(e.target.value) || 22 })} />
                    <input className="field-input mono-inline text-xs" value={r.username}
                      onChange={(e) => updateRow(r.id, { username: e.target.value })} />
                    <input className="field-input mono-inline text-xs" value={r.moniker}
                      onChange={(e) => updateRow(r.id, { moniker: e.target.value })} />
                    <input className="field-input text-xs" type="number" value={r.nodePort}
                      onChange={(e) => updateRow(r.id, { nodePort: Number(e.target.value) })}
                      aria-invalid={!portValid} />
                    <input className="field-input mono-inline text-xs" value={r.remoteUrlOverride}
                      onChange={(e) => updateRow(r.id, { remoteUrlOverride: e.target.value })}
                      placeholder={applyUrlPattern(remoteUrlPattern, r.host || 'host', r.nodePort)} />
                    <div className="text-[11px] flex flex-col">
                      <span style={{ color: tone.color, fontWeight: 600 }}>{tone.label}</span>
                      {r.status === 'deploying' && (
                        <span style={{ color: 'var(--text-muted)' }}>{r.percent ?? 0}% {r.phase ?? ''}</span>
                      )}
                      {r.testMessage && (r.status === 'test-ok' || r.status === 'test-fail') && (
                        <span className="truncate" title={r.testMessage} style={{ color: 'var(--text-muted)' }}>{r.testMessage}</span>
                      )}
                      {r.message && r.status === 'error' && (
                        <span className="truncate" title={r.message} style={{ color: 'var(--red)' }}>{r.message}</span>
                      )}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeRow(r.id)}
                      disabled={rows.length === 1 || running}
                      title="Remove row"
                      style={{ padding: 2 }}
                    >
                      <MIcon name="close" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button className="btn btn-secondary btn-sm" onClick={addRow} disabled={running || rows.length >= 50}>
                <MIcon name="add" size={14} /> Add host
              </button>
              <div className="flex items-center gap-2">
                <button className="btn btn-secondary" onClick={testAll} disabled={running || !credentialsValid}>
                  <MIcon name="network_check" size={14} /> Test all SSH
                </button>
                <button
                  className="btn btn-primary"
                  onClick={deployAll}
                  disabled={!canRun || !allTestedOk}
                  title={!allTestedOk ? 'Run "Test all" until every host shows SSH OK.' : undefined}
                >
                  {running ? 'Deploying…' : `Deploy all (${validRows.length})`}
                  <MIcon name="arrow_forward" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: shared creds + params + CLI panel */}
        <div className="col-span-12 lg:col-span-4 flex flex-col min-h-0 gap-3 overflow-auto">
          <div className="card flex flex-col overflow-hidden">
            <div className="card-header">
              <div className="card-title flex items-center gap-2">
                <MIcon name="security" size={14} />
                Shared credentials
              </div>
            </div>
            <div className="card-body flex flex-col gap-1.5">
              <div className="flex gap-2">
                <button className={`btn flex-1 btn-sm ${authMode === 'key' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAuthMode('key')}>
                  <MIcon name="key" size={14} /> SSH key
                </button>
                <button className={`btn flex-1 btn-sm ${authMode === 'password' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAuthMode('password')}>
                  <MIcon name="password" size={14} /> Password
                </button>
              </div>
              {authMode === 'key' ? (
                <>
                  <textarea
                    rows={2}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    className="field-input mono-inline text-xs"
                  />
                  <input
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    type="password"
                    placeholder="Passphrase (optional)"
                    className="field-input"
                  />
                </>
              ) : (
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="SSH password (shared)"
                  className="field-input"
                />
              )}
              <div className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
                Same credentials apply to every row. For per-host keys, use the CLI snippets below.
              </div>
            </div>
          </div>

          <div className="card flex flex-col overflow-hidden">
            <div className="card-header">
              <div className="card-title">Shared deploy params</div>
            </div>
            <div className="card-body flex flex-col gap-2">
              <div>
                <div className="field-label">Protocol</div>
                <ProtocolTiles value={service} onChange={setService} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="field-label">$P2P / GB</div>
                  <input value={gigabytePrice} onChange={(e) => setGigabytePrice(e.target.value)}
                    type="number" step="0.0001" min="0.0001" max="80" className="field-input" />
                </div>
                <div>
                  <div className="field-label">$P2P / hour</div>
                  <input value={hourlyPrice} onChange={(e) => setHourlyPrice(e.target.value)}
                    type="number" step="0.0001" min="0.0001" max="80" className="field-input" />
                </div>
              </div>
              <div>
                <div className="field-label">Public URL pattern</div>
                <input value={remoteUrlPattern} onChange={(e) => setRemoteUrlPattern(e.target.value)}
                  placeholder="{host}:{port}" className="field-input mono-inline" />
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>
                  Use <code>{'{host}'}</code> and <code>{'{port}'}</code>. Per-row overrides win.
                </div>
              </div>
            </div>
          </div>

          <div className="card flex flex-col overflow-hidden">
            <div className="card-header flex items-center justify-between">
              <div className="card-title flex items-center gap-2">
                <MIcon name="terminal" size={14} />
                Automate via CLI
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCli((v) => !v)}>
                {showCli ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="card-body flex flex-col gap-2 text-xs">
              <div style={{ color: 'var(--text-muted)' }}>
                Prefer scripting? Pipe these one-shot commands through{' '}
                <code className="mono-inline">sentinel-node-manager -e "&lt;cmd&gt;"</code> from your shell.
                Sequence them yourself to keep wallet broadcasts ordered.
              </div>
              <ol className="text-[11px] list-decimal pl-4 flex flex-col gap-1" style={{ color: 'var(--text-muted)' }}>
                <li>Start the in-app CLI server (Settings → CLI server, or auto-start).</li>
                <li>Replace <code>&lt;paste key here&gt;</code> / <code>&lt;password&gt;</code> with the real value (or read from a file in your shell).</li>
                <li>Run each line in order. Use <code>deploy.status &lt;jobId&gt;</code> to track each one.</li>
              </ol>
              {showCli && (
                <pre
                  className="text-[11px] mono-inline p-2 overflow-auto max-h-56"
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
{cliBlock || '# Add at least one valid host above to generate commands.'}
                </pre>
              )}
              <div className="flex items-center justify-between gap-2 mt-1">
                <button className="btn btn-secondary btn-sm" onClick={copyCli} disabled={cliCommands.length === 0}>
                  <MIcon name="content_copy" size={14} /> Copy {cliCommands.length || ''} command{cliCommands.length === 1 ? '' : 's'}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => navigate({ name: 'cli' })}>
                  Open CLI <MIcon name="arrow_forward" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
