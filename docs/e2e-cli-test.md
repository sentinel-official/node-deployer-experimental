# End-to-end CLI test (real money, mainnet)

`tests/e2e/cli-e2e.mjs` is an end-to-end harness that drives every CLI
command exposed by Sentinel Node Manager against a live app instance and
verifies any tx-emitting step on-chain via Sentinel **RPC `tx_search`**.

It exists so we can prove, before each release, that the CLI surface still
works end-to-end on real mainnet — no mocks, no dry-run-only paths, real
DVPN, real Docker keygen, real signed broadcasts.

## What it covers

| Phase | Checks |
|---|---|
| 0. Server reachability | `system.report`, `settings.chainHealth` (≥1 RPC reachable) |
| 1. Inventory (read-only) | `wallet.get` (+ balance gate), `wallet.refreshBalance`, `nodes.list`, `events.list`, `docker.overview`, `updater.status`, `settings.get`, `wallet.qrSvg` |
| 2. Validation contract | Negative cases: missing positionals, missing flags, unreachable SSH host — must reject gracefully, never crash |
| 3. **Real-money self-send** | `wallet.send --to <ownAddress> --amount 0.001 --memo cli-e2e-XXXX`, hash verified via RPC `tx_search` (block + code 0) |
| 4. Local deploy | `deploy.start --target local`, polled `deploy.status` to `phase=done` (≤ 600 s); also asserts the CLI server **redacts `mnemonicForBackup`** so the seed never leaves the in-app reveal flow |
| 5. Inspect | `nodes.get`, `nodes.status`, `nodes.history --window 1h`, `nodes.logs` |
| 6. **Real-money pricing update** | `nodes.updatePricing` (MsgUpdateNodeDetails), hash verified via RPC `tx_search` |
| 7. Lifecycle | `nodes.stop` → `nodes.start` → `nodes.restart` |
| 8. Cleanup | `nodes.remove` for the e2e node only; existing nodes are untouched |
| 9. Final balance + diagnostics | `wallet.refreshBalance`, `system.exportDiagnostics` |

## Cost

The harness broadcasts at most **two transactions**:

1. `wallet.send` — self-send of `0.001 DVPN` (returns to your own wallet).
2. `nodes.updatePricing` — sets `gb=0.06 hr=0.0011` on the freshly
   deployed e2e node.

Estimated total fees: **≤ 0.0015 DVPN** (each TX is roughly 0.0002–0.0003
DVPN of gas). The harness refuses to start unless the wallet has at least
**0.5 DVPN** free, so there is plenty of headroom over the actual spend.

## Prerequisites

1. **App running.** Launch the desktop app as you normally would.
2. **CLI server ON.** Two ways:
   - **Manual:** open the in-app **CLI** screen and click **Start**.
     This is the safest option — you stay in control and can stop the
     server again with one click.
   - **Auto-start (CI/headless):** launch the app with these two env
     vars set:
     ```
     SNM_AUTO_START_CLI=1
     SNM_AUTO_START_CLI_TOKEN=i-understand-this-opens-a-local-control-channel
     ```
     The token is intentionally verbose: starting the CLI server opens
     a local control channel that can sign transactions, deploy nodes,
     and broadcast on-chain — same authority the GUI has. We require an
     explicit acknowledgement before honouring the env var.
3. **Single active client.** The CLI server enforces a single-active-client
   lock: at most one PowerShell / agent / harness can drive commands at
   once. If another shell is connected you will get a `busy` welcome
   frame and the harness will exit with a clear error. Disconnect the
   other client (close the PowerShell window or hit Stop on the in-app
   CLI screen) and re-run.
4. **Wallet funded.** `≥ 0.5 DVPN` in the app wallet
   (`wallet.get` → `balanceDVPN`). The harness will exit before
   broadcasting if the balance check fails.
5. **Docker running.** Phase 4 deploys a real local node, which needs a
   reachable Docker daemon. `docker.overview` in phase 1 will warn you
   if Docker is unreachable.

## Running it

### One-shot: run **everything** (recommended)

```bash
npm run test:universal
```

This runs the full pre-release matrix in one command:

1. `npm run typecheck` — both tsconfigs.
2. `npm test` — vitest (unit + renderer). Auto-rebuilds `better-sqlite3`
   to the Node ABI before, then restores the Electron ABI after, so
   `npm run dev` keeps working.
3. `npm run test:e2e` — the real-money CLI harness below. Skipped with
   a clear message if the named pipe isn't open (i.e. you didn't click
   **Start** on the in-app CLI screen).

Flags:

```bash
npm run test:universal -- --skip-money      # no DVPN spent
npm run test:universal -- --skip-rebuild    # skip the better-sqlite3 toggle
npm run test:universal -- --skip-typecheck  # skip tsc
```

### Just the CLI harness

```bash
# Full real-money flow (about 5–8 min depending on Docker keygen speed):
npm run test:e2e
# (alias for `node tests/e2e/cli-e2e.mjs`)

# Skip the two on-chain transactions (still exercises every other path):
node tests/e2e/cli-e2e.mjs --dry-run

# Skip the deploy + node lifecycle (handy when Docker is down):
node tests/e2e/cli-e2e.mjs --no-deploy
```

Pacing:

- 7 s gap before each tx-emitting command — prevents chain rate-limiting
  from killing the next call.
- 5 s `deploy.status` poll, 10 min deploy timeout.
- 25 s retry loop on `tx_search` per hash — fresh broadcasts can take a
  block or two to be indexed by the RPC node we hit.

## Architecture

The harness speaks the local CLI server's NDJSON protocol directly:

```
client → server:
  { "type": "hello", "client": "agent" }
  { "type": "run",   "line": "wallet.send --to sent1... --amount 0.001" }
  { "type": "bye" }

server → client:
  { "type": "welcome", "endpoint": "...", "sessionStartedAt": "..." }
  { "type": "event", ... }              # streamed; harness ignores
  { "type": "result", "ok": true, "text": "..." }
  { "type": "busy", "holder": "shell" } # if another client is active
```

Endpoint is read from the server's discovery file:

- Windows: `%APPDATA%\sentinel-node-manager\cli-endpoint.json`
- macOS: `~/Library/Application Support/sentinel-node-manager/cli-endpoint.json`
- Linux: `~/.config/sentinel-node-manager/cli-endpoint.json`

…which points at a Windows named pipe (`\\.\pipe\sentinel-node-manager-<user>`)
or Unix domain socket (`~/.sentinel-node-manager/cli.sock`).

On-chain verification is **RPC-first** by project rule
(`Desktop/CLAUDE.md` → "Sentinel Chain Access"). The harness calls
Tendermint `tx_search` directly:

```
POST {RPC}/  (jsonrpc 2.0)
  method: tx_search
  params: { query: "tx.hash='<HEX>'", prove: false, page: "1", per_page: "1", order_by: "desc" }
```

…iterating over `https://rpc.sentinel.co:443`,
`https://sentinel-mainnet-rpc.autostake.com:443`, and
`https://sentinel-rpc.polkachu.com:443` until one returns the tx. LCD is
never used.

The CLI server **redacts `mnemonicForBackup` in `deploy.status`**
(`cli-registry.ts:566-580`). The harness explicitly asserts the redaction
holds — if a future change leaks the seed over the pipe, this test goes
red. The mnemonic must be revealed only through the gated in-app reveal
flow.

## Reading the report

The harness emits three artefacts:

1. **Console** — sectioned, Plan-Manager-style report with green/red
   checkmarks per check, an on-chain TX ledger with block heights, and a
   final pass/fail line. Process exit code reflects pass/fail
   (`0` = pass, `1` = at least one check failed,
   `2` = harness couldn't start).

2. **`tests/e2e/last-report.json`** — sanitized JSON snapshot. Safe to
   include in PRs or upstream issues if useful: addresses are kept,
   mnemonics and SSH credentials are not part of the report shape at
   all.

3. **`findings/<YYYY-MM-DD>-cli-e2e-real-money-report.md`** — fuller
   markdown report. Per project rule (`CLAUDE.md` → Don'ts) the
   `findings/` directory is **tester-only** and never goes upstream.

## Safety knobs

- **`--dry-run`** — runs every read-only command and the validation
  contract, skips both real-money TXs.
- **`--no-deploy`** — useful when iterating on the harness itself; skips
  the long Docker keygen and the full node lifecycle.
- **Balance gate** — exits before any TX if balance < 0.5 DVPN.
- **Single TX type per phase** — the harness will not broadcast more
  than one self-send and one pricing update per run.
- **Cleanup** — phase 8 removes only the e2e node it created; existing
  nodes (`dvpn-*`) are not touched.
- **Mnemonic never logged** — the in-app reveal flow is the only path
  that can surface it. The CLI server's `scrubSecrets()` strips
  `--mnemonic`/`--password`/etc. from broadcast events, and the harness
  asserts `deploy.status` redaction.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `connect ENOENT \\.\pipe\sentinel-node-manager-...` | CLI server is off | Start it from the in-app CLI screen, or relaunch with the env vars above |
| `welcome mode: 'watcher'` | Another shell holds the active lock | Disconnect the other shell, then re-run |
| `wallet.refreshBalance` fails | All RPC endpoints unreachable | Check `settings.chainHealth`; let it fail over to the next endpoint |
| Phase 4 stuck on `image-build` for >10 min | Docker is slow / image rebuild | Run `docker.overview`; manually pull the node image once and re-run |
| Phase 4 errors at `verifying` | Local port is already taken | Change `E2E_PORT` in the harness to a free port |
| TX broadcast `code != 0` | Sequence mismatch / chain rejected | Wait 30 s, run `wallet.refreshBalance`, re-run |
| `tx_search` says "not indexed within 25s" | RPC node lag for that hash | Look the hash up on a different RPC node manually; the TX usually landed |
