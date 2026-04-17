import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type {
  SSHCredentials,
  SSHTestResult,
  VpnServiceType,
} from '../../../shared/types';

export function RemoteSetup() {
  const { navigate, pushToast } = useApp();
  const [authMode, setAuthMode] = useState<'key' | 'password'>('key');
  const [form, setForm] = useState<SSHCredentials>({
    host: '',
    port: 22,
    username: 'root',
  });
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [password, setPassword] = useState('');

  const [moniker, setMoniker] = useState(`dvpn-${Math.random().toString(36).slice(2, 6)}`);
  const [service, setService] = useState<VpnServiceType>('wireguard');
  const [nodePort, setNodePort] = useState(7777);
  const [gigabytePrice, setGigabytePrice] = useState('0.05');
  const [hourlyPrice, setHourlyPrice] = useState('0.001');
  const [remoteUrl, setRemoteUrl] = useState('');

  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SSHTestResult | null>(null);
  const [deploying, setDeploying] = useState(false);

  const creds = (): SSHCredentials => ({
    ...form,
    port: Number(form.port) || 22,
    privateKey: authMode === 'key' ? privateKey : undefined,
    passphrase: authMode === 'key' && passphrase ? passphrase : undefined,
    password: authMode === 'password' ? password : undefined,
  });

  const runTest = async () => {
    setResult(null);
    setTesting(true);
    try {
      const r = await window.api.ssh.test(creds());
      setResult(r);
      if (r.ok) pushToast({ title: 'SSH works', body: `${r.latencyMs}ms · ${r.osInfo}`, tone: 'success' });
      else pushToast({ title: 'SSH failed', body: r.message, tone: 'error' });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const startDeploy = async () => {
    setDeploying(true);
    try {
      const { jobId } = await window.api.deploy.start({
        target: 'remote',
        moniker: moniker.trim(),
        serviceType: service,
        port: nodePort,
        gigabytePriceDVPN: Number(gigabytePrice) || 0,
        hourlyPriceDVPN: Number(hourlyPrice) || 0,
        // dvpnx validates remote_addrs as plain ip:port or dns:port — not a
        // URL. Strip any scheme the user may have pasted.
        remoteUrl: remoteUrl.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '') || undefined,
        ssh: creds(),
      });
      navigate({ name: 'progress', jobId, moniker: moniker.trim() });
    } catch (e) {
      pushToast({ title: 'Could not start deploy', body: (e as Error).message, tone: 'error' });
    } finally {
      setDeploying(false);
    }
  };

  const ready =
    form.host.trim() &&
    form.username.trim() &&
    moniker.trim().length >= 3 &&
    (authMode === 'key' ? privateKey.trim() : password.length > 0);

  return (
    <div>
      <PageHeader
        title="Remote server setup"
        subtitle="Securely connect your infrastructure to the Sentinel network. We support Ubuntu / Debian hosts with SSH (key or password)."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-6 lg:col-span-2">
          <div className="section-title mb-4 flex items-center gap-2">
            <MIcon name="security" size={14} /> SSH connection
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="md:col-span-2">
              <div className="field-label">Target host</div>
              <input
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="50.115.10.100 or node.example.com"
                className="field-input font-mono"
              />
            </div>
            <div>
              <div className="field-label">SSH port</div>
              <input
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 22 })}
                type="number"
                className="field-input"
              />
            </div>
          </div>

          <div className="mb-4">
            <div className="field-label">SSH username</div>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="root"
              className="field-input font-mono"
            />
          </div>

          <div className="field-label">Authentication</div>
          <div className="flex gap-2 mb-3">
            <button
              className={`flex-1 btn ${authMode === 'key' ? 'bg-accent text-white' : 'btn-secondary'}`}
              onClick={() => setAuthMode('key')}
            >
              <MIcon name="key" size={14} /> SSH private key
            </button>
            <button
              className={`flex-1 btn ${authMode === 'password' ? 'bg-accent text-white' : 'btn-secondary'}`}
              onClick={() => setAuthMode('password')}
            >
              <MIcon name="password" size={14} /> Password
            </button>
          </div>

          {authMode === 'key' ? (
            <>
              <textarea
                rows={5}
                placeholder={`-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----`}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="field-input font-mono text-xs"
              />
              <input
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                type="password"
                placeholder="Passphrase (optional)"
                className="field-input mt-2"
              />
            </>
          ) : (
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="SSH password"
              className="field-input"
            />
          )}

          <div className="section-title mt-6 mb-3 flex items-center gap-2">
            <MIcon name="dns" size={14} /> Node configuration
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="field-label">Moniker</div>
              <input
                value={moniker}
                onChange={(e) => setMoniker(e.target.value)}
                className="field-input font-mono"
              />
            </div>
            <div>
              <div className="field-label">Port</div>
              <input
                value={nodePort}
                onChange={(e) => setNodePort(Number(e.target.value) || 7777)}
                type="number"
                className="field-input"
              />
            </div>
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
              <div className="field-label">Public remote addr</div>
              <input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder={`${form.host || 'host'}:${nodePort}`}
                className="field-input font-mono"
              />
            </div>
            <div>
              <div className="field-label">$P2P / GB</div>
              <input
                value={gigabytePrice}
                onChange={(e) => setGigabytePrice(e.target.value)}
                type="number"
                step="0.0001"
                className="field-input"
              />
            </div>
            <div>
              <div className="field-label">$P2P / hour</div>
              <input
                value={hourlyPrice}
                onChange={(e) => setHourlyPrice(e.target.value)}
                type="number"
                step="0.0001"
                className="field-input"
              />
            </div>
          </div>

          {result && (
            <div
              className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
                result.ok
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
            >
              {result.ok ? (
                <>
                  <span className="font-semibold">Connected.</span> {result.latencyMs}ms — {result.osInfo}
                </>
              ) : (
                <>
                  <span className="font-semibold">Connection failed.</span> {result.message}
                </>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button className="btn-ghost" onClick={() => navigate({ name: 'deploy' })}>
              <MIcon name="arrow_back" size={14} />
              Back
            </button>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={runTest} disabled={!ready || testing}>
                {testing ? 'Testing…' : 'Test SSH connection'}
              </button>
              <button
                className="btn-primary"
                onClick={startDeploy}
                disabled={!ready || deploying || !(result?.ok)}
                title={!(result?.ok) ? 'Test the SSH connection first' : undefined}
              >
                {deploying ? 'Starting…' : 'Initiate secure deployment'}
                <MIcon name="arrow_forward" size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <div className="text-sm font-semibold mb-3">What happens next</div>
            <Step index={1} label="Open SSH + uname/docker probe" />
            <Step index={2} label="Install Docker if missing (get.docker.com)" />
            <Step index={3} label="Build sentinel-dvpnx image from pinned release" />
            <Step index={4} label="Run `sentinel-dvpnx init` — capture mnemonic + address" />
            <Step index={5} label="Upload config.toml via SFTP" />
            <Step index={6} label="docker run with --restart=unless-stopped" />
          </div>
          <div className="card-elev p-5 border-accent/30">
            <div className="text-xs uppercase tracking-wider text-accent font-semibold mb-1">
              Security
            </div>
            <p className="text-xs text-text-muted">
              Credentials live only in memory for the deploy. The node's own operator key is
              generated on the remote host by `sentinel-dvpnx init` — never transmitted
              over the wire.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ index, label }: { index: number; label: string }) {
  return (
    <div className="flex items-start gap-3 mb-2 last:mb-0">
      <div className="h-5 w-5 rounded-full bg-accent/20 text-accent text-[10px] grid place-items-center flex-shrink-0 font-semibold">
        {index}
      </div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}
