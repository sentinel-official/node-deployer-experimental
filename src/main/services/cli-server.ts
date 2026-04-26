/**
 * Local CLI server.
 *
 * Speaks newline-delimited JSON over a Windows named pipe
 * (`\\.\pipe\sentinel-node-manager-<userid>`) or a unix domain socket
 * (`~/.sentinel-node-manager/cli.sock`). Single-active-client lock model: at most
 * one client (the in-app prompt OR a PowerShell session OR an AI agent)
 * can execute commands at a time. Other parties become read-only watchers
 * via the in-app stream view.
 *
 * Protocol (each line is a JSON object terminated by '\n'):
 *   client → server:
 *     { type: 'hello', client: 'shell' | 'agent' }
 *     { type: 'run',   line: string }
 *     { type: 'bye' }
 *   server → client:
 *     { type: 'welcome', endpoint, sessionStartedAt }
 *     { type: 'event', event: CliStreamEvent }
 *     { type: 'result', ok, text?, error? }
 *     { type: 'busy', holder: 'app' | 'shell' | 'agent' }
 *     { type: 'goodbye' }
 *
 * The in-app prompt does NOT connect over the pipe — it calls runFromApp()
 * directly and gets the same broadcast events. This keeps round-trip
 * latency for the GUI low and avoids a self-loopback when the renderer is
 * the active client.
 */

import { BrowserWindow, app } from 'electron';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IPC, type CliClientKind, type CliServerState, type CliStreamEvent } from '../../shared/types';
import { log } from './logger';
import { runCommand, type RunResult } from './cli-registry';

let server: net.Server | null = null;
let endpoint: string | null = null;
let discoveryPath: string | null = null;
let sessionStartedAt: string | null = null;
let activeHolder: CliClientKind | null = null;
let activeShellSocket: net.Socket | null = null;
let lastError: string | null = null;
let seq = 0;
const watcherSockets = new Set<net.Socket>();

function broadcastState(): void {
  const state = currentState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.CLI_STATE_CHANGED, state);
  }
}

function broadcastEvent(ev: Omit<CliStreamEvent, 'seq' | 'ts'>): void {
  const event: CliStreamEvent = { ...ev, seq: ++seq, ts: new Date().toISOString() };
  // Renderer (read-only when shell-active, live mirror always)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.CLI_STREAM, event);
  }
  // Watcher pipe sockets get the same stream so AI agents can passively tail.
  for (const sock of watcherSockets) {
    try {
      sock.write(JSON.stringify({ type: 'event', event }) + '\n');
    } catch {
      /* swallow — socket cleanup will catch it */
    }
  }
  // The active shell socket also gets the event so its terminal stays in sync
  // with what the in-app screen would have printed.
  if (activeShellSocket && activeHolder !== 'app') {
    try {
      activeShellSocket.write(JSON.stringify({ type: 'event', event }) + '\n');
    } catch {
      /* ignore */
    }
  }
}

function currentState(): CliServerState {
  const status = !server
    ? 'off'
    : activeHolder === 'app'
      ? 'app-active'
      : activeHolder === 'shell'
        ? 'shell-active'
        : activeHolder === 'agent'
          ? 'agent-active'
          : 'off';
  return {
    status,
    endpoint,
    sessionStartedAt,
    discoveryPath,
    error: lastError,
  };
}

export function getCliState(): CliServerState {
  return currentState();
}

// ─── endpoint paths ──────────────────────────────────────────────────────────

function defaultEndpoint(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\sentinel-node-manager-${os.userInfo().username || 'default'}`;
  }
  return path.join(os.homedir(), '.sentinel-node-manager', 'cli.sock');
}

function discoveryFile(): string {
  return path.join(app.getPath('userData'), 'cli-endpoint.json');
}

async function writeDiscovery(): Promise<void> {
  if (!endpoint) return;
  const file = discoveryFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        endpoint,
        platform: process.platform,
        pid: process.pid,
        startedAt: sessionStartedAt,
      },
      null,
      2,
    ),
    'utf8',
  );
  discoveryPath = file;
}

async function clearDiscovery(): Promise<void> {
  discoveryPath = null;
  try {
    await fs.unlink(discoveryFile());
  } catch {
    /* not present, fine */
  }
}

// ─── server lifecycle ────────────────────────────────────────────────────────

export async function startCliServer(): Promise<CliServerState> {
  if (server) return currentState();

  endpoint = defaultEndpoint();
  sessionStartedAt = new Date().toISOString();
  lastError = null;
  seq = 0;
  activeHolder = 'app'; // in-app prompt always becomes the initial holder
  activeShellSocket = null;
  watcherSockets.clear();

  // On unix, stale socket file would block bind.
  if (process.platform !== 'win32') {
    try {
      await fs.mkdir(path.dirname(endpoint), { recursive: true });
      await fs.unlink(endpoint);
    } catch {
      /* not present */
    }
  }

  await new Promise<void>((resolve, reject) => {
    const s = net.createServer(handleConnection);
    s.on('error', (err) => {
      lastError = err.message;
      reject(err);
    });
    s.listen(endpoint as string, () => {
      server = s;
      resolve();
    });
  }).catch(async (err) => {
    log.warn('cli server listen failed', { err: String(err), endpoint });
    server = null;
    activeHolder = null;
    sessionStartedAt = null;
    endpoint = null;
    broadcastState();
    throw err;
  });

  await writeDiscovery();
  log.info('cli server listening', { endpoint });
  broadcastState();
  broadcastEvent({
    source: 'system',
    kind: 'info',
    text: `CLI server listening on ${endpoint}. Active holder: app.`,
  });
  return currentState();
}

export async function stopCliServer(): Promise<CliServerState> {
  if (!server) return currentState();
  // Politely tell the active shell client we're shutting down.
  if (activeShellSocket) {
    try {
      activeShellSocket.write(JSON.stringify({ type: 'goodbye' }) + '\n');
      activeShellSocket.end();
    } catch {
      /* ignore */
    }
    activeShellSocket = null;
  }
  for (const sock of watcherSockets) {
    try {
      sock.end();
    } catch {
      /* ignore */
    }
  }
  watcherSockets.clear();

  await new Promise<void>((resolve) => {
    server?.close(() => resolve());
  });
  server = null;
  activeHolder = null;
  endpoint = null;
  sessionStartedAt = null;
  await clearDiscovery();
  broadcastEvent({ source: 'system', kind: 'info', text: 'CLI server stopped.' });
  broadcastState();
  return currentState();
}

// ─── connection handling ─────────────────────────────────────────────────────

interface PendingClient {
  client: CliClientKind | null;
  buf: string;
}

function handleConnection(socket: net.Socket): void {
  const meta: PendingClient = { client: null, buf: '' };

  socket.on('data', (chunk) => {
    meta.buf += chunk.toString('utf8');
    let nl: number;
    while ((nl = meta.buf.indexOf('\n')) >= 0) {
      const line = meta.buf.slice(0, nl);
      meta.buf = meta.buf.slice(nl + 1);
      handleLine(socket, meta, line).catch((err) => {
        log.warn('cli connection error', { err: String(err) });
      });
    }
  });

  socket.on('close', () => {
    if (socket === activeShellSocket) {
      activeShellSocket = null;
      activeHolder = 'app';
      broadcastEvent({
        source: 'system',
        kind: 'info',
        text: 'Shell disconnected. In-app prompt re-enabled.',
      });
      broadcastState();
    } else if (watcherSockets.has(socket)) {
      watcherSockets.delete(socket);
    }
  });

  socket.on('error', (err) => {
    log.debug('cli socket error', { err: String(err) });
  });
}

async function handleLine(
  socket: net.Socket,
  meta: PendingClient,
  rawLine: string,
): Promise<void> {
  const line = rawLine.trim();
  if (!line) return;
  let msg: { type?: string; client?: CliClientKind; line?: string };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    socket.write(
      JSON.stringify({ type: 'result', ok: false, error: 'Malformed JSON.' }) + '\n',
    );
    return;
  }

  if (msg.type === 'hello') {
    const kind = msg.client === 'agent' ? 'agent' : 'shell';
    meta.client = kind;
    // Single-active-client lock: shell/agent takes over from the in-app prompt,
    // but only one shell/agent at a time. Any extra connections become
    // read-only watchers.
    if (activeHolder === 'shell' || activeHolder === 'agent') {
      watcherSockets.add(socket);
      socket.write(
        JSON.stringify({
          type: 'busy',
          holder: activeHolder,
        }) + '\n',
      );
      socket.write(
        JSON.stringify({
          type: 'welcome',
          endpoint,
          sessionStartedAt,
          mode: 'watcher',
        }) + '\n',
      );
      return;
    }
    activeHolder = kind;
    activeShellSocket = socket;
    socket.write(
      JSON.stringify({
        type: 'welcome',
        endpoint,
        sessionStartedAt,
        mode: 'active',
      }) + '\n',
    );
    broadcastEvent({
      source: 'system',
      kind: 'info',
      text: `${kind === 'shell' ? 'PowerShell' : 'AI agent'} connected. In-app prompt is now read-only.`,
    });
    broadcastState();
    return;
  }

  if (msg.type === 'bye') {
    socket.write(JSON.stringify({ type: 'goodbye' }) + '\n');
    socket.end();
    return;
  }

  if (msg.type === 'run') {
    if (socket !== activeShellSocket) {
      socket.write(
        JSON.stringify({
          type: 'result',
          ok: false,
          error: 'Not the active client (read-only watcher).',
        }) + '\n',
      );
      return;
    }
    const cmdLine = (msg.line ?? '').toString();
    broadcastEvent({
      source: meta.client ?? 'shell',
      kind: 'input',
      text: `$ ${cmdLine}`,
    });
    const result = await runCommand(cmdLine);
    if (result.ok) {
      broadcastEvent({ source: meta.client ?? 'shell', kind: 'ok', text: result.text });
    } else {
      broadcastEvent({
        source: meta.client ?? 'shell',
        kind: 'err',
        text: result.error ?? 'Unknown error',
      });
    }
    socket.write(JSON.stringify({ type: 'result', ...result }) + '\n');
    return;
  }

  socket.write(
    JSON.stringify({ type: 'result', ok: false, error: `Unknown message type: ${msg.type}` }) +
      '\n',
  );
}

// ─── in-app entry point ──────────────────────────────────────────────────────

/**
 * Called by the renderer's CLI screen via IPC. The in-app prompt only
 * works when the server is running and the holder is `app`. When a shell
 * is connected, the prompt is locked and this throws — the renderer
 * disables the input in that state, but we double-check here.
 */
export async function runFromApp(line: string): Promise<RunResult> {
  if (!server) {
    return { ok: false, text: '', error: 'CLI server is off. Start it first.' };
  }
  if (activeHolder !== 'app') {
    return {
      ok: false,
      text: '',
      error: `CLI is held by ${activeHolder}. Disconnect them to use the in-app prompt.`,
    };
  }
  broadcastEvent({ source: 'app', kind: 'input', text: `$ ${line}` });
  const result = await runCommand(line);
  if (result.ok) {
    broadcastEvent({ source: 'app', kind: 'ok', text: result.text });
  } else {
    broadcastEvent({
      source: 'app',
      kind: 'err',
      text: result.error ?? 'Unknown error',
    });
  }
  return result;
}

export function isCliServerRunning(): boolean {
  return server !== null;
}
