# Changelog

All notable changes to **Sentinel Node Manager** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows the spirit of [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(though it has not yet shipped a tagged release).

## [Unreleased]

This entry covers the work on `feat/ui-overhaul` since commit
`4234893 feat: UI overhaul + CLI server + SSH batch deploy`.

### On-chain hardware specs reporting (`specs:v1`)

- New service `src/main/services/node-specs.ts` — operator self-MsgSend
  (`from == to`, 1 udvpn) carrying memo `specs:v1:{cpu,c,cr,r,rr}` so any
  explorer can identify the report. Operator-reported, not consensus-validated;
  CQAP attestation supersedes it once that lands.
- Triggered automatically after a successful local OR remote deploy via a
  fire-and-forget IIFE in `deploy.ts` (12 s settle window so the seed-funding
  tx propagates across the RPC pool before signing).
- Gas budget set to **250 000** for the MsgSend (Sentinel ante handlers
  consume ~120.8 K; the previous 120 K hit code 11 out-of-gas).
- Startup replay path: `replayPendingSpecs()` (called from `src/main/index.ts`)
  re-broadcasts for any node whose `specsPublishPending` flag is still set
  from a prior session — handles app-killed-mid-broadcast and transient RPC
  outages cleanly. Sequential, gentle, fire-and-forget; UI never blocks on it.
- Activity log surfaces a new `specs-reported` event kind with the tx hash.

### Live System metrics (default-on, navigation-persistent)

- New service `src/main/services/live-stats.ts` — refcounted 1 Hz CPU/memory
  sampler that broadcasts `LiveSystemStats` over `IPC.SYSTEM_LIVE_STATS`. The
  refcount lets multiple subscribers share a single timer; the timer stops
  cleanly when the last subscriber unsubs.
- New screen `src/renderer/src/screens/System.tsx` (replaces ad-hoc system
  cards): live CPU per-core %, total memory %, OS / arch / kernel, Docker
  health summary, and a **Reporting** toggle for the on-chain `specs:v1`
  cadence (default ON).
- **Live Specs default-on, persistent across navigation.** The toggles
  (`systemLive`, `systemReporting`) live in the Zustand store and are
  bootstrapped at app start, so navigating between screens no longer kills
  the sampler. Previously each `System.tsx` mount called `startLiveStats`
  in a `useEffect` and the unmount cleanup tore it down; now the
  subscription is started once at bootstrap and the toggle just flips a
  boolean.
- `src/main/services/system-report.ts` — extracted single source of truth
  for `LocalSystemReport` so the `system status` CLI command and the System
  page can never disagree.

### Activity feed

- New screen `src/renderer/src/screens/Activity.tsx` — grouped, filterable
  event log (Deployments, Node lifecycle, Wallet, Specs, Withdrawals).
  Renders all `AppEvent` kinds with relative timestamps, kind-specific
  icons, and the related node moniker.
- Existing `src/renderer/src/lib/events.ts` extended with `KIND_ICON` and
  `KIND_TONE` maps so the Activity feed and the toast layer share styling.

### Seed-phrase save dialog

- New component `src/renderer/src/components/SeedPhraseModal.tsx` — global
  dialog mounted at `Layout` level so it survives tab switches. Pops
  ~3.3 s after `phase === 'done'` (lets the progress ring complete cleanly
  first), shows the mnemonic with copy + verify-3-words confirmation, and
  is dismissed permanently per `jobId` once the user ticks "I've stored it".
- Mnemonic visibility now resets across deploys: the previous deploy's
  mnemonic never bleeds into the next deploy's dialog.

### Security hardening

- **Renderer sandbox enabled** (`webPreferences.sandbox: true`) — a renderer
  compromise can no longer reach raw Node APIs through the preload's CJS
  context. Preload runs in a sandboxed context using only `contextBridge`
  + `ipcRenderer`.
- **Strict CSP** injected as a response header from the main process
  (`installContentSecurityPolicy`). Prod policy is `default-src 'self'`
  with `script-src 'self'` and no inline scripts; dev relaxes only to
  accommodate Vite HMR (`'unsafe-inline'`, `'unsafe-eval'`, ws origin).
  `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`,
  `base-uri 'self'`.
- **Window-open guard** — `setWindowOpenHandler` now allow-lists
  `https:` and `mailto:` only and logs every blocked scheme.
  `file:`, `javascript:`, `data:`, and custom-protocol vectors are denied.
- **In-window navigation guard** — `webContents.on('will-navigate')`
  blocks any URL that isn't the dev server or the bundled `file://` app
  origin.
- **Auto-start CLI server requires explicit ack** — `SNM_AUTO_START_CLI=1`
  alone is now ignored. The user must also export
  `SNM_AUTO_START_CLI_TOKEN=i-understand-this-opens-a-local-control-channel`.
  Without the token the env var is no-op'd and a one-line refusal is
  logged. CLI server still defaults OFF; in-app Start button is unchanged.
- **TOFU host-key tracking for SSH** — new `src/main/services/host-keys.ts`
  persists the SHA-256 host fingerprint we saw on first connection and
  logs `warn`-level events on later mismatches. Non-blocking by design
  (rotating cloud hosts); creates a forensic trail in `app.log`.
- **CLI scrubSecrets()** — the CLI server's broadcast layer strips
  `--mnemonic`, `--password`, and similar credential-bearing flags from
  events so a watching agent can't reconstruct secrets from the broadcast
  stream. The mnemonic remains reachable only via the gated in-app reveal
  flow.
- `deploy.status` over the CLI redacts `mnemonicForBackup` — the seed
  never leaves the in-app reveal flow even when an agent is connected.

### Settings: live-applied poll cadences

- `walletRefreshIntervalSec` and `nodeRefreshIntervalSec` are now applied
  immediately on save via `onSettingsChanged` — previously required app
  restart. Wallet balance poller and node manager poller both restart with
  the new cadence on the next tick.
- Settings UI exposes both intervals with sensible bounds (10–600 s for
  wallet; 30–600 s for nodes).

### Deploy pipeline

- Post-deploy `MsgUpdateNodeDetails` broadcast — pricing, gigabyte/hourly
  rates, and price mode are now pushed on-chain immediately after the
  node lands its first registration tx, instead of waiting for the next
  edit pass.
- Local deploys capture a `NodeSpecsSnapshot` via `captureLocalSpecs()`
  and persist it on the stored node so the System page and the
  `specs:v1` memo see the same source of truth.
- Per-deploy progress phase machine refactored to emit cleaner status
  lines (`[ts] message`) suitable for both the in-app log and the CLI
  `deploy.status` stream.
- Failed deploys now drop the zombie node entry plus its logs / metrics /
  backup so the user isn't left with dead inventory.
- Cancellation honoured at every `await` boundary inside `runLocalDeploy`
  and `runRemoteDeploy`.

### SSH batch deploy

- `src/renderer/src/screens/DeploySshBatch.tsx` rewritten (788 +/-) —
  CSV/JSON input, per-row credential override, parallel-with-cap
  scheduler, per-row live status and final summary. Mnemonics for batch
  rows are generated locally per host and surfaced via the same gated
  reveal flow as single deploys.
- `<password>` and `<paste key here>` placeholders in the template are
  inert; the screen blocks deploy until the user replaces them.

### Node management

- `src/main/services/node-manager.ts` (+~470 net) — per-node fast-poller
  with self-expiry. Nodes in `loading` get probed every 4 s for up to
  5 min so the UI flips "Pending registration → Active" promptly without
  hammering the chain. Online nodes keep the fast-poll for a 60 s grace
  window after `startedAt` so peer count, uptime, and reachability stay
  live during the post-online window.
- New IPC pipeline `nodes:live-status` — the fast-poller pushes
  `NodeLiveStatusUpdate` frames straight to the renderer store; UI no
  longer needs to re-query.
- `reapStuckNodes()` + new IPC `NODES_REAP_STUCK` — surfaces the "garbage
  collect dead nodes" action to the renderer; useful when a `docker rm`
  failed mid-shutdown last session and left orphaned containers.
- `restartPollerCadence(intervalSec)` — exported so the settings change
  hook can swap the global poller's interval without restart.

### Docker integration

- `src/main/services/docker.ts` (+209) — Windows pipe detection now
  prefers `dockerDesktopLinuxEngine` over the legacy
  `\\.\pipe\docker_engine` (matches upstream PR #3, expanded with stricter
  fallback ordering and an explicit "Docker Desktop is not running"
  diagnostic).
- New IPC `DOCKER_OPEN_SETTINGS` — opens Docker Desktop's settings
  window from the in-app Manage Docker screen so users can flip
  "Expose daemon on tcp://localhost:2375 without TLS" if they need it
  for remote-engine setups.
- `dockerHealth()` returns a structured result the System page renders
  inline (engine reachable, version, API version, daemon socket path).

### Wallet

- `src/main/services/wallet.ts` (+/-173) — RPC-first balance refresh per
  global rules. `refreshWalletBalance()` uses `createRpcQueryClientWithFallback()`
  and only falls through to LCD when every configured RPC has failed.
  Logs the elapsed-ms and chosen endpoint at `debug` level for triage.
- `signerFromMnemonic()` extracted so `node-specs.ts` and `deploy.ts`
  share a single signer-construction path (HD path `44'/118'/0'/0/0`,
  bech32 prefix `sent`).

### Sentinel chain client

- `src/main/services/sentinel-client.ts` (+121) — `signClient(mnemonic)`
  helper that wraps `SigningStargateClient.connectWithSigner` with our
  RPC fallback list, default fee, and retry-on-transient errors. The
  `TRANSIENT_ERR` regex now includes the fresh-account propagation lag
  ("account does not exist") so post-funding broadcasts retry cleanly.

### CLI server (in-process control channel)

- `src/main/services/cli-server.ts` (+95) and `cli-registry.ts` (+/-88)
  — Windows named pipe / Unix socket server exposing typed commands
  (`system.*`, `wallet.*`, `nodes.*`, `deploy.*`, `metrics.*`). Only
  one client at a time; clean handshake error if a second tries to
  connect.
- New `SeedPhraseModal`-aware command flow: the CLI cannot fetch the
  mnemonic; agents must drive the user through the in-app reveal.

### End-to-end test harness

- `tests/e2e/cli-e2e.mjs` — new real-money mainnet harness driving every
  CLI command, including a real self-send and a real
  `MsgUpdateNodeDetails` broadcast, verified on-chain via Sentinel RPC
  `tx_search`. Total spend per full run ≤ 0.0015 DVPN.
- `tests/e2e/universal.mjs` — a smaller universal-shell test for the
  CLI handshake and the no-money read-only commands.
- `tools/poll-deploy.js` — small helper that polls `deploy.status` for
  human-readable phase transitions during manual smoke runs.
- `docs/e2e-cli-test.md` — full protocol, on-chain verification details,
  troubleshooting table, safety knobs, and CI-mode flags.
- `npm run test:e2e` and `npm run test:universal` script entries.
- README "End-to-end CLI test (real money)" section explains prereqs
  and run flags.

### UI / UX polish

- Topbar (`src/renderer/src/components/Topbar.tsx`) — back-button removed
  (the in-app history was confusing alongside the sidebar); wallet
  balance pill now flips to a refreshing spinner during the active fetch
  rather than going stale.
- ProgressRing (`ProgressRing.tsx`) — 0–5 % "blob" artifact fixed
  (sub-pixel arc rounding); reverse-flow flicker on phase regress
  (e.g. retrying after a soft failure) eliminated by clamping the
  underlying `requestAnimationFrame` interpolator.
- Deploy log — every "p2p" string rebranded.
- 1 s uptime ticker on Node Details so the uptime field doesn't sit on
  stale data between 60 s polls.
- Sidebar — System and Activity entries added; ordering tweaked so the
  three most-used screens (Overview, Nodes, Wallet) sit at the top.
- Layout (`Layout.tsx`) — mounts the global `<SeedPhraseModal />` so it
  survives navigation.
- PageHeader (`PageHeader.tsx`) — title/subtitle now accept ReactNode for
  the trailing slot so screens can drop in custom buttons (Refresh,
  Export, etc.) without a layout shim.
- `src/renderer/src/styles/index.css` — small additions for the live
  CPU bar gradient and the seed-phrase reveal blur.
- `src/renderer/src/lib/format.ts` — `relativeTime()` and `shortAddr()`
  helpers used by Activity and System.

### Logger

- `src/main/services/logger.ts` (+72) — `attachGlobalHandlers()` now
  hooks `process.on('unhandledRejection')` and
  `process.on('uncaughtException')` and flushes them through the same
  log file. `logDir` exported so the diagnostics zip can include it.
- Per-area child loggers (`log.child({ area: 'deploy' })`) so grep'ing
  `app.log` for a single subsystem is straightforward.

### CLI parity (renderer ↔ main registries)

- `ssh.forgetHostKey --host <host> [--port 22]` — drop a TOFU-pinned SSH
  host key so the next connection re-pins it. Useful after a remote box
  is rebuilt and presents a new fingerprint. Already existed in the
  main-process pipe registry; now also exposed via
  `window.api.ssh.forgetHostKey()` and the renderer CLI registry so the
  two surfaces stay in lockstep.
- `nodes.publishSpecs <nodeId>` — publish the on-chain hardware specs
  report (`specs:v1` self-MsgSend memo) on demand. Idempotent: if the
  node's `specsTxHash` is already set, returns the cached hash without
  spending; otherwise broadcasts the same path the deploy hook uses.
  Added to BOTH registries and to `window.api.nodes.publishSpecs()`.
- IPC handlers in `src/main/ipc.ts` validate the new payloads
  (`vUUID(nodeId)` for publishSpecs, host/port shape check for
  forgetHostKey) and rate-limit `nodes-publish-specs` at 3 burst /
  0.2 rps so a buggy caller can't loop self-MsgSends.
- `docs/e2e-cli-test.md` updated: `nodes.publishSpecs` added to phase 5
  (Inspect) — second run must return the cached hash without spending —
  and `ssh.forgetHostKey` documented in the validation contract row.
  Cost section bumped to "at most three transactions" with the
  idempotency note.

### Type system

- `src/shared/types.ts` — new types: `LiveSystemStats`,
  `NodeLiveStatusUpdate`, `NodeSpecsSnapshot`, `MnemonicExportResult`,
  `EventKind` extended with `'specs-reported'`. New IPC channels:
  `SYSTEM_LIVE_STATS_START`, `SYSTEM_LIVE_STATS_STOP`,
  `SYSTEM_LIVE_STATS`, `DOCKER_OPEN_SETTINGS`, `NODES_REAP_STUCK`,
  `NODES_LIVE_STATUS`, `NODES_EXPORT_MNEMONIC`,
  `SSH_FORGET_HOST_KEY`, `NODES_PUBLISH_SPECS`.
- All new IPC referenced via the `IPC` enum; no raw-string channels
  introduced (per project rule).

### Tests

- `tests/renderer/wallet-setup.test.tsx` — updated for the new
  WalletSetup flow (mnemonic-first, address derived after, mock
  `signerFromMnemonic`).

### Tooling

- `package.json` — `test:e2e` and `test:universal` scripts added.
- `.gitignore` — `vendor-clone/` added (tester-only third-party clones).
- `package-lock.json` — minor lockfile churn from the new test deps.

### Known issues / follow-ups

- `*.tsbuildinfo` files were tracked in a previous commit; this changeset
  does not yet untrack them. Will land in a follow-up.
- No persisted CHANGELOG entries before this one — historical changes
  are recoverable from `git log`.
