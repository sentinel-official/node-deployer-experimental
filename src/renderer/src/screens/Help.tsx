import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { MIcon } from '../components/MIcon';
import { useApp } from '../store/app';
import type { UpdaterState } from '../../../shared/updater-types';

// ─── Help content ──────────────────────────────────────────────────────────
//
// Sections render in order. Each section gets an entry in the left rail.
// Copy lives here so it stays close to the layout — easier to keep tight,
// human, and consistent than scattering it across components.

type HelpSection = {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  topics: HelpTopic[];
};

type HelpTopic = {
  icon: string;
  title: string;
  body: string;
  bullets?: string[];
};

const SECTIONS: HelpSection[] = [
  {
    id: 'start',
    label: 'Get started',
    icon: 'rocket_launch',
    blurb: 'What you need before your first node goes online.',
    topics: [
      {
        icon: 'laptop_mac',
        title: 'Run a node on this machine',
        body: 'Hosting locally is the fastest way to try the network. The deploy preflight checks each requirement for you.',
        bullets: [
          'Docker Desktop running (Windows / macOS) or Docker Engine (Linux)',
          '2 GB free RAM and ~5 GB free disk for the node image and chain data',
          'One open UDP port — default 7777 — forwarded to this machine',
        ],
      },
      {
        icon: 'cloud',
        title: 'Deploy to a remote VPS',
        body: "Point the app at any Linux box you can SSH into. It installs Docker, builds the dvpnx + sentinelhub images, seeds the operator key, and brings the container online — no manual shell work.",
        bullets: [
          'Paste the IP, SSH user, and a key or password',
          'Sudo is auto-elevated when needed',
          'The whole flow is resumable — if your laptop sleeps mid-build, run it again',
        ],
      },
      {
        icon: 'price_change',
        title: 'Set your prices',
        body: 'Pricing is set during deploy and editable any time from Node Details → Edit pricing. The change is broadcast on-chain as MsgUpdateNodeDetails.',
      },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    icon: 'tune',
    blurb: 'Day-to-day controls for your running nodes.',
    topics: [
      {
        icon: 'sync',
        title: 'Restart a node',
        body: 'Use the restart button on Node Details. The container is restarted in place, the operator key stays put, and a fresh on-chain attestation is published.',
      },
      {
        icon: 'account_balance_wallet',
        title: 'Withdraw rewards',
        body: 'Rewards accrue to each node\'s on-chain operator balance. Withdraw on Node Details broadcasts a MsgSend signed locally — no SSH, no exchange detour.',
      },
      {
        icon: 'memory',
        title: 'Update on-chain specs',
        body: 'Hardware specs (CPU, cores, RAM) re-publish automatically whenever you redeploy or restart. The Specs page shows the last published snapshot and the live machine reading side-by-side.',
      },
      {
        icon: 'cleaning_services',
        title: 'Clear stuck nodes',
        body: 'If a deploy hangs in "loading" forever, the Nodes page shows a "Clear stuck (N)" button. It removes the local container and frees the slot — the on-chain registration is left untouched.',
      },
    ],
  },
  {
    id: 'security',
    label: 'Keys & security',
    icon: 'shield_lock',
    blurb: 'Where secrets live and how to recover them.',
    topics: [
      {
        icon: 'vpn_key',
        title: 'How keys are stored',
        body: 'The app wallet mnemonic is encrypted with the OS keychain (Electron safeStorage → Windows DPAPI / macOS Keychain / libsecret). Each node has its own operator mnemonic, encrypted the same way.',
      },
      {
        icon: 'visibility',
        title: 'Reveal a recovery phrase',
        body: 'Node Details → Reveal recovery phrase decrypts the per-node mnemonic on demand. Copy it to paper, then close the dialog. The phrase never leaves your machine.',
      },
      {
        icon: 'restart_alt',
        title: 'Recover on a new machine',
        body: 'Wallet Setup → Use Existing Wallet accepts a 12–24-word phrase. Per-node operator keys are app-only — re-deploy to mint fresh ones, or import the operator phrase if you saved it.',
      },
      {
        icon: 'delete_forever',
        title: 'Wipe everything',
        body: 'Quit the app, delete %APPDATA%/sentinel-node-manager/store.json and the nodes/ folder, then docker rm -f the containers. Once the encrypted backup is gone, the operator phrases are unrecoverable by design.',
      },
    ],
  },
  {
    id: 'trouble',
    label: 'Troubleshoot',
    icon: 'healing',
    blurb: 'When something looks off.',
    topics: [
      {
        icon: 'cloud_off',
        title: '"Docker not reachable"',
        body: 'The app needs Docker running. On Windows/macOS, open Docker Desktop and wait for the whale icon to settle. On Linux, sudo systemctl start docker. The Manage Docker screen has a one-click force-restart if the daemon hangs.',
      },
      {
        icon: 'hourglass_empty',
        title: 'Deploy stuck on a step',
        body: 'Most hangs are network — the keygen container needs ~6 GB pulled the first time. Check the live deploy log on the Progress screen; it streams every Docker layer and chain RPC call as it lands.',
      },
      {
        icon: 'wifi_off',
        title: 'Node shows "Pending registration" forever',
        body: 'Chain registration usually lands within ~60 s, but RPC pool latency can push it to a few minutes. The container will be promoted to "online" automatically once it\'s been running for 60 s, even if the chain is lagging.',
      },
      {
        icon: 'bug_report',
        title: 'Send us a diagnostic bundle',
        body: 'The Export diagnostics button up top builds a sanitized zip — logs, settings, container list, recent IPC errors. No mnemonics or SSH credentials are included. Attach it to a GitHub issue or DM in Discord.',
      },
    ],
  },
];

const QUICK_LINKS: { label: string; icon: string; href: string }[] = [
  {
    label: 'GitHub repo',
    icon: 'code',
    href: 'https://github.com/sentinel-official/sentinel-dvpn-app',
  },
  {
    label: 'Sentinel Discord',
    icon: 'forum',
    href: 'https://discord.gg/sentinel',
  },
  {
    label: 'Docs',
    icon: 'menu_book',
    href: 'https://docs.sentinel.co/',
  },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl + R', action: 'Refresh balances and node list' },
  { keys: 'Ctrl + ,', action: 'Open Settings' },
  { keys: 'Ctrl + K', action: 'Open command palette' },
  { keys: 'Esc', action: 'Close any open modal' },
];

// ─── Screen ────────────────────────────────────────────────────────────────

export function Help() {
  const { pushToast } = useApp();
  const [updater, setUpdater] = useState<UpdaterState>({ stage: 'idle' });
  const [activeId, setActiveId] = useState<string>(SECTIONS[0]!.id);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    void window.api.updater.status().then(setUpdater);
    const unsub = window.api.updater.onChanged(setUpdater);
    return unsub;
  }, []);

  const exportDiagnostics = async () => {
    const res = await window.api.system.exportDiagnostics();
    if (res.cancelled) return;
    if (res.ok)
      pushToast({ title: 'Diagnostics exported', body: res.path, tone: 'success' });
    else pushToast({ title: 'Export failed', body: res.error, tone: 'error' });
  };

  const checkUpdates = async () => {
    const s = await window.api.updater.check();
    setUpdater(s);
  };

  const installUpdate = async () => {
    const res = await window.api.updater.install();
    if (!res.ok && res.error)
      pushToast({ title: 'Update install failed', body: res.error, tone: 'error' });
  };

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      topics: s.topics.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.body.toLowerCase().includes(q) ||
          (t.bullets ?? []).some((b) => b.toLowerCase().includes(q)),
      ),
    })).filter((s) => s.topics.length > 0);
  }, [query]);

  // Scroll-spy: which section is closest to the top of the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.scrollTop + 24;
      let best = SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const el = sectionRefs.current[s.id];
        if (el && el.offsetTop <= top) best = s.id;
      }
      setActiveId(best);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [filteredSections]);

  const jumpTo = (id: string) => {
    const root = scrollRef.current;
    const el = sectionRefs.current[id];
    if (!root || !el) return;
    root.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  };

  return (
    <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 96px)' }}>
      <PageHeader
        title="Help"
        subtitle="Guides, shortcuts, and diagnostics for running a Sentinel dVPN node."
        right={
          <>
            <UpdaterBadge state={updater} />
            <button
              className="btn btn-secondary"
              onClick={checkUpdates}
              disabled={updater.stage === 'checking'}
            >
              <MIcon name="refresh" size={14} />
              {updater.stage === 'checking' ? 'Checking…' : 'Check updates'}
            </button>
            {updater.stage === 'ready' && (
              <button className="btn btn-primary" onClick={installUpdate}>
                <MIcon name="download_done" size={14} />
                Install v{updater.version}
              </button>
            )}
            <button className="btn btn-secondary" onClick={exportDiagnostics}>
              <MIcon name="download" size={14} />
              Export diagnostics
            </button>
          </>
        }
      />

      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left rail */}
        <aside className="col-span-12 md:col-span-3 lg:col-span-3 flex flex-col gap-3 overflow-auto min-h-0">
          <div className="card">
            <div className="card-body p-2.5 flex flex-col gap-1">
              <div
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border)',
                }}
              >
                <MIcon name="search" size={14} style={{ color: 'var(--text-dim)' }} />
                <input
                  className="bg-transparent outline-none text-xs flex-1 min-w-0"
                  placeholder="Search help…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ color: 'var(--text)' }}
                />
                {query && (
                  <button
                    className="text-[10px] uppercase tracking-wider opacity-60 hover:opacity-100"
                    onClick={() => setQuery('')}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    clear
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-0.5 mt-1">
                {SECTIONS.map((s) => {
                  const active = s.id === activeId && !query;
                  return (
                    <button
                      key={s.id}
                      onClick={() => jumpTo(s.id)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors"
                      style={{
                        background: active ? 'var(--bg-input)' : 'transparent',
                        color: active ? 'var(--text)' : 'var(--text-muted)',
                        borderLeft: active
                          ? '2px solid var(--accent)'
                          : '2px solid transparent',
                      }}
                    >
                      <MIcon
                        name={s.icon}
                        size={14}
                        style={{
                          color: active ? 'var(--accent)' : 'var(--text-dim)',
                        }}
                      />
                      <span className="text-[13px] font-medium">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header py-2">
              <div className="card-title text-sm flex items-center gap-1.5">
                <MIcon name="link" size={13} style={{ color: 'var(--accent)' }} />
                Quick links
              </div>
            </div>
            <div className="card-body p-2 flex flex-col gap-0.5">
              {QUICK_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] transition-colors hover:bg-[var(--bg-input)]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <MIcon name={l.icon} size={13} style={{ color: 'var(--text-dim)' }} />
                  <span className="flex-1">{l.label}</span>
                  <MIcon
                    name="open_in_new"
                    size={11}
                    style={{ color: 'var(--text-dim)' }}
                  />
                </a>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header py-2">
              <div className="card-title text-sm flex items-center gap-1.5">
                <MIcon name="keyboard" size={13} style={{ color: 'var(--accent)' }} />
                Shortcuts
              </div>
            </div>
            <div className="card-body p-2 flex flex-col gap-1">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.keys}
                  className="flex items-center justify-between gap-2 px-1"
                >
                  <span
                    className="text-[12px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {s.action}
                  </span>
                  <Kbd>{s.keys}</Kbd>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div
          ref={scrollRef}
          className="col-span-12 md:col-span-9 lg:col-span-9 flex flex-col gap-4 overflow-auto min-h-0"
          style={{ paddingRight: 4 }}
        >
          {filteredSections.length === 0 && (
            <div className="card">
              <div className="card-body p-6 flex flex-col items-center text-center gap-2">
                <MIcon
                  name="search_off"
                  size={28}
                  style={{ color: 'var(--text-dim)' }}
                />
                <div className="text-sm" style={{ color: 'var(--text)' }}>
                  No help topics match "{query}".
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => setQuery('')}
                >
                  Clear search
                </button>
              </div>
            </div>
          )}

          {filteredSections.map((section) => (
            <section
              key={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className="flex flex-col gap-2.5"
            >
              <div className="flex items-baseline gap-2">
                <MIcon
                  name={section.icon}
                  size={18}
                  style={{ color: 'var(--accent)' }}
                />
                <h2
                  className="text-[15px] font-semibold tracking-tight"
                  style={{ color: 'var(--text)' }}
                >
                  {section.label}
                </h2>
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {section.blurb}
                </span>
              </div>
              <div className="grid grid-cols-12 gap-3">
                {section.topics.map((topic) => (
                  <TopicCard key={topic.title} topic={topic} />
                ))}
              </div>
            </section>
          ))}

          <div className="text-[10px] text-center pt-2 pb-1" style={{ color: 'var(--text-dim)' }}>
            Need something that's not here? Use the search above, or open an
            issue from the GitHub link in the sidebar.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Atoms ─────────────────────────────────────────────────────────────────

function TopicCard({ topic }: { topic: HelpTopic }) {
  return (
    <div className="card col-span-12 lg:col-span-6">
      <div className="card-body" style={{ padding: '12px 14px' }}>
        <div className="flex items-start gap-2.5">
          <div
            className="flex items-center justify-center rounded-md flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            }}
          >
            <MIcon name={topic.icon} size={15} style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div
              className="text-[13px] font-semibold leading-tight"
              style={{ color: 'var(--text)' }}
            >
              {topic.title}
            </div>
            <p
              className="text-[12px] leading-snug"
              style={{ color: 'var(--text-muted)' }}
            >
              {topic.body}
            </p>
            {topic.bullets && (
              <ul className="flex flex-col gap-1 mt-1">
                {topic.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-1.5 text-[12px] leading-snug"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <MIcon
                      name="check_circle"
                      size={12}
                      style={{
                        color: 'var(--accent)',
                        marginTop: 2,
                        flexShrink: 0,
                      }}
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums"
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        boxShadow: 'inset 0 -1px 0 0 var(--border)',
      }}
    >
      {children}
    </span>
  );
}

function UpdaterBadge({ state }: { state: UpdaterState }) {
  const label =
    state.stage === 'idle'
      ? 'Idle'
      : state.stage === 'checking'
        ? 'Checking…'
        : state.stage === 'downloading'
          ? `Downloading ${state.percent ?? 0}%`
          : state.stage === 'ready'
            ? `v${state.version} ready`
            : state.stage === 'up-to-date'
              ? 'Up to date'
              : state.stage === 'error'
                ? 'Error'
                : state.stage;
  const cls =
    state.stage === 'ready'
      ? 'chip chip-success'
      : state.stage === 'error'
        ? 'chip chip-danger'
        : state.stage === 'downloading' || state.stage === 'checking'
          ? 'chip chip-warn'
          : 'chip';
  return <span className={cls}>{label}</span>;
}
