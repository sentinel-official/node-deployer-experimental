#!/usr/bin/env node
/**
 * Sentinel Node Manager — end-to-end CLI test harness.
 *
 * Connects to the local CLI server (Windows named pipe / Unix socket),
 * drives every CLI command group end-to-end against MAINNET, and verifies
 * any tx-emitting step on-chain via Sentinel RPC `tx_search`.
 *
 * RPC-first by project rule: every on-chain verification uses Tendermint
 * RPC `/tx_search`, never LCD `/cosmos/tx/v1beta1/...`.
 *
 * Pacing mirrors `Desktop/plans/scripts/universal-test.mjs`:
 *   - 7 s between any tx-emitting CLI command (chain rate limit).
 *   - 5 s poll for deploy.status, 600 s deploy timeout (full Docker keygen).
 *   - 60 s suite gap between sectioned phases (only if a section broadcast
 *     a tx and the next section will broadcast another).
 *
 * Cost (real money). The test broadcasts at most THREE transactions:
 *   1. wallet.send  — self-send 0.001 DVPN, paid fee ~0.000200 DVPN.
 *   2. nodes.updatePricing — MsgUpdateNodeDetails on the freshly deployed
 *      node, paid fee ~0.000300 DVPN.
 *   3. nodes.publishSpecs — specs:v1 self-MsgSend on the freshly deployed
 *      node, paid fee ~0.000200 DVPN at gas 250000. Idempotent: only
 *      broadcasts once per node (the second call inside phase 5 verifies
 *      the cached hash is returned without spending).
 * Total upper bound: ~0.0025 DVPN (≈ a fraction of a cent at typical
 * DVPN price). The wallet must have at least 0.5 DVPN free before this
 * harness will broadcast anything.
 *
 * Outputs:
 *   - Console: full sectioned report (matches Plan Manager universal-test
 *     formatting).
 *   - findings/<YYYY-MM-DD>-cli-e2e-real-money-report.md (tester-only).
 *   - tests/e2e/last-report.json (sanitized, safe for upstream inclusion
 *     if needed — addresses kept, no mnemonics, no secrets).
 *
 * Prereqs:
 *   - The Sentinel Node Manager app must be running.
 *   - The CLI server must be ON. Either:
 *       a) Click "Start" on the in-app CLI screen, or
 *       b) Launch the app with
 *            SNM_AUTO_START_CLI=1
 *            SNM_AUTO_START_CLI_TOKEN=i-understand-this-opens-a-local-control-channel
 *   - App wallet must hold ≥ 0.5 DVPN.
 *
 * Run:
 *   node tests/e2e/cli-e2e.mjs              # full real-money flow
 *   node tests/e2e/cli-e2e.mjs --dry-run    # everything except the two TXs
 *   node tests/e2e/cli-e2e.mjs --no-deploy  # skip deploy + node lifecycle
 */

import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import process from 'node:process';
import { spawn } from 'node:child_process';

// ─── config ─────────────────────────────────────────────────────────────────

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const NO_DEPLOY = ARGS.has('--no-deploy');
const NO_SSH_MOCK = ARGS.has('--no-ssh-mock');

const TX_GAP_MS = 7_000;
const POLL_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 10 * 60_000;
const PIPE_HELLO_TIMEOUT_MS = 8_000;
const RUN_TIMEOUT_MS = 90_000; // most cmds finish in <5s; deploy.start can be slower.

const RPC_POOL = [
  'https://rpc.sentinel.co:443',
  'https://sentinel-mainnet-rpc.autostake.com:443',
  'https://sentinel-rpc.polkachu.com:443',
];

const MIN_BALANCE_DVPN = 0.5;
const SELF_SEND_AMOUNT = 0.001;
const SELF_SEND_MEMO = `cli-e2e-${randHex(6)}`;

const RUN_ID = `e2e-${randHex(4)}`;
const E2E_MONIKER = `e2e-${randHex(4)}`;
const E2E_PORT = 7790; // default deploy port range; we only deploy when --no-deploy is absent.
const NEW_GB = 0.06;
const NEW_HR = 0.0011;

// ─── tiny utils ─────────────────────────────────────────────────────────────

function randHex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function section(title) {
  console.log('');
  console.log(`${C.bold}${C.cyan}── ${title} ──${C.reset}`);
}

function ok(name, detail) {
  console.log(`  ${C.green}✓${C.reset} ${name}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`);
  report.checks.push({ name, ok: true, detail });
}

function fail(name, detail) {
  console.log(`  ${C.red}✗${C.reset} ${name}  ${C.red}${detail ?? ''}${C.reset}`);
  report.checks.push({ name, ok: false, detail });
  report.failed.push({ name, detail });
}

function info(line) {
  console.log(`  ${C.dim}${line}${C.reset}`);
}

function warn(line) {
  console.log(`  ${C.yellow}⚠ ${line}${C.reset}`);
}

// ─── report ledger (matches plan-manager universal-test.mjs) ────────────────

const report = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  mode: DRY_RUN ? 'dry-run' : NO_DEPLOY ? 'no-deploy' : 'real-money',
  app: { walletAddress: null, balanceBefore: null, balanceAfter: null },
  endpoint: null,
  cliServer: { ok: false, sessionStartedAt: null },
  deploy: null, // { jobId, nodeId, operatorAddress, finalPhase, durationMs, lifecycle }
  txs: [], // [{ phase, action, hash, height, code, gasUsed, memo, note }]
  commands: [], // [{ name, ok, ms, error? }]
  checks: [], // [{ name, ok, detail? }]
  failed: [],
};

function recordTx(phase, action, txMeta, note) {
  report.txs.push({
    phase,
    action,
    hash: txMeta.hash,
    height: txMeta.height,
    code: txMeta.code,
    gasUsed: txMeta.gasUsed,
    memo: txMeta.memo,
    note,
    at: new Date().toISOString(),
  });
}

// ─── pipe client (NDJSON over Windows named pipe / Unix socket) ─────────────

class PipeClient {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = null;
    this.buf = '';
    this.welcome = null;
    this.pending = []; // [{ resolve, reject, deadline }]
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.endpoint);
      const onErr = (err) => {
        this.closed = true;
        reject(err);
      };
      this.socket.once('error', onErr);
      this.socket.once('connect', () => {
        this.socket.removeListener('error', onErr);
        this.socket.on('data', (b) => this.#onData(b));
        this.socket.on('error', () => {});
        this.socket.on('close', () => {
          this.closed = true;
          for (const p of this.pending) p.reject(new Error('Pipe closed mid-request'));
          this.pending.length = 0;
        });
        const helloDeadline = setTimeout(
          () => reject(new Error('Timed out waiting for welcome')),
          PIPE_HELLO_TIMEOUT_MS,
        );
        this.welcomeResolver = (msg) => {
          clearTimeout(helloDeadline);
          if (msg.mode === 'watcher') {
            reject(
              new Error(
                `CLI server is busy — another active client (${msg.holder ?? 'unknown'}) is connected. ` +
                  `Disconnect it from the in-app CLI screen and re-run.`,
              ),
            );
            return;
          }
          this.welcome = msg;
          resolve();
        };
        this.socket.write(JSON.stringify({ type: 'hello', client: 'agent' }) + '\n');
      });
    });
  }

  #onData(chunk) {
    this.buf += chunk.toString('utf8');
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'welcome') {
        if (this.welcomeResolver) {
          this.welcomeResolver(msg);
          this.welcomeResolver = null;
        }
        continue;
      }
      if (msg.type === 'busy') {
        // welcome handler will see mode:'watcher' and reject; we just record.
        this.busyHolder = msg.holder;
        continue;
      }
      if (msg.type === 'event') continue; // we don't need streaming events here.
      if (msg.type === 'result') {
        const p = this.pending.shift();
        if (p) {
          clearTimeout(p.deadline);
          p.resolve(msg);
        }
        continue;
      }
      if (msg.type === 'goodbye') continue;
    }
  }

  run(line) {
    if (this.closed) return Promise.reject(new Error('Pipe closed'));
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.deadline === deadline);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new Error(`Command timed out after ${RUN_TIMEOUT_MS}ms: ${line}`));
      }, RUN_TIMEOUT_MS);
      this.pending.push({ resolve, reject, deadline });
      this.socket.write(JSON.stringify({ type: 'run', line }) + '\n');
    });
  }

  close() {
    if (!this.socket) return;
    try {
      this.socket.write(JSON.stringify({ type: 'bye' }) + '\n');
    } catch {}
    try {
      this.socket.end();
    } catch {}
  }
}

// ─── command runner with timing + structured capture ────────────────────────

async function runCmd(client, line, opts = {}) {
  const cmdName = line.split(/\s+/)[0];
  const t0 = Date.now();
  let result;
  try {
    result = await client.run(line);
  } catch (err) {
    const ms = Date.now() - t0;
    report.commands.push({ name: cmdName, ok: false, ms, error: String(err.message || err) });
    if (!opts.expectFailure) fail(`${cmdName}`, `pipe error: ${err.message || err}`);
    return { ok: false, error: String(err.message || err) };
  }
  const ms = Date.now() - t0;
  report.commands.push({
    name: cmdName,
    ok: !!result.ok,
    ms,
    error: result.ok ? undefined : result.error,
  });
  return result;
}

function parseJSON(text) {
  if (typeof text !== 'string' || !text.trim() || text === '(ok — no value)') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Sentinel RPC verification (RPC-first; LCD never used) ──────────────────

function rpcCall(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(rpcUrl);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: '/',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': `sentinel-node-manager-cli-e2e/${RUN_ID}`,
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json.error) reject(new Error(`${json.error.code} ${json.error.message}`));
            else resolve(json.result);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('RPC timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function rpcAny(method, params) {
  let lastErr;
  for (const url of RPC_POOL) {
    try {
      const result = await rpcCall(url, method, params);
      return { result, used: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`All RPC endpoints failed: ${lastErr?.message ?? 'unknown'}`);
}

/** Verify a tx hash made it on-chain. Returns the tx_search-decoded record. */
async function verifyTxOnChain(hashHex, label) {
  // tx_search expects the hash WITHOUT 0x prefix and querying tx.hash.
  // Some RPCs are picky about quoting; use the standard form.
  const hashUpper = hashHex.toUpperCase().replace(/^0X/, '');
  // Retry up to ~25 s — committed-but-not-yet-indexed-on-this-node is normal
  // for a fresh broadcast.
  const deadline = Date.now() + 25_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const { result } = await rpcAny('tx_search', {
        query: `tx.hash='${hashUpper}'`,
        prove: false,
        page: '1',
        per_page: '1',
        order_by: 'desc',
      });
      const txs = result?.txs ?? [];
      if (txs.length > 0) {
        const tx = txs[0];
        const decoded = {
          hash: hashUpper,
          height: Number(tx.height),
          code: tx.tx_result?.code ?? 0,
          gasUsed: Number(tx.tx_result?.gas_used ?? 0),
          gasWanted: Number(tx.tx_result?.gas_wanted ?? 0),
          memo: undefined,
        };
        if (decoded.code === 0) ok(`${label} on-chain`, `block ${decoded.height} · gas ${decoded.gasUsed}`);
        else fail(`${label} on-chain`, `tx code ${decoded.code} (failed) at block ${decoded.height}`);
        return decoded;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(2_000);
  }
  fail(`${label} on-chain`, `not indexed within 25 s${lastErr ? `: ${lastErr.message}` : ''}`);
  return null;
}

// ─── phase implementations ───────────────────────────────────────────────────

async function phase0_health(client) {
  section('Phase 0 — server reachability + chain health');
  const sysReportRes = await runCmd(client, 'system.report');
  if (!sysReportRes.ok) fail('system.report', sysReportRes.error);
  else {
    const sr = parseJSON(sysReportRes.text);
    ok('system.report', `${sr?.platform ?? '?'} · docker:${sr?.dockerRunning ?? '?'}`);
  }

  // Probe up to 3× — on a cold start the RPC pool can need a moment to warm.
  let reachable = 0;
  let lastErr = '';
  let total = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const chainRes = await runCmd(client, 'settings.chainHealth');
    if (!chainRes.ok) {
      lastErr = chainRes.error || 'runCmd failed';
    } else {
      const ch = parseJSON(chainRes.text);
      const arr = Array.isArray(ch) ? ch : Array.isArray(ch?.rpc) ? ch.rpc : [];
      total = arr.length;
      reachable = arr.filter((e) => e?.reachable ?? e?.ok).length;
      if (reachable >= 1) {
        ok(
          'settings.chainHealth',
          attempt === 1
            ? `${reachable}/${total} RPC endpoint(s) reachable`
            : `${reachable}/${total} RPC endpoint(s) reachable (attempt ${attempt})`,
        );
        return;
      }
      lastErr = `no RPC endpoints reachable (${total} probed)`;
    }
    if (attempt < 3) {
      info(`settings.chainHealth attempt ${attempt} found 0 reachable; retrying in 2 s`);
      await sleep(2_000);
    }
  }
  fail('settings.chainHealth', lastErr || 'no RPC endpoints reachable');
}

async function phase1_inventory(client) {
  section('Phase 1 — read-only inventory');

  const wRes = await runCmd(client, 'wallet.get');
  if (!wRes.ok) {
    fail('wallet.get', wRes.error);
    throw new Error('wallet.get failed — cannot continue');
  }
  const wallet = parseJSON(wRes.text);
  if (!wallet?.address) {
    fail('wallet.get', 'no wallet configured — set one up in the app first');
    throw new Error('No app wallet');
  }
  report.app.walletAddress = wallet.address;
  report.app.balanceBefore = wallet.balanceDVPN ?? wallet.balance ?? 0;
  ok('wallet.get', `${wallet.address.slice(0, 12)}…  balance=${report.app.balanceBefore} DVPN`);

  if (!DRY_RUN && (report.app.balanceBefore ?? 0) < MIN_BALANCE_DVPN) {
    fail(
      'wallet balance check',
      `need ≥ ${MIN_BALANCE_DVPN} DVPN, have ${report.app.balanceBefore}`,
    );
    throw new Error('Insufficient balance for real-money phase');
  }
  ok('wallet balance check', `≥ ${MIN_BALANCE_DVPN} DVPN`);

  const refresh = await runCmd(client, 'wallet.refreshBalance');
  if (refresh.ok) ok('wallet.refreshBalance');
  else fail('wallet.refreshBalance', refresh.error);

  const nl = await runCmd(client, 'nodes.list');
  if (nl.ok) {
    const nodes = parseJSON(nl.text) ?? [];
    ok('nodes.list', `${Array.isArray(nodes) ? nodes.length : 0} node(s)`);
  } else fail('nodes.list', nl.error);

  const ev = await runCmd(client, 'events.list --limit 5');
  if (ev.ok) ok('events.list');
  else fail('events.list', ev.error);

  const dov = await runCmd(client, 'docker.overview');
  if (dov.ok) {
    const d = parseJSON(dov.text);
    ok('docker.overview', `running:${d?.running ?? '?'} containers:${d?.containers ?? '?'}`);
  } else fail('docker.overview', dov.error);

  const upd = await runCmd(client, 'updater.status');
  if (upd.ok) ok('updater.status');
  else fail('updater.status', upd.error);

  const sg = await runCmd(client, 'settings.get');
  if (sg.ok) ok('settings.get');
  else fail('settings.get', sg.error);

  // qrSvg returns a string (SVG); just confirm it starts with `<svg`.
  const qr = await runCmd(client, `wallet.qrSvg --text ${wallet.address}`);
  if (qr.ok && /<svg[\s>]/.test(qr.text)) ok('wallet.qrSvg');
  else fail('wallet.qrSvg', qr.error || 'no <svg> in output');

  return wallet;
}

async function phase2_negative(client) {
  section('Phase 2 — validation contract (negative cases)');

  const r1 = await runCmd(client, 'nodes.get', { expectFailure: true });
  if (!r1.ok && /Missing positional/.test(r1.error || '')) ok('nodes.get without id rejects', r1.error);
  else fail('nodes.get without id rejects', r1.ok ? 'unexpectedly succeeded' : r1.error);

  const r2 = await runCmd(client, 'wallet.send', { expectFailure: true });
  if (!r2.ok && /Missing required/.test(r2.error || '')) ok('wallet.send without flags rejects');
  else fail('wallet.send without flags rejects', r2.ok ? 'unexpectedly succeeded' : r2.error);

  const r3 = await runCmd(
    client,
    'ssh.test --host 198.51.100.99 --port 22 --username invalid_user_xyz --password totally-wrong',
    { expectFailure: true },
  );
  // Should succeed-as-call (returns {ok:false,error:...}) OR fail outright; both
  // are acceptable, but it must NOT crash the server.
  if (r3.ok || (r3.error && !/ENOTFOUND|EHOSTUNREACH/.test(r3.error))) ok('ssh.test on unreachable host');
  else fail('ssh.test on unreachable host', r3.error);
}

// ─── SSH mock target (Phase 2b) ─────────────────────────────────────────────

const SSH_MOCK = {
  image: 'lscr.io/linuxserver/openssh-server:latest',
  name: `snm-e2e-sshd-${randHex(4)}`,
  hostPort: 2222,
  username: 'snm',
  password: 'snm-e2e-mock',
};

function dockerExec(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
      : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}

async function waitForTcp(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (v) => {
        socket.destroy();
        resolve(v);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(2_000, () => done(false));
    });
    if (reachable) return true;
    await sleep(1_000);
  }
  return false;
}

async function startSshMock() {
  // Pre-pull (idempotent; logs first time, instant on cached).
  await dockerExec(['pull', SSH_MOCK.image], { timeoutMs: 120_000 });
  // Best-effort cleanup of any prior leftover with same name.
  await dockerExec(['rm', '-f', SSH_MOCK.name], { timeoutMs: 10_000 });
  const run = await dockerExec(
    [
      'run', '-d',
      '--name', SSH_MOCK.name,
      '-p', `${SSH_MOCK.hostPort}:2222`,
      '-e', 'PASSWORD_ACCESS=true',
      '-e', `USER_NAME=${SSH_MOCK.username}`,
      '-e', `USER_PASSWORD=${SSH_MOCK.password}`,
      '-e', 'SUDO_ACCESS=false',
      SSH_MOCK.image,
    ],
    { timeoutMs: 30_000 },
  );
  if (run.code !== 0) {
    return { ok: false, error: run.stderr.trim() || `docker run exited ${run.code}` };
  }
  const ready = await waitForTcp('127.0.0.1', SSH_MOCK.hostPort, 30_000);
  if (!ready) return { ok: false, error: 'sshd port did not open within 30s' };
  return { ok: true };
}

async function stopSshMock() {
  await dockerExec(['rm', '-f', SSH_MOCK.name], { timeoutMs: 15_000 });
}

async function phase2b_sshSmoke(client) {
  if (NO_SSH_MOCK) {
    section('Phase 2b — SSH mock (SKIPPED, --no-ssh-mock)');
    return;
  }
  section('Phase 2b — SSH path against mocked sshd-in-docker');

  const start = await startSshMock();
  if (!start.ok) {
    fail('ssh mock container start', start.error);
    return;
  }
  ok('ssh mock container start', `${SSH_MOCK.name} on 127.0.0.1:${SSH_MOCK.hostPort}`);

  // The mock generates a fresh ed25519 host key per container boot. Drop any
  // TOFU-pinned fingerprint from a previous run so this run isn't refused
  // for a "host key changed" mismatch.
  await runCmd(client, `ssh.forgetHostKey --host 127.0.0.1 --port ${SSH_MOCK.hostPort}`);

  // linuxserver/openssh-server boots under s6 supervision: the TCP listener
  // can be open ~5–10s before sshd is ready to negotiate KEX. Without this
  // grace + retry the very first ssh.test races the supervisor and reports
  // "Connection lost before handshake".
  await sleep(5_000);

  const cmd = `ssh.test --host 127.0.0.1 --port ${SSH_MOCK.hostPort} --username ${SSH_MOCK.username} --password ${SSH_MOCK.password}`;
  const MAX_ATTEMPTS = 4;
  const RETRY_GAP_MS = 3_000;

  try {
    let lastErr = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await runCmd(client, cmd);
      if (!res.ok) {
        lastErr = res.error || 'runCmd failed';
      } else {
        const parsed = parseJSON(res.text);
        if (parsed?.ok) {
          const detail = parsed.osInfo
            ? `authenticated · ${parsed.osInfo} · ${parsed.latencyMs ?? '?'}ms`
            : 'authenticated to mock sshd';
          ok(
            'ssh.test against mock',
            attempt === 1 ? detail : `${detail} (attempt ${attempt})`,
          );
          return;
        }
        lastErr = parsed?.message || res.text;
      }
      if (attempt < MAX_ATTEMPTS) {
        info(`ssh.test attempt ${attempt} failed (${lastErr}); retrying in ${RETRY_GAP_MS}ms`);
        await sleep(RETRY_GAP_MS);
      }
    }
    fail('ssh.test against mock', `${lastErr} (after ${MAX_ATTEMPTS} attempts)`);
  } finally {
    await stopSshMock();
    info(`teardown: removed ${SSH_MOCK.name}`);
  }
}

async function phase3_realMoneySend(client, wallet) {
  if (DRY_RUN) {
    section('Phase 3 — wallet.send (SKIPPED, dry-run)');
    return null;
  }
  section('Phase 3 — wallet.send (real money, self-send)');

  await sleep(TX_GAP_MS);
  const sendRes = await runCmd(
    client,
    `wallet.send --to ${wallet.address} --amount ${SELF_SEND_AMOUNT} --memo ${SELF_SEND_MEMO}`,
  );
  if (!sendRes.ok) {
    fail('wallet.send', sendRes.error);
    return null;
  }
  const sendOut = parseJSON(sendRes.text);
  const hash = sendOut?.txhash ?? sendOut?.hash ?? sendOut?.txHash;
  if (!hash) {
    fail('wallet.send', `no tx hash in response: ${JSON.stringify(sendOut)}`);
    return null;
  }
  ok('wallet.send broadcast', `hash ${hash.slice(0, 12)}… memo ${SELF_SEND_MEMO}`);

  const onChain = await verifyTxOnChain(hash, 'wallet.send');
  if (onChain) {
    onChain.memo = SELF_SEND_MEMO;
    recordTx('phase3', 'wallet.send (self)', onChain, `${SELF_SEND_AMOUNT} DVPN`);
  }
  return hash;
}

async function phase4_deploy(client) {
  if (NO_DEPLOY) {
    section('Phase 4 — deploy (SKIPPED, --no-deploy)');
    return null;
  }
  section(`Phase 4 — local deploy (${E2E_MONIKER})`);

  const startCmd =
    `deploy.start --target local --moniker ${E2E_MONIKER} ` +
    `--gb 0.05 --hr 0.001 --service wireguard --port ${E2E_PORT}`;
  const startRes = await runCmd(client, startCmd);
  if (!startRes.ok) {
    fail('deploy.start', startRes.error);
    return null;
  }
  const startOut = parseJSON(startRes.text);
  const jobId = startOut?.jobId;
  const nodeId = startOut?.nodeId;
  if (!jobId || !nodeId) {
    fail('deploy.start', `missing jobId/nodeId: ${JSON.stringify(startOut)}`);
    return null;
  }
  ok('deploy.start', `jobId=${jobId.slice(0, 8)}… nodeId=${nodeId.slice(0, 8)}…`);

  // Poll deploy.status until done / error / cancelled or timeout.
  const t0 = Date.now();
  let lastPhase = '';
  let finalFrame = null;
  while (Date.now() - t0 < DEPLOY_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const statusRes = await runCmd(client, `deploy.status ${jobId}`);
    if (!statusRes.ok) {
      fail('deploy.status', statusRes.error);
      break;
    }
    const frame = parseJSON(statusRes.text);
    if (!frame) {
      info('deploy.status returned null — job may have already finalized');
      break;
    }
    if (frame.phase !== lastPhase) {
      info(`phase=${frame.phase} ${frame.percent ?? ''}%  ${frame.message ?? ''}`);
      lastPhase = frame.phase;
    }
    if (frame.phase === 'done' || frame.phase === 'error' || frame.phase === 'cancelled') {
      finalFrame = frame;
      break;
    }
  }
  if (!finalFrame) {
    fail('deploy completed', `no terminal frame within ${DEPLOY_TIMEOUT_MS}ms`);
    return null;
  }
  if (finalFrame.phase === 'done') ok('deploy completed', `phase=done in ${Date.now() - t0}ms`);
  else {
    fail('deploy completed', `phase=${finalFrame.phase}: ${finalFrame.message ?? ''}`);
    return null;
  }
  // The CLI server redacts mnemonicForBackup so we never see the seed here. Good.
  if (finalFrame.mnemonicForBackup && finalFrame.mnemonicForBackup !== '[redacted — use the in-app reveal flow]') {
    fail('deploy.status redaction', `mnemonic leaked over CLI! got: ${finalFrame.mnemonicForBackup.slice(0, 20)}…`);
  } else {
    ok('deploy.status redaction', 'mnemonic redacted over CLI as expected');
  }

  report.deploy = {
    jobId,
    nodeId,
    operatorAddress: finalFrame.operatorAddress ?? null,
    finalPhase: finalFrame.phase,
    durationMs: Date.now() - t0,
    lifecycle: {},
  };
  return { jobId, nodeId, operatorAddress: finalFrame.operatorAddress };
}

async function phase5_inspect(client, deploy) {
  if (!deploy) return;
  section('Phase 5 — inspect deployed node');

  const g = await runCmd(client, `nodes.get ${deploy.nodeId}`);
  if (g.ok) {
    const node = parseJSON(g.text);
    ok('nodes.get', `moniker=${node?.moniker} status=${node?.status}`);
  } else fail('nodes.get', g.error);

  const s = await runCmd(client, `nodes.status ${deploy.nodeId}`);
  if (s.ok) ok('nodes.status');
  else fail('nodes.status', s.error);

  const h = await runCmd(client, `nodes.history ${deploy.nodeId} --window 1h`);
  if (h.ok) ok('nodes.history --window 1h');
  else fail('nodes.history --window 1h', h.error);

  const lg = await runCmd(client, `nodes.logs ${deploy.nodeId}`);
  if (lg.ok) ok('nodes.logs');
  else fail('nodes.logs', lg.error);

  // nodes.publishSpecs — specs:v1 self-MsgSend memo. Triggered automatically
  // post-deploy; calling it explicitly here both proves the CLI surface
  // works AND asserts the idempotency contract (second call must return the
  // cached txHash without spending again).
  if (DRY_RUN) {
    ok('nodes.publishSpecs (SKIPPED, dry-run)');
    return;
  }
  await sleep(TX_GAP_MS);
  const ps1 = await runCmd(client, `nodes.publishSpecs ${deploy.nodeId}`);
  if (!ps1.ok) {
    fail('nodes.publishSpecs', ps1.error);
    return;
  }
  const out1 = parseJSON(ps1.text);
  const hash1 = out1?.txHash;
  if (!hash1) {
    fail('nodes.publishSpecs', `no txHash in result: ${JSON.stringify(out1)}`);
    return;
  }
  ok('nodes.publishSpecs', `hash ${hash1.slice(0, 12)}…`);

  // Idempotency assertion: re-running must return the SAME hash without a
  // fresh broadcast. The auto-publish hook in deploy.ts may already have
  // populated specsTxHash, in which case ps1 itself was a cache hit — the
  // second call still has to match.
  const ps2 = await runCmd(client, `nodes.publishSpecs ${deploy.nodeId}`);
  if (!ps2.ok) {
    fail('nodes.publishSpecs (idempotency)', ps2.error);
    return;
  }
  const hash2 = parseJSON(ps2.text)?.txHash;
  if (hash2 === hash1) ok('nodes.publishSpecs idempotent', `same hash on re-run`);
  else fail('nodes.publishSpecs idempotent', `hash drift: ${hash1} → ${hash2}`);
}

async function phase6_pricingTx(client, deploy) {
  if (!deploy) return null;
  if (DRY_RUN) {
    section('Phase 6 — nodes.updatePricing (SKIPPED, dry-run)');
    return null;
  }
  section('Phase 6 — nodes.updatePricing (real money)');
  await sleep(TX_GAP_MS);

  const upRes = await runCmd(
    client,
    `nodes.updatePricing --nodeId ${deploy.nodeId} --gb ${NEW_GB} --hr ${NEW_HR}`,
  );
  if (!upRes.ok) {
    fail('nodes.updatePricing', upRes.error);
    return null;
  }
  const upOut = parseJSON(upRes.text);
  const hash = upOut?.txhash ?? upOut?.hash ?? upOut?.txHash;
  if (!hash) {
    fail('nodes.updatePricing', `no tx hash: ${JSON.stringify(upOut)}`);
    return null;
  }
  ok('nodes.updatePricing broadcast', `hash ${hash.slice(0, 12)}…`);
  const onChain = await verifyTxOnChain(hash, 'nodes.updatePricing');
  if (onChain) recordTx('phase6', 'nodes.updatePricing', onChain, `gb=${NEW_GB} hr=${NEW_HR}`);
  return hash;
}

async function phase7_lifecycle(client, deploy) {
  if (!deploy) return;
  section('Phase 7 — node lifecycle (stop / start / restart)');

  const stop = await runCmd(client, `nodes.stop ${deploy.nodeId}`);
  if (stop.ok) ok('nodes.stop');
  else fail('nodes.stop', stop.error);
  if (report.deploy) report.deploy.lifecycle.stop = stop.ok;

  await sleep(2_000);
  const start = await runCmd(client, `nodes.start ${deploy.nodeId}`);
  if (start.ok) ok('nodes.start');
  else fail('nodes.start', start.error);
  if (report.deploy) report.deploy.lifecycle.start = start.ok;

  await sleep(2_000);
  const restart = await runCmd(client, `nodes.restart ${deploy.nodeId}`);
  if (restart.ok) ok('nodes.restart');
  else fail('nodes.restart', restart.error);
  if (report.deploy) report.deploy.lifecycle.restart = restart.ok;
}

async function phase8_cleanup(client, deploy) {
  if (!deploy) return;
  section('Phase 8 — cleanup (remove e2e node)');
  const rm = await runCmd(client, `nodes.remove ${deploy.nodeId}`);
  if (rm.ok) ok('nodes.remove');
  else fail('nodes.remove', rm.error);
  if (report.deploy) report.deploy.lifecycle.remove = rm.ok;
}

async function phase9_finalBalance(client) {
  section('Phase 9 — final balance + diagnostics bundle');

  const w = await runCmd(client, 'wallet.refreshBalance');
  if (w.ok) {
    const wallet = parseJSON(w.text);
    report.app.balanceAfter = wallet?.balanceDVPN ?? wallet?.balance ?? null;
    const delta =
      report.app.balanceAfter != null && report.app.balanceBefore != null
        ? Number(report.app.balanceBefore) - Number(report.app.balanceAfter)
        : null;
    ok(
      'wallet.refreshBalance (final)',
      `balance=${report.app.balanceAfter} DVPN  spent≈${delta != null ? delta.toFixed(6) : '?'} DVPN`,
    );
  } else fail('wallet.refreshBalance (final)', w.error);

  const diag = await runCmd(client, 'system.exportDiagnostics');
  if (diag.ok) {
    const d = parseJSON(diag.text);
    if (d?.ok && d.path) ok('system.exportDiagnostics', d.path);
    else fail('system.exportDiagnostics', d?.error || 'no path returned');
  } else fail('system.exportDiagnostics', diag.error);
}

// ─── summarize (mirrors plan-manager universal-test.mjs summary block) ──────

function summarize() {
  console.log('');
  console.log(`${C.bold}── Summary ──${C.reset}`);
  const passed = report.checks.filter((c) => c.ok).length;
  const failed = report.failed.length;
  console.log(
    `  Mode:          ${report.mode}` +
      (report.mode === 'real-money' ? `  ${C.yellow}(broadcast real DVPN)${C.reset}` : ''),
  );
  console.log(`  Run ID:        ${RUN_ID}`);
  console.log(`  Wallet:        ${report.app.walletAddress ?? '?'}`);
  console.log(
    `  Balance:       ${report.app.balanceBefore ?? '?'} → ${report.app.balanceAfter ?? '?'} DVPN`,
  );
  console.log(`  CLI endpoint:  ${report.endpoint ?? '?'}`);
  if (report.deploy) {
    console.log(
      `  Deploy:        nodeId=${report.deploy.nodeId.slice(0, 12)}…  ` +
        `phase=${report.deploy.finalPhase}  ${report.deploy.durationMs}ms`,
    );
  }

  if (report.txs.length) {
    console.log('');
    console.log(`  ${C.bold}On-chain TX ledger (RPC tx_search verified):${C.reset}`);
    for (const tx of report.txs) {
      const codeBadge = tx.code === 0 ? `${C.green}ok${C.reset}` : `${C.red}code ${tx.code}${C.reset}`;
      console.log(
        `    [${tx.phase}] ${tx.action.padEnd(28)}  ${tx.hash}  block ${tx.height}  ${codeBadge}` +
          (tx.note ? `  ${C.dim}${tx.note}${C.reset}` : ''),
      );
    }
  }

  console.log('');
  console.log(
    `  Checks:  ${C.green}${passed} passed${C.reset}  ` +
      (failed > 0 ? `${C.red}${failed} failed${C.reset}` : `${C.dim}0 failed${C.reset}`),
  );
  if (failed > 0) {
    for (const f of report.failed) {
      console.log(`    ${C.red}✗${C.reset} ${f.name} — ${f.detail ?? ''}`);
    }
  }
}

// ─── persist report files ───────────────────────────────────────────────────

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

async function persistReports() {
  // Sanitized JSON snapshot — safe to include in PR if useful (no secrets).
  const jsonPath = path.join(REPO_ROOT, 'tests', 'e2e', 'last-report.json');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`  ${C.dim}wrote ${path.relative(REPO_ROOT, jsonPath)}${C.reset}`);

  // Tester-only finding (per project rule, findings/ never goes upstream).
  const date = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(REPO_ROOT, 'findings', `${date}-cli-e2e-real-money-report.md`);
  const md = renderMarkdown(report);
  await fs.mkdir(path.dirname(mdPath), { recursive: true });
  await fs.writeFile(mdPath, md, 'utf8');
  console.log(`  ${C.dim}wrote ${path.relative(REPO_ROOT, mdPath)}${C.reset}`);
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`# CLI e2e — ${r.mode} (${r.runId})`);
  lines.push('');
  lines.push(`- Started: ${r.startedAt}`);
  lines.push(`- Finished: ${r.finishedAt}`);
  lines.push(`- Wallet: \`${r.app.walletAddress ?? '?'}\``);
  lines.push(`- Balance: ${r.app.balanceBefore ?? '?'} → ${r.app.balanceAfter ?? '?'} DVPN`);
  lines.push(`- CLI endpoint: \`${r.endpoint ?? '?'}\``);
  if (r.deploy) {
    lines.push(`- Deploy: nodeId=\`${r.deploy.nodeId}\`  phase=${r.deploy.finalPhase}  duration=${r.deploy.durationMs}ms`);
  }
  lines.push('');
  lines.push('## On-chain TX ledger');
  if (!r.txs.length) lines.push('_(no transactions broadcast)_');
  else {
    lines.push('| phase | action | hash | block | code | note |');
    lines.push('|---|---|---|---|---|---|');
    for (const t of r.txs)
      lines.push(`| ${t.phase} | ${t.action} | \`${t.hash}\` | ${t.height} | ${t.code} | ${t.note ?? ''} |`);
  }
  lines.push('');
  lines.push('## Commands exercised');
  lines.push('| command | ok | ms | error |');
  lines.push('|---|---|---|---|');
  for (const c of r.commands) lines.push(`| \`${c.name}\` | ${c.ok ? '✓' : '✗'} | ${c.ms} | ${c.error ?? ''} |`);
  lines.push('');
  lines.push('## Checks');
  lines.push('| check | ok | detail |');
  lines.push('|---|---|---|');
  for (const c of r.checks) lines.push(`| ${c.name} | ${c.ok ? '✓' : '✗'} | ${c.detail ?? ''} |`);
  if (r.failed.length) {
    lines.push('');
    lines.push('## Failures');
    for (const f of r.failed) lines.push(`- ${f.name}: ${f.detail ?? ''}`);
  }
  return lines.join('\n') + '\n';
}

// ─── main ───────────────────────────────────────────────────────────────────

async function readDiscovery() {
  const userData =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'sentinel-node-manager')
      : path.join(os.homedir(), '.config', 'sentinel-node-manager');
  const file = path.join(userData, 'cli-endpoint.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log(`${C.bold}Sentinel Node Manager — CLI e2e (${report.mode})${C.reset}`);
  console.log(`  run id ${RUN_ID}`);

  const disc = await readDiscovery();
  if (!disc?.endpoint) {
    console.log(`  ${C.red}✗ CLI endpoint discovery file not found.${C.reset}`);
    console.log(`    Start the CLI server from the in-app CLI screen, then re-run.`);
    process.exit(2);
  }
  report.endpoint = disc.endpoint;

  const client = new PipeClient(disc.endpoint);
  try {
    await client.connect();
  } catch (err) {
    console.log(`  ${C.red}✗ Could not connect to ${disc.endpoint}${C.reset}`);
    console.log(`    ${err.message}`);
    console.log('    Either the app is not running, or the CLI server is off, or another shell is holding it.');
    console.log('    On the in-app CLI screen, click "Start", make sure no other shell is connected, then re-run.');
    process.exit(2);
  }
  report.cliServer.ok = true;
  report.cliServer.sessionStartedAt = client.welcome?.sessionStartedAt ?? null;
  ok('CLI pipe connected as agent', `endpoint=${disc.endpoint}`);

  let exitCode = 0;
  try {
    await phase0_health(client);
    const wallet = await phase1_inventory(client);
    await phase2_negative(client);
    await phase2b_sshSmoke(client);
    await phase3_realMoneySend(client, wallet);
    const deploy = await phase4_deploy(client);
    await phase5_inspect(client, deploy);
    await phase6_pricingTx(client, deploy);
    await phase7_lifecycle(client, deploy);
    await phase8_cleanup(client, deploy);
    await phase9_finalBalance(client);
  } catch (err) {
    fail('harness aborted', err.message);
    exitCode = 1;
  } finally {
    client.close();
  }

  report.finishedAt = new Date().toISOString();
  summarize();
  await persistReports();
  if (report.failed.length > 0) exitCode = 1;
  console.log('');
  console.log(exitCode === 0 ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
