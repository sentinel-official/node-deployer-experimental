# Sentinel dVPN — Desktop

Cross-platform Electron app that deploys and operates
[Sentinel dVPN](https://sentinel.co) nodes — locally on the user's machine
or on a remote VPS over SSH — and provides an in-app wallet for funding +
collecting rewards from those nodes.

Tech: **Electron 33 · Vite 5 · React 18 · TypeScript 5 · Tailwind 3 ·
Zustand · ssh2 · dockerode · CosmJS 0.34 ·
@sentinel-official/sentinel-js-sdk · better-sqlite3 · winston ·
electron-updater · material-symbols**.

---

## For users

### Install

Download the artifact for your OS from
[GitHub Releases](https://github.com/sentinel-official/node-deployer-experimental/releases):
`.dmg` on macOS, `.exe` on Windows, `.AppImage` / `.deb` on Linux. Builds
are currently unsigned, so macOS Gatekeeper will quarantine the first
launch (right-click → Open) and Windows SmartScreen will ask you to allow
the "unknown publisher" once.

Once installed, the app checks GitHub Releases for updates in the
background. The Help screen shows status and can install on demand.

### Prerequisites

- **Docker** on whichever machine runs the node. Docker Desktop for
  macOS / Windows, Docker Engine for Linux. The Deploy screen probes for
  it and offers guidance if missing.
- At least **2 GB** free RAM on the host, and the configured UDP port
  (default 7777) reachable publicly for WireGuard clients.
- For remote deploys, SSH access to the VPS (root or a sudoer with
  passwordless sudo).

### First launch

1. **Wallet setup** — create a 24-word mnemonic (encrypted with your OS
   keychain) or restore one you already have.
2. **Fund the app wallet** — send a small amount of DVPN to the app
   address shown on the Wallet screen (or scan its QR). Each node deploy
   transfers 1 DVPN out of this balance to seed the new operator key.
3. **Deploy a node** — choose "This PC" or "Remote Server". The app:
   - Probes Docker,
   - Builds a multi-stage Alpine image from upstream source (first build:
     10–15 min; cached after that),
   - Generates the node's own 24-word mnemonic and seeds the keyring,
   - Writes canonical `config.toml`,
   - Runs `dvpnx init` (TLS cert + service dir),
   - Starts the long-running container with `--restart unless-stopped`,
   - Transfers 1 DVPN to the new operator address so its on-chain
     account materializes before the node queries it.
4. **Watch it come online** — within ~60 s the chain-side probe picks up
   the registration and the node flips from "Starting" to "Online". The
   Overview dashboard aggregates peers, uptime, and on-chain rewards
   across every deployed node.

### Keyboard shortcuts

- `⌘R` / `Ctrl+R` — refresh balances + node status
- `⌘,` / `Ctrl+,` — open Settings
- `Esc` — dismiss modals / confirmation prompts

---

## For developers

```bash
npm install
npm run rebuild:node    # rebuild better-sqlite3 against system Node for tests
npm run dev             # Electron + Vite, with HMR and Docker-aware deploy flow
npm run typecheck       # tsc --noEmit on main + renderer
npm run test            # vitest: 25 unit + component smoke tests

npm run package:mac
npm run package:win
npm run package:linux
```

Note: `predev` runs `electron-builder install-app-deps` which rebuilds
native modules (`better-sqlite3`, `secp256k1`, `cpu-features`) against the
Electron ABI. If you later want to run unit tests, run
`npm run rebuild:node` to rebuild for the system Node ABI.

### What's real

| Concern | Implementation |
|---|---|
| Wallet mnemonic | BIP-39 (24 words, 32 bytes CSPRNG entropy) |
| HD derivation | `m/44'/118'/0'/0/0` via `DirectSecp256k1HdWallet` |
| Address format | bech32; app + nodes use the `sent` HRP, chain-side node identity is `sentnode` |
| At-rest encryption | Electron `safeStorage` (OS keychain: Keychain / DPAPI / libsecret) |
| Balance query | `StargateClient.getBalance(addr, 'udvpn')` |
| RPC pool | Three endpoints (rpc.sentinel.co + AutoStake + Polkachu) with latency-aware failover |
| Send / MsgSend | `SigningSentinelClient.sendTokens` with explicit StdFee; error codes classified |
| Operator seeding | 1 DVPN auto-transferred to each new node's operator address on deploy |
| QR code | Real SVG from `qrcode` in main, inlined in renderer |
| Local deploy | Docker via `dockerode` + inlined multi-stage Dockerfile; first build ≈ 10–15 min, subsequent deploys reuse cached image |
| Remote deploy | `ssh2` + SFTP for config upload; installs Docker on Ubuntu/Debian if missing; runs the same image spec as local |
| Node `init` flow | `sentinelhub keys add --recover` seeds keyring → `dvpnx init --node.remote-addrs` writes TLS + service dir → `docker run -d ... dvpnx start` |
| Node pricing | Read from `config.toml`; editable at any time via `MsgUpdateNodeDetails` (signed with backup mnemonic) |
| Chain status | `SentinelQueryClient.node.node(sentnodeAddr)` → flips the node status tile, fills chain-side address + lifecycle state |
| Active sessions | `SentinelQueryClient.session.sessionsForNode(sentnodeAddr)` → Node Details "Active subscriptions" card |
| Metrics history | SQLite time-series via `better-sqlite3`, populated by the 60 s poller |
| Uptime | Persisted to store on start; survives app restarts |
| Node withdraw | `MsgSend` signed by the node's backup mnemonic, broadcast via CosmJS — no `docker exec` required |
| Event feed | Every lifecycle step appends; pushed live via IPC |
| File logging | `winston` with 10 MB × 5 rolling files under `userData/logs` |
| Crash reports | Electron `crashReporter` writing dumps locally (`userData/Crashpad`) |
| Auto-updater | `electron-updater` with GitHub Releases provider; manual install prompt in Help |
| Diagnostics export | Zip of sanitized state + events + logs (no mnemonics, no SSH creds) |

### Project layout

```
src/
├─ main/                     Electron main process
│  ├─ index.ts               Window, crash reporter, poller, updater
│  ├─ ipc.ts                 All ipcMain handlers
│  └─ services/
│     ├─ chain.ts            Sentinel constants (prefix, denom, RPC pool, HD path)
│     ├─ settings.ts         userData/settings.json
│     ├─ logger.ts           winston + global exception handlers
│     ├─ sentinel-client.ts  RPC pool + read/sign client builders
│     ├─ wallet.ts           BIP39 → HD → safeStorage; balance + send + node key mint
│     ├─ ssh.ts              ssh2 exec + SFTP + shell-quote helpers
│     ├─ docker.ts           dockerode wrapper + inlined Dockerfile + build/run/logs
│     ├─ deploy.ts           Docker-driven orchestration (local + remote)
│     ├─ node-manager.ts     Container lifecycle; chain probe; withdraw + update pricing
│     ├─ metrics.ts          SQLite time-series
│     ├─ events.ts           Activity log (EVENTS_CHANGED push)
│     ├─ updater.ts          electron-updater wiring
│     └─ store.ts            JSON store (no secrets)
├─ preload/index.ts          Typed window.api bridge
├─ renderer/src/
│  ├─ screens/               One file per design screen
│  ├─ components/            Sidebar, Topbar, Toast, ConfirmModal, Onboarding,
│  │                         MIcon, StatCard, ProgressRing, BarChart, QRCode,
│  │                         PageHeader, Layout
│  ├─ store/app.ts           Zustand store + push subscriptions + keyboard shortcuts
│  └─ lib/                   Formatters + event icon/tone map
└─ shared/                   types.ts + updater-types.ts (safe to share across IPC)
```

### Security

- `contextIsolation: true`, `nodeIntegration: false`.
- CSP: `default-src 'self'; script-src 'self'; connect-src 'self'`. Tailwind
  requires `style-src 'self' 'unsafe-inline'`.
- External links open in the OS browser via `setWindowOpenHandler`.
- Single-instance lock; second launch focuses the existing window.
- Mnemonics never reach the renderer. The app wallet mnemonic is shown
  exactly once during creation. Node mnemonics are shown exactly once on
  deploy and by default stored encrypted under safeStorage so node-level
  sends (withdraw / pricing update) work without SSH.
- SSH credentials are held in process memory for the node's lifetime only
  — never written to disk.
- Remote commands are assembled with `shell-quote` or uploaded via SFTP
  — no user-string interpolation.

### CI

`.github/workflows/ci.yml` runs on push / PR:

1. `npm ci`
2. `npm run rebuild:node` — rebuild `better-sqlite3` for CI's system Node
3. `npm run typecheck` — main + renderer
4. `npm run test:unit` — 25 tests across wallet crypto, chain constants,
   deploy parser, metrics, settings, and a component smoke
5. `npm run build` — all three bundles

### Releases

`.github/workflows/release.yml` builds signed-ready installers for
macOS, Windows, and Linux in parallel and uploads them as a GitHub
Release. electron-updater reads the same release, so a tag push is also
what ships the in-app update.

To cut a release:

1. Bump `version` in `package.json` and commit.
2. Tag matching the new version: `git tag v0.2.0 && git push --tags`.
3. The workflow builds `.dmg`/`.zip` (x64 + arm64), `.exe`/portable
   (x64), and `.AppImage`/`.deb` (x64), then attaches them to a draft
   release at
   [node-deployer-experimental/releases](https://github.com/sentinel-official/node-deployer-experimental/releases).
   Edit the draft's notes and publish.

Manual `workflow_dispatch` runs the same pipeline as a dry-run — builds
every OS bundle and uploads them as CI artifacts (14-day retention)
without touching Releases.

### Known limitations

- **Unsigned distribution.** macOS notarization + Windows code signing
  aren't wired to real certificates yet. The electron-builder config is
  ready for them.
- **First image build time.** The sentinel-dvpnx + sentinelhub source
  compile takes 10–15 minutes on a small VPS. Cached thereafter. A future
  optimization would be a pre-built image hosted on a registry.
- **Local deploy on macOS Docker Desktop** is theoretically supported but
  hasn't been extensively tested; the remote deploy path is the better
  exercised one today.
- **Sessions extension** returns `Any` protobuf values; we decode only
  the common fields (id, bandwidth, duration). Per-protocol details (WG
  handshake time, etc.) could be added with the service-specific
  decoders.
