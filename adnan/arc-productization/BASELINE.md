# Arc Productization — Phase 0 Baseline

Date: 2026-09-18
Plan: `ARC_AGENT_PRODUCTIZATION_EXECUTION_PLAN.md` (read in full)
Scope: inventory only. No application source was modified in this phase.

## Repository

- Local repo: `~/Projects/bb` (authoritative checkout; partial clone, `blob:none`)
- Branch: `main`
- Commit: `4113ce0615e4cd14e0bd56fd0c63e43868b77bcd` — "Sync prebuilt plugin bundle SDK metadata to 0.4.99"
- Working tree: dirty — one pre-existing modified file:
  - `adnan/plugins/adnan-mission-control/dist/server.meta.json` (build artifact; protected, untouched except by the authorized `bb plugin build`)
- Remotes:
  - `origin` → `https://github.com/adnanelhabashy/bb.git` (Arc fork)
  - `upstream` → `https://github.com/get-bb/bb.git` (EXISTS — fetched during this phase)
  - `the-arc` → `https://github.com/adnanelhabashy/the-arc.git`
- Local vs upstream divergence: NOT measured (git history comparison commands were not run; remotes verified only)

## Versions

- node: v24.16.0
- npm: 11.13.0
- pnpm: 9.15.0
- bb CLI: 0.43.1
- `@bb/desktop`: 0.43.1 (this is the app/BB version — root package.json has no version)
- `@bb/server`: 0.0.1
- `@get-bb/plugin-sdk` (local checkout): 0.4.99
- Mission Control plugin: 0.2.0, pins plugin-sdk **0.4.87** (DIFFERENT FROM LOCAL SDK — build warns; `bb plugin types` would update the pin)
- Installed app: `/Applications/Arc Agent.app` present

## Directory inventory

### MISSING locally (first-party provider plugin sources absent from this checkout)

- `plugins/provider-codex` — MISSING
- `plugins/provider-claude-code` — MISSING
- `plugins/provider-pi` — MISSING
- `plugins/provider-usage` — MISSING
- `plugins/account-pool` — MISSING (source; its data lives in `~/.bb/plugins/account-pool/` with `data.db` + `secrets/`)
- `plugins/provider-acp` — MISSING

Only `plugins/bb-guide/` exists as source (restored by fork commit `ab0a19549`).

### PRESENT

- `packages/agent-runtime`, `packages/bb-app`, `packages/bundled-plugins`
- `apps/desktop` + all files listed in the plan (`main.ts`, `bb-process.ts`, `app-paths.ts`, `run-electron-builder.mjs`, `desktop-release-channel.mjs`, `electron-builder.config.json`)
- `adnan/plugins/adnan-mission-control` + all files listed in the plan

### How the fork builds without provider sources

- Commit `ab0a19549` "Fork build compatibility: tolerate absent plugin sources": marketplace generator and `packages/bundled-plugins/build.ts` skip bundled identities with no `plugins/<name>/.bundled-runtime` staging dir. Only `bb-guide` currently has one.
- The running installed Arc gets provider plugins from prebuilt artifacts: `~/.bb/plugin-host-artifacts/<plugin>/<digest>/host.mjs` (installed set: provider-codex, provider-claude-code, provider-acp, provider-pi, account-pool missing host artifact, + environment/concurrency/keep-awake).
- `apps/server/src/services/plugins/builtin-registry.ts` still lists account-pool, provider-codex, provider-claude-code, provider-pi, provider-usage, provider-acp, provider-retry — identical to upstream.

## Agent registration findings (upstream get-bb/bb as reference + installed artifacts verified)

| Agent | Provider ID | Registration | Bridge / launcher | Notes |
|---|---|---|---|---|
| Codex | `codex` | `plugins/provider-codex/server.ts` | `codex app-server` JSON-RPC child; bare `"codex"` resolved from PATH | auto-installed/bundled as BB plugin; appears in pickers; threads persist `codex` |
| Claude Code | `claude-code` | `plugins/provider-claude-code/server.ts` | `@anthropic-ai/claude-agent-sdk` `query()` against spawned CLI | bundled; `BB_CLAUDE_CODE_EXECUTABLE` is its declared env passthrough and is honored by execution, model probe, health, install-status, usage |
| OMP | `acp-omp` | `plugins/provider-acp/src/known-agents.ts` | `omp acp` over ACP stdio; bare `omp` from PATH | bundled; sign-in hint `omp login`; hidden when `omp` absent (health `not_installed`, canInstall=false) |
| Pi | `pi` (plugin `provider-pi`) | `plugins/provider-pi` (separate non-ACP plugin) | own bridge; has `BB_PI_BRIDGE_COMMAND`/`BB_PI_BRIDGE_ARGS` overrides | bundled; appears in pickers today |
| OpenCode | `acp-opencode` | ACP known agents | `opencode` ACP | visibility "installed"; appears when binary present |
| Cursor | `acp-cursor` | ACP known agents | `cursor-agent` ACP | visibility "always" (RESERVED — shown even uninstalled) |
| Grok / Hermes | `acp-grok`, `acp-hermes-agent` | ACP known agents | ACP | also shipped known agents |

Upstream ACP known-agent set (verified in installed artifact): `acp-cursor`, `acp-opencode`, `acp-omp`, `acp-grok`, `acp-hermes-agent`. Capability probe background service downgrades `fork` to `"none"` for agents that don't advertise session/fork support. A `customAgents` setting entry with id `omp` and an absolute `command` can REPLACE the shipped acp-omp definition — the only existing executable-override mechanism for OMP.

To eventually show only Codex / Claude Code / OMP: hide or gate `provider-pi` and the non-OMP ACP known agents (cursor/opencode/grok/hermes) at the provider-registration/presentation layer; keep provider IDs `codex`, `claude-code`, `acp-omp` stable. NOT done in this phase.

## Codex architecture (upstream reference)

- Executable: bare `"codex"` from PATH at 5+ sites (`bridge.ts` `resolveAppServerLaunch`, `provider-maintenance.ts` health/install/usage probes). PATH is the user's login-shell PATH injected by the host daemon.
- Bridge-internal override pair exists: `BB_CODEX_BRIDGE_APP_SERVER_COMMAND` + `_ARGS` (bridge.ts:272-275, 336-349) but is UNREACHABLE in production: `sanitizeInheritedChildProcessEnv` strips all `BB_*` keys and the plugin declares no `env.passthrough`.
- Minimum supported version: 0.136.0 (0.143.0 for `thread_rewind`).
- Install: `npm install -g @openai/codex@latest`; update: `codex update`.
- Account key: `openai:chatgpt:<accountId>`. Usage source: registered in server.ts.
- **Smallest safe change for an Arc-private Codex binary:** (1) declare `env: { passthrough: ["BB_CODEX_BRIDGE_APP_SERVER_COMMAND", "BB_CODEX_BRIDGE_APP_SERVER_ARGS"] }` in provider-codex/server.ts, AND (2) add a `codexExecutable()` helper (mirroring claude's `claudeExecutable()`) used at the five PATH-probe sites in provider-maintenance.ts. Passthrough alone gives working turns with a lying `not_installed` status; the override is all-or-nothing (command without args yields `args: []` → TUI instead of `app-server`).

## Claude Code architecture (upstream reference)

- `BB_CLAUDE_CODE_EXECUTABLE`: the ONLY env var the plugin declares for passthrough (server.ts:81). Validated with `accessSync(X_OK)`, throws a named error when invalid (session-options.ts:172-191). Consumed by execution (session-options.ts:224/242 → sdk-session.ts:277-281), model probe (bridge/model-list.ts:10-21), health (provider-maintenance.ts:348), install-status (:122), usage (:496).
- No version floor (`minimumSupportedVersion: null`).
- Install: Anthropic installer via host-daemon node-pty, streamed to UI (`curl -fsSL https://claude.ai/install.sh | …`); update: `claude update`. `claude doctor` parsed for install method and auto-update channel.
- Account key: `anthropic:account:<accountUuid>`.
- Arc can already install/update Claude with no Terminal (host-daemon PTY install runner streams progress to UI). The only Terminal-bound step is sign-in (`loginCommand: "claude /login"` is a hint string nothing executes) — closing it means reusing the existing PTY channel for an authenticate action that surfaces the OAuth URL.

## OMP architecture (upstream reference)

- Provider ID `acp-omp`, display "omp", launches `omp` with args `["acp"]` (i.e. `omp acp`) over ACP stdio. fork="tip", visibility="installed", manual compaction on. Dialect resolved by command basename (`omp` → OMP_ACP_DIALECT).
- Health uses `which omp`; missing → row hidden, `not_installed`, canInstall=false; forced launch → `spawn omp ENOENT`.
- No usage/installation maintenance flags on the shipped definition; no env-var executable override. Only override: `customAgents` entry id `omp` with absolute `command`.
- `plugins/provider-acp/src/bridge/provider-maintenance.ts` does NOT exist upstream — ACP maintenance lives in `packages/provider-bridge-acp/src/bridge/provider-maintenance.ts` (published bridge package).
- Least invasive future hook for an explicit OMP path: PATH injection from the desktop-owned BB child process (works because launch uses bare `omp`), and/or a forked known-agents entry. No code change needed in Phase 1 if Arc prepends its private bin dir to the child PATH.

## Account Pool (upstream reference)

- Providers: exactly `claude` and `codex`. Account kinds: `oauth`, `api-key` (api-key Claude-only).
- Codex login: ChatGPT device-code flow (usercode → poll → /oauth/token → id_token claims). Claude login: manual-code PKCE OAuth (claude.ai/authorize → paste code → /v1/oauth/token → /api/oauth/profile), plus credential import from Claude keychain/.credentials.json and ~/.codex/auth.json.
- Secrets: 0600 JSON files under `<dataDir>/plugins/account-pool/secrets/accounts/`, atomic tmp+rename. Metadata: plugin KV (`accounts:v1`, `config`, `routing.<provider>`) + plugin SQLite (`account_quota`, `pool_affinity`, `pool_active_account`).
- Routing: local hub reverse-proxy contributing `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`, `CODEX_OPENAI_BASE_URL`/`CODEX_POOL_AUTH_TOKEN`; priority order with quota-threshold skipping, thread→account affinity, parent-affinity inheritance, preemptive failover on quota headers.
- RPC: account.add/list/remove/enable/disable/setPriority/reorder/refreshUsage, routing.set, config.get/set, login.start/complete, codexLogin.start/poll/cancel, status.get, status.routedThreads, token.rotate, bypass.set.
- **Reusable for Arc Accounts page:** everything above — login flows, secret store, multi-account enable/disable/priority, per-account usage refresh, stable account identity (`accountUuid`, `codexAccountId`). Arc should present it as "AI Accounts" and only build presentation + routing-toggle UX on top.

## Usage & Limits (current Mission Control)

Confirmed data flow matches expectation:

```
UsageLimitsPage (components/usage-limits.tsx:187)
  → useUsageDashboard() (lib/data.ts:284)
  → RPC usage_dashboard_get (server.ts:1447)
  → buildUsageDashboard() (server.ts:864)
      → bb.sdk.providers.list() + bb.sdk.system.usageLimits()   [direct]
      → account-pool RPC account.list via loopback HTTP         [pool]
```

- Local `apps/server/src/services/system/usage-limits.ts` uses the OLD per-provider `provider.usage` host-RPC model (via `callHostRetryableOnlineRpc`). NO `provider-usage.v1.listResources`/`getResource` generic registry exists locally (server.ts, Mission Control, plugin SDK — all absent; `plugins/provider-usage/` missing).
- Upstream generic usage-source (NOT ported): `plugins/provider-usage/{server.ts, usage-source-contract.ts, usage-schema.ts, usage-normalization.ts}`; RPCs `provider-usage.v1.listResources` (cheap, metadata-only, stable source-local IDs) and `provider-usage.v1.getResource` (one resource, cached-or-fresh); sources register via `experimental_discoverable`; upstream implementers: provider-codex, provider-claude-code, provider-acp (host-scoped), account-pool (shared). Upstream `usage-limits.ts` does NOT reference provider-usage.v1 — it is a separate host-local path.
- Mission Control can migrate in the plan's 6-step incremental way once the upstream contract is ported/adopted.

## Desktop runtime / PATH

- Chain: Electron main (`apps/desktop/src/main.ts`) → `spawnOwnedRuntime` (main.ts:1965) builds `{...process.env, [APP_SURFACE_ENV_NAME]: APP_SURFACE_DESKTOP}` → `startBbAppProcess` (bb-process.ts) → `createBbAppProcessEnv` (bb-process.ts:217; packaged = Electron-as-node, sets `ELECTRON_RUN_AS_NODE=1`) → bridge → server/host daemon → provider bridges spawn `codex`/`claude`/`omp` against the user's login-shell PATH.
- **Arc can safely prepend a private runtime dir to the child PATH without touching the user's global shell PATH: YES.** Exact later implementation point: `spawnOwnedRuntime` in `apps/desktop/src/main.ts` (env construction, ~line 1968-1974), ideally via a helper such as `buildArcManagedRuntimeEnvironment()` per plan Phase 1. No existing extension hook; this is the seam.

## Update / identity state (verified, not changed)

- `electron-builder.config.json`: `productName: "Arc Agent"` (changed) BUT `appId: "dev.bb.desktop"` (unchanged) AND `publish` still points at `https://github.com/get-bb/bb/releases/download/desktop-latest/` (unchanged).
- `desktop-release-channel.mjs`: stable applicationName now "Arc Agent"; nightly still "bb Nightly"; `createDesktopUpdateReleaseBaseUrl()` still builds get-bb/bb URLs.
- `run-electron-builder.mjs`: fork REMOVED the `config.publish = [...]` override, but since nothing deletes the base config's publish block, **`node apps/desktop/scripts/run-electron-builder.mjs --print-config` shows the generated config STILL carries the get-bb/bb update feed** (publish.url = get-bb/bb desktop-latest). The in-code comment claims "no built-in update feed ships" — that is currently FALSE at the generated-config level. (Stop condition #11 territory; deferred to Phase 12. The installed app in /Applications has no `app-update.yml` in Resources, so the running install is not currently update-driven.)
- Auto-update runtime gate (`desktop-auto-update.ts:113`): `shouldEnableDesktopAutoUpdate` returns true only when `BB_DESKTOP_AUTO_UPDATE === "1"` — auto-updater off by default.
- Version check (`main.ts` ~2470): upstream version-feed check now opt-in via `BB_DESKTOP_VERSION_CHECK === "1"` only.

## Baseline tests

| Check | Result |
|---|---|
| `pnpm --filter @bb/desktop typecheck` | PASS |
| `pnpm --filter @bb/desktop test` | FAIL (3/393) — see below |
| `pnpm --filter @bb/agent-runtime test` | FAIL (5/331) — known fork limitation |
| `bb plugin build` (Mission Control) | PASS (with SDK pin warning 0.4.87 vs 0.4.99) |

Desktop failures (all pre-existing, not caused by this phase):
- `electron-builder-config.test.ts › creates a separate nightly app identity and update feed` — fork-induced: test expects `config.publish[0]` override that the rebrand edit removed.
- `desktop-browser-view-manager.test.ts › opens popup dispositions in a hardened native window` — pre-existing.
- `server-moved.test.ts › switches a builtin target to the connect server…` — pre-existing.

Agent-runtime failures: all 5 in `runtime.codex-topology.test.ts`, root cause `Cannot find module 'plugins/provider-codex/src/bridge/bridge.ts'` — the absent-plugin-sources fork limitation (same class as @bb/server tests). 326/331 pass otherwise.

## Key local-vs-upstream/remote differences

1. Provider plugin sources absent locally; upstream `get-bb/bb` is the reference (fetched; `upstream/main` was 3e9bef842 locally, scouts observed it advancing to 09c81147 during this session).
2. Generated Electron config still carries BB update feed + `dev.bb.desktop` appId (identity work incomplete).
3. Mission Control SDK pin (0.4.87) behind local SDK (0.4.99).
4. Generic usage-source registry absent locally (old `provider.usage` host-RPC path only).
5. No upstream remote divergence measured (history comparison not run).

No secrets were printed or persisted.
