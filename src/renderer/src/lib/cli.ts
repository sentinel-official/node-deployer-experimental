/**
 * In-app CLI command registry. Every command here proxies to a `window.api.*`
 * call so the same surface available to GUI screens is reachable from the
 * built-in terminal. Adding a new IPC handler? Mirror it here.
 *
 * Argument parsing is deliberately small: positional args first, then
 * `--flag value` pairs (or `--flag=value`, or boolean `--flag`). No quoting
 * gymnastics — values that contain spaces should be wrapped in double quotes.
 */

import type {
  AppSettings,
  DeployRequest,
  MetricsWindow,
  NodeWithdrawRequest,
  PriceMode,
  SendTxRequest,
  SSHCredentials,
  UpdateNodePricingRequest,
  VpnServiceType,
} from '../../../shared/types';

export interface CliArg {
  name: string;
  /** `positional` = required positional, `flag` = `--name value`, `bool` = `--name`. */
  kind: 'positional' | 'flag' | 'bool';
  required?: boolean;
  describe: string;
  /** Optional preset values shown in the reference panel (e.g. enums). */
  example?: string;
}

export interface CliCommand {
  name: string;
  group:
    | 'system'
    | 'docker'
    | 'settings'
    | 'wallet'
    | 'events'
    | 'updater'
    | 'ssh'
    | 'deploy'
    | 'nodes';
  summary: string;
  args: CliArg[];
  /** Long-form usage line shown in the reference panel. */
  usage: string;
  exec: (parsed: ParsedArgs) => Promise<unknown>;
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

// ─── tiny argv tokenizer ─────────────────────────────────────────────────────

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && i + 1 < line.length) {
        buf += line[++i];
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

export function parseArgs(tokens: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      if (eq > -1) {
        flags[t.slice(2, eq)] = t.slice(eq + 1);
      } else {
        const name = t.slice(2);
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const requireFlag = (p: ParsedArgs, name: string): string => {
  const v = p.flags[name];
  if (v === undefined) throw new Error(`Missing required --${name}`);
  if (typeof v !== 'string') throw new Error(`--${name} requires a value`);
  return v;
};

const optionalFlag = (p: ParsedArgs, name: string): string | undefined => {
  const v = p.flags[name];
  return typeof v === 'string' ? v : undefined;
};

const numberFlag = (p: ParsedArgs, name: string, required = false): number | undefined => {
  const v = p.flags[name];
  if (v === undefined) {
    if (required) throw new Error(`Missing required --${name}`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};

const requirePositional = (p: ParsedArgs, idx: number, label: string): string => {
  const v = p.positional[idx];
  if (!v) throw new Error(`Missing positional argument: ${label}`);
  return v;
};

const isVpnServiceType = (s: string): s is VpnServiceType =>
  s === 'wireguard' || s === 'v2ray';

const isMetricsWindow = (s: string): s is MetricsWindow =>
  s === '1h' || s === '24h' || s === '7d' || s === '30d';

// ─── command registry ────────────────────────────────────────────────────────

export const COMMANDS: CliCommand[] = [
  // ─── system ──────────────────────────────────────────────────────────────
  {
    name: 'system.report',
    group: 'system',
    summary: 'Local system + Docker reachability snapshot.',
    usage: 'system.report',
    args: [],
    exec: () => window.api.system.report(),
  },
  {
    name: 'system.exportDiagnostics',
    group: 'system',
    summary: 'Bundle store + settings + logs into a zip (opens save dialog).',
    usage: 'system.exportDiagnostics',
    args: [],
    exec: () => window.api.system.exportDiagnostics(),
  },

  // ─── docker ──────────────────────────────────────────────────────────────
  {
    name: 'docker.start',
    group: 'docker',
    summary: 'Spawn Docker Desktop (Windows / macOS only).',
    usage: 'docker.start',
    args: [],
    exec: () => window.api.docker.start(),
  },
  {
    name: 'docker.overview',
    group: 'docker',
    summary: 'Daemon stats: containers, images, sentinel containers/images.',
    usage: 'docker.overview',
    args: [],
    exec: () => window.api.docker.overview(),
  },
  {
    name: 'docker.quit',
    group: 'docker',
    summary: 'Politely quit Docker Desktop.',
    usage: 'docker.quit',
    args: [],
    exec: () => window.api.docker.quit(),
  },
  {
    name: 'docker.forceQuit',
    group: 'docker',
    summary: 'Force-kill Docker Desktop process tree.',
    usage: 'docker.forceQuit',
    args: [],
    exec: () => window.api.docker.forceQuit(),
  },
  {
    name: 'docker.stopAllSentinel',
    group: 'docker',
    summary: 'Stop every running Sentinel container managed by this app.',
    usage: 'docker.stopAllSentinel',
    args: [],
    exec: () => window.api.docker.stopAllSentinel(),
  },
  {
    name: 'docker.prune',
    group: 'docker',
    summary: 'Prune dangling Docker images.',
    usage: 'docker.prune',
    args: [],
    exec: () => window.api.docker.prune(),
  },

  // ─── settings ────────────────────────────────────────────────────────────
  {
    name: 'settings.get',
    group: 'settings',
    summary: 'Read the persisted app settings.',
    usage: 'settings.get',
    args: [],
    exec: () => window.api.settings.get(),
  },
  {
    name: 'settings.set',
    group: 'settings',
    summary: 'Patch one or more settings fields. Pass JSON via --json.',
    usage: 'settings.set --json \'{"minimizeToTrayOnClose":true}\'',
    args: [
      {
        name: 'json',
        kind: 'flag',
        required: true,
        describe: 'JSON object with the fields to patch.',
        example: '{"minimizeToTrayOnClose":true}',
      },
    ],
    exec: async (p) => {
      const raw = requireFlag(p, 'json');
      const patch = JSON.parse(raw) as Partial<AppSettings>;
      return window.api.settings.set(patch);
    },
  },
  {
    name: 'settings.chainHealth',
    group: 'settings',
    summary: 'Probe all configured RPC/LCD endpoints.',
    usage: 'settings.chainHealth',
    args: [],
    exec: () => window.api.settings.chainHealth(),
  },

  // ─── wallet ──────────────────────────────────────────────────────────────
  {
    name: 'wallet.get',
    group: 'wallet',
    summary: 'Current wallet (address, balance, hasMnemonic).',
    usage: 'wallet.get',
    args: [],
    exec: () => window.api.wallet.get(),
  },
  {
    name: 'wallet.create',
    group: 'wallet',
    summary: 'Generate a new wallet. Returns the mnemonic ONCE.',
    usage: 'wallet.create',
    args: [],
    exec: () => window.api.wallet.create(),
  },
  {
    name: 'wallet.restore',
    group: 'wallet',
    summary: 'Restore a wallet from a BIP-39 mnemonic.',
    usage: 'wallet.restore --mnemonic "word1 word2 ... word24"',
    args: [
      {
        name: 'mnemonic',
        kind: 'flag',
        required: true,
        describe: '12 or 24 word BIP-39 mnemonic.',
      },
    ],
    exec: (p) => window.api.wallet.restore(requireFlag(p, 'mnemonic')),
  },
  {
    name: 'wallet.refreshBalance',
    group: 'wallet',
    summary: 'Re-query the chain for the wallet balance.',
    usage: 'wallet.refreshBalance',
    args: [],
    exec: () => window.api.wallet.refreshBalance(),
  },
  {
    name: 'wallet.send',
    group: 'wallet',
    summary: 'Send DVPN from the app wallet.',
    usage: 'wallet.send --to sent1... --amount 1.5 [--memo "hello"]',
    args: [
      { name: 'to', kind: 'flag', required: true, describe: 'Recipient sent1… address.' },
      { name: 'amount', kind: 'flag', required: true, describe: 'Amount in DVPN (decimal).' },
      { name: 'memo', kind: 'flag', describe: 'Optional memo.' },
    ],
    exec: (p) => {
      const req: SendTxRequest = {
        to: requireFlag(p, 'to'),
        amountDVPN: numberFlag(p, 'amount', true) as number,
        memo: optionalFlag(p, 'memo'),
      };
      return window.api.wallet.send(req);
    },
  },
  {
    name: 'wallet.qrSvg',
    group: 'wallet',
    summary: 'Render an SVG QR code for any text.',
    usage: 'wallet.qrSvg --text sent1...',
    args: [{ name: 'text', kind: 'flag', required: true, describe: 'String to encode.' }],
    exec: (p) => window.api.wallet.qrSvg(requireFlag(p, 'text')),
  },
  {
    name: 'wallet.logout',
    group: 'wallet',
    summary: 'Wipe the app wallet from disk. (Destructive.)',
    usage: 'wallet.logout',
    args: [],
    exec: () => window.api.wallet.logout(),
  },

  // ─── events ──────────────────────────────────────────────────────────────
  {
    name: 'events.list',
    group: 'events',
    summary: 'Most recent app events (deploys, sends, errors…).',
    usage: 'events.list [--limit 50]',
    args: [{ name: 'limit', kind: 'flag', describe: 'Max number of events to return.' }],
    exec: (p) => window.api.events.list(numberFlag(p, 'limit')),
  },

  // ─── updater ─────────────────────────────────────────────────────────────
  {
    name: 'updater.status',
    group: 'updater',
    summary: 'Current auto-updater state.',
    usage: 'updater.status',
    args: [],
    exec: () => window.api.updater.status(),
  },
  {
    name: 'updater.check',
    group: 'updater',
    summary: 'Force a check for app updates.',
    usage: 'updater.check',
    args: [],
    exec: () => window.api.updater.check(),
  },
  {
    name: 'updater.install',
    group: 'updater',
    summary: 'Install a downloaded update and relaunch.',
    usage: 'updater.install',
    args: [],
    exec: () => window.api.updater.install(),
  },

  // ─── ssh ─────────────────────────────────────────────────────────────────
  {
    name: 'ssh.test',
    group: 'ssh',
    summary: 'Probe SSH credentials. Returns latency + remote OS info.',
    usage:
      'ssh.test --host 1.2.3.4 --port 22 --username root [--password ...] [--privateKey ...] [--passphrase ...]',
    args: [
      { name: 'host', kind: 'flag', required: true, describe: 'IP or hostname.' },
      { name: 'port', kind: 'flag', describe: 'SSH port (default 22).' },
      { name: 'username', kind: 'flag', required: true, describe: 'SSH user.' },
      { name: 'password', kind: 'flag', describe: 'Password (or use --privateKey).' },
      { name: 'privateKey', kind: 'flag', describe: 'PEM private key contents.' },
      { name: 'passphrase', kind: 'flag', describe: 'Passphrase if the key is encrypted.' },
    ],
    exec: (p) => {
      const creds: SSHCredentials = {
        host: requireFlag(p, 'host'),
        port: numberFlag(p, 'port') ?? 22,
        username: requireFlag(p, 'username'),
        password: optionalFlag(p, 'password'),
        privateKey: optionalFlag(p, 'privateKey'),
        passphrase: optionalFlag(p, 'passphrase'),
      };
      return window.api.ssh.test(creds);
    },
  },

  // ─── deploy ──────────────────────────────────────────────────────────────
  {
    name: 'deploy.start',
    group: 'deploy',
    summary:
      'Kick off a deploy job. Streams progress via deploy.onProgress; this command returns immediately with {jobId, nodeId}.',
    usage:
      'deploy.start --target local|remote --moniker foo --gb 0.05 --hr 0.001 --service wireguard|v2ray --port 7777 [--remoteUrl https://1.2.3.4:7777] [--ssh \'{...SSHCredentials JSON...}\']',
    args: [
      { name: 'target', kind: 'flag', required: true, describe: '"local" or "remote".' },
      { name: 'moniker', kind: 'flag', required: true, describe: 'Public node name.' },
      { name: 'gb', kind: 'flag', required: true, describe: '$P2P per gigabyte.' },
      { name: 'hr', kind: 'flag', required: true, describe: '$P2P per hour.' },
      {
        name: 'service',
        kind: 'flag',
        required: true,
        describe: 'VPN protocol: wireguard or v2ray.',
      },
      { name: 'port', kind: 'flag', required: true, describe: 'Public TCP/UDP port.' },
      { name: 'remoteUrl', kind: 'flag', describe: 'Public URL when target=remote.' },
      {
        name: 'ssh',
        kind: 'flag',
        describe: 'JSON-encoded SSHCredentials (required when target=remote).',
      },
    ],
    exec: (p) => {
      const target = requireFlag(p, 'target');
      if (target !== 'local' && target !== 'remote')
        throw new Error('--target must be "local" or "remote"');
      const service = requireFlag(p, 'service');
      if (!isVpnServiceType(service))
        throw new Error('--service must be "wireguard" or "v2ray"');
      const sshRaw = optionalFlag(p, 'ssh');
      const req: DeployRequest = {
        target,
        moniker: requireFlag(p, 'moniker'),
        gigabytePriceDVPN: numberFlag(p, 'gb', true) as number,
        hourlyPriceDVPN: numberFlag(p, 'hr', true) as number,
        serviceType: service,
        port: numberFlag(p, 'port', true) as number,
        remoteUrl: optionalFlag(p, 'remoteUrl'),
        ssh: sshRaw ? (JSON.parse(sshRaw) as SSHCredentials) : undefined,
      };
      return window.api.deploy.start(req);
    },
  },
  {
    name: 'deploy.cancel',
    group: 'deploy',
    summary: 'Cancel an in-flight deploy by jobId.',
    usage: 'deploy.cancel <jobId>',
    args: [
      {
        name: 'jobId',
        kind: 'positional',
        required: true,
        describe: 'Job id returned by deploy.start.',
      },
    ],
    exec: (p) => window.api.deploy.cancel(requirePositional(p, 0, 'jobId')),
  },
  {
    name: 'deploy.status',
    group: 'deploy',
    summary: 'Latest progress frame for a deploy. Omit jobId to list all.',
    usage: 'deploy.status [<jobId>]',
    args: [{ name: 'jobId', kind: 'positional', describe: 'Optional job id.' }],
    exec: (p) => window.api.deploy.status(p.positional[0]),
  },

  // ─── nodes ───────────────────────────────────────────────────────────────
  {
    name: 'nodes.list',
    group: 'nodes',
    summary: 'List every node managed by this app.',
    usage: 'nodes.list',
    args: [],
    exec: () => window.api.nodes.list(),
  },
  {
    name: 'nodes.get',
    group: 'nodes',
    summary: 'Fetch a single node by id.',
    usage: 'nodes.get <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.get(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.start',
    group: 'nodes',
    summary: 'Start a stopped node container/service.',
    usage: 'nodes.start <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.start(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.restart',
    group: 'nodes',
    summary: 'Restart a node container/service.',
    usage: 'nodes.restart <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.restart(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.stop',
    group: 'nodes',
    summary: 'Stop a running node.',
    usage: 'nodes.stop <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.stop(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.remove',
    group: 'nodes',
    summary: 'Remove a node from the app store. (Destructive.)',
    usage: 'nodes.remove <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.remove(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.logs',
    group: 'nodes',
    summary: 'Tail the most recent ~200 log lines for a node.',
    usage: 'nodes.logs <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.logs(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.exportLogs',
    group: 'nodes',
    summary: 'Save the current log buffer to disk (opens save dialog).',
    usage: 'nodes.exportLogs <nodeId> --format txt|log|json --lines \'["line1","line2"]\'',
    args: [
      { name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' },
      { name: 'format', kind: 'flag', required: true, describe: '"txt" | "log" | "json".' },
      {
        name: 'lines',
        kind: 'flag',
        required: true,
        describe: 'JSON array of log line strings.',
      },
    ],
    exec: (p) => {
      const fmt = requireFlag(p, 'format');
      if (fmt !== 'txt' && fmt !== 'log' && fmt !== 'json')
        throw new Error('--format must be txt | log | json');
      const lines = JSON.parse(requireFlag(p, 'lines')) as unknown;
      if (!Array.isArray(lines)) throw new Error('--lines must be a JSON array of strings');
      return window.api.nodes.exportLogs({
        nodeId: requirePositional(p, 0, 'nodeId'),
        format: fmt,
        lines: lines as string[],
      });
    },
  },
  {
    name: 'nodes.status',
    group: 'nodes',
    summary: 'Live status (reachable, sessions, bytes, uptime) for a node.',
    usage: 'nodes.status <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.status(requirePositional(p, 0, 'nodeId')),
  },
  {
    name: 'nodes.history',
    group: 'nodes',
    summary: 'Historical metrics samples for a node.',
    usage: 'nodes.history <nodeId> --window 1h|24h|7d|30d',
    args: [
      { name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' },
      { name: 'window', kind: 'flag', required: true, describe: '1h | 24h | 7d | 30d' },
    ],
    exec: (p) => {
      const w = requireFlag(p, 'window');
      if (!isMetricsWindow(w)) throw new Error('--window must be 1h | 24h | 7d | 30d');
      return window.api.nodes.history(requirePositional(p, 0, 'nodeId'), w);
    },
  },
  {
    name: 'nodes.withdraw',
    group: 'nodes',
    summary: 'Withdraw earned DVPN from a node operator address.',
    usage: 'nodes.withdraw --nodeId <id> --amount 1.5 [--to sent1...]',
    args: [
      { name: 'nodeId', kind: 'flag', required: true, describe: 'Node id.' },
      { name: 'amount', kind: 'flag', required: true, describe: 'DVPN amount.' },
      { name: 'to', kind: 'flag', describe: 'Defaults to the app wallet address.' },
    ],
    exec: (p) => {
      const req: NodeWithdrawRequest = {
        nodeId: requireFlag(p, 'nodeId'),
        amountDVPN: numberFlag(p, 'amount', true) as number,
        to: optionalFlag(p, 'to'),
      };
      return window.api.nodes.withdraw(req);
    },
  },
  {
    name: 'nodes.updatePricing',
    group: 'nodes',
    summary: 'Broadcast MsgUpdateNodeDetails with new prices.',
    usage:
      'nodes.updatePricing --nodeId <id> --gb 0.05 --hr 0.001 [--priceMode flat|oracle] [--usdGb 0.10] [--usdHr 0.01]',
    args: [
      { name: 'nodeId', kind: 'flag', required: true, describe: 'Node id.' },
      { name: 'gb', kind: 'flag', required: true, describe: 'DVPN per GB (or oracle fallback).' },
      { name: 'hr', kind: 'flag', required: true, describe: 'DVPN per hour (or oracle fallback).' },
      { name: 'priceMode', kind: 'flag', describe: 'flat | oracle (default: flat).' },
      { name: 'usdGb', kind: 'flag', describe: 'USD per GB (oracle mode).' },
      { name: 'usdHr', kind: 'flag', describe: 'USD per hour (oracle mode).' },
    ],
    exec: (p) => {
      const priceModeRaw = optionalFlag(p, 'priceMode');
      let priceMode: PriceMode | undefined;
      if (priceModeRaw !== undefined) {
        if (priceModeRaw !== 'flat' && priceModeRaw !== 'oracle') {
          throw new Error('--priceMode must be "flat" or "oracle"');
        }
        priceMode = priceModeRaw;
      }
      const req: UpdateNodePricingRequest = {
        nodeId: requireFlag(p, 'nodeId'),
        gigabytePriceDVPN: numberFlag(p, 'gb', true) as number,
        hourlyPriceDVPN: numberFlag(p, 'hr', true) as number,
        priceMode,
        usdGigabytePrice: numberFlag(p, 'usdGb'),
        usdHourlyPrice: numberFlag(p, 'usdHr'),
      };
      return window.api.nodes.updatePricing(req);
    },
  },
  {
    name: 'nodes.backupMnemonic',
    group: 'nodes',
    summary: "Encrypt + store a node operator's mnemonic with the OS keychain.",
    usage: 'nodes.backupMnemonic <nodeId> --mnemonic "word1 ..."',
    args: [
      { name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' },
      { name: 'mnemonic', kind: 'flag', required: true, describe: 'BIP-39 mnemonic.' },
    ],
    exec: (p) =>
      window.api.nodes.backupMnemonic(
        requirePositional(p, 0, 'nodeId'),
        requireFlag(p, 'mnemonic'),
      ),
  },
  {
    name: 'nodes.revealMnemonic',
    group: 'nodes',
    summary: "Decrypt a previously stored node-operator mnemonic.",
    usage: 'nodes.revealMnemonic <nodeId>',
    args: [{ name: 'nodeId', kind: 'positional', required: true, describe: 'Node id.' }],
    exec: (p) => window.api.nodes.revealMnemonic(requirePositional(p, 0, 'nodeId')),
  },
];

export const COMMANDS_BY_NAME: Record<string, CliCommand> = Object.fromEntries(
  COMMANDS.map((c) => [c.name, c]),
);

export const GROUP_LABEL: Record<CliCommand['group'], string> = {
  system: 'System',
  docker: 'Docker',
  settings: 'Settings',
  wallet: 'Wallet',
  events: 'Events',
  updater: 'Updater',
  ssh: 'SSH',
  deploy: 'Deploy',
  nodes: 'Nodes',
};
