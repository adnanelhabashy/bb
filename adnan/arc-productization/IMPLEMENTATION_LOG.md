# Arc Productization Implementation Log

## Phase 0 — Source-of-Truth Inventory and Baseline

Date: 2026-09-18. Executor: Arc Agent run on `~/Projects/bb` @ `4113ce06` (main).

### Files read

- `~/Downloads/ARC_AGENT_PRODUCTIZATION_EXECUTION_PLAN.md` (full, 3755 lines)
- Local: `apps/desktop/src/main.ts` (spawn/env sections), `apps/desktop/src/bb-process.ts`, `apps/desktop/src/app-paths.ts`, `apps/desktop/src/desktop-auto-update.ts`, `apps/desktop/electron-builder.config.json`, `apps/desktop/scripts/run-electron-builder.mjs`, `apps/desktop/scripts/desktop-release-channel.mjs`, `apps/desktop/package.json`, `apps/server/src/services/system/usage-limits.ts`, `apps/server/src/services/plugins/builtin-registry.ts`, `packages/bundled-plugins/build.ts`, `packages/bundled-plugins/package.json`, `adnan/plugins/adnan-mission-control/{server.ts, lib/data.ts, components/usage-limits.tsx, package.json}`, `plugins/bb-official.json`
- Upstream reference (via `git show upstream/main:…` and read-only scouts): `plugins/provider-codex/server.ts`, `plugins/provider-codex/src/bridge/{bridge.ts, provider-maintenance.ts}`, `plugins/provider-claude-code/server.ts`, `plugins/provider-claude-code/src/bridge/provider-maintenance.ts`, `plugins/provider-acp/{server.ts, src/known-agents.ts, src/declaration.ts, src/agents.ts, src/configured-agents.ts, src/host.ts}`, `plugins/account-pool/src/{server.ts, rpc.ts, contracts.ts, store.ts, hub.ts, usage-source.ts}`, `plugins/provider-usage/{server.ts, usage-source-contract.ts, usage-schema.ts, usage-normalization.ts}`, `packages/process-utils/src/index.ts` (env sanitization)
- Installed runtime (read-only): `/Applications/Arc Agent.app/Contents/Resources`, `~/.bb/plugin-host-artifacts/*/host.mjs`, `~/.bb/plugins/`

### Source observations

- ALL first-party provider plugin sources absent locally (provider-codex, provider-claude-code, provider-acp, provider-pi, provider-usage, account-pool). Fork commit `ab0a19549` makes the build tolerate this; running app uses prebuilt host artifacts.
- Provider IDs confirmed: `codex`, `claude-code`, `acp-omp`, `pi` (own plugin), `acp-opencode`, `acp-cursor`, `acp-grok`, `acp-hermes-agent` (ACP known agents, verified in installed artifact).
- Codex has NO usable executable override in production (bridge env knob stripped by BB_* sanitization; no passthrough declared). Claude HAS `BB_CLAUDE_CODE_EXECUTABLE` (sole passthrough, X_OK-validated, used everywhere). OMP has NO override; `customAgents` id=omp with absolute command is the only replacement mechanism.
- Generic usage-source (`provider-usage.v1.*`) exists ONLY upstream; local usage path is the old per-provider `provider.usage` host RPC. Mission Control uses `usage_dashboard_get` → direct + pool model.
- Generated Electron config STILL contains `publish.url = https://github.com/get-bb/bb/releases/download/desktop-latest/` and `appId = dev.bb.desktop`; auto-update disabled by default (`BB_DESKTOP_AUTO_UPDATE=1` gate); installed app ships no app-update.yml.
- Mission Control pins plugin-sdk 0.4.87 vs local 0.4.99 (build warns, succeeds).
- Desktop child-env seam for private PATH: `spawnOwnedRuntime` (main.ts:1965).

### Commands run

- `git branch --show-current / rev-parse HEAD / log -1 / status --short / remote -v` → main, 4113ce06, 1 dirty file (pre-existing dist artifact), 3 remotes (origin=fork, upstream=get-bb/bb EXISTS, the-arc)
- `node/npm/pnpm/bb --version` → v24.16.0 / 11.13.0 / 9.15.0 / 0.43.1
- Path inventory loop (plan §4.1) → all provider plugins MISSING, core packages + desktop + Mission Control PRESENT
- `git diff upstream/main -- apps/desktop …` → rebrand diff (12 files)
- `node apps/desktop/scripts/run-electron-builder.mjs --print-config` → confirms BB feed in generated config
- `bb plugin list` → Mission Control running from path source; account-pool needs-configuration
- Version reads from package.jsons
- Git-history divergence comparison: NOT run (denied; recorded as unmeasured)

### Tests

- `pnpm --filter @bb/desktop typecheck` → PASS
- `pnpm --filter @bb/desktop test` → FAIL 3/393 (nightly publish-feed test = fork-induced; 2 others pre-existing)
- `pnpm --filter @bb/agent-runtime test` → FAIL 5/331 (all `runtime.codex-topology.test.ts`; root cause: missing `plugins/provider-codex` sources — known fork limitation)
- `bb plugin build` (Mission Control) → PASS (SDK pin warning only)

### Risks

- R1: Generated config still ships BB update feed → must be fixed deliberately in Phase 12 (stop condition #11 watch item).
- R2: Codex executable override needs a small plugin patch (passthrough + probe helper); without it Arc-managed Codex can turn but health lies.
- R3: Provider plugin sources absent → any provider-behavior change requires porting sources from upstream into the fork (deliberate sync decision before Phase 3).
- R4: SDK pin drift (0.4.87 vs 0.4.99) in Mission Control.
- R5: 3 desktop tests failing before any change; Phase 1+ must not increase this count.

### Gate

PASS — all Phase 0 questions answerable; no blocker to Phase 1. Known failures are pre-existing and classified.

### Next phase

Phase 1 — runtime path/environment scaffolding (pending user approval; NOT started).

---

## Phase 1 — Arc Private Runtime Path and Environment Foundation

Date: 2026-09-18. Same checkout @ `4113ce06` (verified clean against Phase 0 baseline before editing).

### Files changed

- `apps/desktop/src/arc-runtime/types.ts` — new; `ArcRuntimeId` ("codex" | "claude-code" | "omp"), `ArcActiveRuntime`.
- `apps/desktop/src/arc-runtime/paths.ts` — new; `createArcRuntimePaths({ userDataPath })` resolving `arc-runtimes/` root, `runtime-manifest.json`, `staging/`, `runtimes/<id>/<version>/` family/version/executable paths. Executable names: codex→codex, claude-code→claude, omp→omp.
- `apps/desktop/src/arc-runtime/environment.ts` — new; `buildArcManagedRuntimeEnvironment` (pure: prepends active-runtime dirs before original PATH, platform-aware delimiter, no empty PATH entries, dedup, immutable input) and `resolveActiveArcRuntimes` (minimal resolver returning none until Phase 2 manifest lands).
- `apps/desktop/src/main.ts` — `spawnOwnedRuntime` now builds the child env via the Arc runtime module (paths from `args.userDataPath`) before adding `APP_SURFACE`; no probing logic in main.ts.
- `apps/desktop/test/arc-runtime.test.ts` — new; 19 tests covering plan Tests A–J (no-runtimes no-op, codex-only, omp-only, deterministic codex→omp→claude order, Claude override set/wins/absent, existing override preserved, spaces in PATH and userData, PATH undefined/empty, immutability, dedup).

### Decisions

- ADR-015 added: Arc-managed active Claude wins `BB_CLAUDE_CODE_EXECUTABLE` for the owned child; otherwise existing env value untouched. No Codex/OMP env overrides fabricated.
- Prepend precedence fixed as codex → omp → claude-code (plan STEP 9 order).

### Tests

- `pnpm --filter @bb/desktop typecheck` → PASS
- `vitest run test/arc-runtime.test.ts` → 19/19 PASS
- `pnpm --filter @bb/desktop test` → 408 passed, 3 failed — failures identical to Phase 0 baseline (nightly publish-feed, server-moved notice, browser-view popup). Zero regressions.

### Not done (deliberately, per plan)

Runtime downloads/packaging, Codex provider patch, manifest/active-runtime population, updater changes, agent picker restriction.

### Gate

PASS. Phase 2 entry point: `resolveActiveArcRuntimes` + `runtime-manifest.json` (paths already resolved by `paths.manifestPath`).

---

## Phase 2 — Arc Runtime Manifest + Compatibility Policy

Date: 2026-09-19. Same checkout @ `4113ce06` (verified against Phase 1 state before editing).

### Files changed

- `apps/desktop/src/arc-runtime/types.ts` — added `ArcRuntimeSource`, `ArcRuntimeCompatibility`, `ARC_RUNTIME_IDS`.
- `apps/desktop/src/arc-runtime/manifest.ts` — new; Zod v1 manifest schema (`schemaVersion`, `createdByArcVersion`, `platform`, per-runtime `activeVersion`/`previousVersion`/`source`/`digest`/`installedAt`), `readArcRuntimeManifest` (missing → default; malformed/invalid → recoverable `invalid` with default; future schema → `unsupported-version` with file preserved), `writeArcRuntimeManifest` (atomic tmp+rename, 0600, parent mkdir), `createEmptyArcRuntimeManifest`, `resolveArcPlatformIdentity` (`<platform>-<arch>`, e.g. `darwin-arm64`).
- `apps/desktop/src/arc-runtime/compatibility.ts` — new; semver-based `evaluateArcRuntimeCompatibility` returning supported/untested/blocked + reason. Bootstrap policy: Codex `minimum: 0.136.0` only (provenance: upstream provider-codex `minimumSupportedVersion`, Phase 0). No tested maximums recorded yet → nothing claims "supported".
- `apps/desktop/src/arc-runtime/environment.ts` — `resolveActiveArcRuntimes` is now async and manifest-backed: manifest activeVersion + executable existence (regular file, X_OK on POSIX) required; stale entries skipped with diagnostics; corrupt/future manifests → no Arc runtimes, never throws.
- `apps/desktop/src/main.ts` — `spawnOwnedRuntime` awaits the resolver with platform identity, `app.getVersion()` as creator version, and `desktopLogger.warn` diagnostics.
- Tests: `test/arc-runtime-manifest.test.ts` (11), `test/arc-runtime-compatibility.test.ts` (9), `test/arc-runtime-resolution.test.ts` (8); updated the stale Phase 1 resolver test in `test/arc-runtime.test.ts`.

### Corruption behavior

Missing/malformed/invalid manifest → desktop starts with zero Arc-managed runtimes, warning logged, system PATH behavior unchanged. Future `schemaVersion` → file preserved byte-for-byte, runtimes ignored.

### Compatibility logic

below minimum → blocked; known-bad list → blocked; above tested max → untested; no tested max recorded → untested; malformed/unknown → untested. Only Codex minimum 0.136.0 is policy today, from upstream evidence.

### Decisions

ADR-016 through ADR-019 added.

### Tests

- `pnpm --filter @bb/desktop typecheck` → PASS
- arc-runtime focused suites → 46/46 PASS
- `pnpm --filter @bb/desktop test` → 435 passed / 3 failed — failures identical to Phase 0/1 baseline. Zero regressions.

### Unresolved items

- `createdByArcVersion` temporarily uses the desktop app version; replace when independent Arc version metadata lands (Phase 12 territory).
- Tested maximums for all three runtimes are pinned when each runtime is introduced (Phases 3–5).
- Manifest repair/reconcile operation for stale entries — later phase.
- No vendor `--version` probing yet (deliberate; arrives with runtime installation phases).

### Gate

PASS.

---

## Phase 3 — Arc-Managed Codex Runtime

Date: 2026-09-19. Same checkout @ `4113ce06` (verified against Phase 2 state before editing).

### Pinned release (independently verified against GitHub)

- Version: **0.155.1** — tag `rust-v0.155.1`, release name `0.155.1`, **not** a prerelease, not a draft (GitHub API, 2026-09-19)
- Asset: `codex-aarch64-apple-darwin.tar.gz` (90,600,719 bytes) — archive contains exactly one entry, the platform executable (228,803,200 bytes uncompressed)
- Archive SHA-256: `5e5a51470dce2423f9d96bd191d0bbc4cc0e2848a6833df5178eaf47a07a3768` — **exact match** (computed locally after download)
- Executable SHA-256: `8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e` — recorded in pinned metadata
- `--version` output: `codex-cli 0.155.1` (parsed by semver regex, not string-equality on the human-readable prefix)
- License: **Apache-2.0** confirmed from the tag (`LICENSE`); upstream `NOTICE` exists (OpenAI Codex © 2025, Ratatui MIT attribution) and is preserved verbatim in the bundled third-party notices
- All prompt-supplied values matched the official metadata; no divergence, no silent version switch

### License / attribution

- `apps/desktop/third-party-notices/codex.md` (source-controlled): component, version, tag, source URL, download URL, Apache-2.0 reference, upstream NOTICE verbatim
- Copied into the bundle at `Contents/Resources/arc-runtimes/THIRD_PARTY_NOTICES.md` by the prepare script; test-asserted

### Architecture (two layers)

- Layer A — packaged immutable seed: `apps/desktop/resources/arc-runtimes/` (gitignored build output, produced by `scripts/prepare-arc-runtimes.mts`) → electron-builder `extraResources` → `Arc Agent.app/Contents/Resources/arc-runtimes/codex/0.155.1/codex`
- Layer B — user-managed copy: `<userData>/arc-runtimes/runtimes/codex/0.155.1/codex`, created by `src/arc-runtime/bootstrap.ts` (`prepareArcManagedRuntimes`), executed via the Phase 1 private child PATH; the seed is never executed or mutated at runtime
- New modules: `releases.ts` (pinned metadata + allowlist validation), `digest.ts`, `probe.ts`, `archive.ts` (single-entry tar inspection, traversal rejection), `acquire.ts` (testable staging pipeline), `bootstrap.ts` (fresh install / idempotence / same-pin repair / no-downgrade / kept-broken / manifest-last)

### Acquisition security

Download URL comes only from pinned backend metadata, validated to be `https` + `github.com/openai/codex/releases/download/` + exact asset name; `latest` aliases rejected by validator and tested. Download cached by archive digest in `.arc-runtime-cache/` (gitignored); every integrity failure aborts with non-zero exit. Extraction inspects the tar listing first (rejects multi-entry, absolute, `..`, separator/space names), extracts only the validated single entry, requires a regular file, and renames to exactly `codex` with 0o755.

### Bootstrap behavior (all test-proven)

- A fresh install (no manifest) copies from seed → verifies staged digest → probes staged version → moves into place → writes manifest last (`activeVersion=0.155.1`, `source=arc-bundled`, `digest`, `installedAt`, `previousVersion=null`)
- Idempotent restart: reuses the verified copy, no rewrite (installedAt stable)
- Same-pin repair: missing managed binary → reinstalled from seed, full verification, manifest preserved
- Valid newer active (0.156.0): **not** downgraded
- Broken different version: `kept-broken` diagnostic, no silent replacement
- Copy failure / seed digest failure / version-probe failure: manifest unchanged, Arc continues opening
- Steady-state launch does not re-hash the 229 MB binary (ADR-024)

### Provider integration

The existing prebuilt provider-codex resolves bare `"codex"` from `process.env.PATH` at all launch/probe/health sites (verified in the installed host artifact). No provider source ported; no new env override. End-to-end proof: environment tests spawn a real `codex --version` against the built child env — Arc-managed binary wins over a fake global Codex, and resolves with `PATH=/usr/bin:/bin` plus isolated HOME (no `~/.codex` involvement). Known cosmetic gap: install-status may report npm-global source for a managed binary (later provider-source phase).

### Compatibility policy

Codex `minimum: 0.136.0` (upstream provider constraint), `maximumTested: 0.155.1` (this phase's pin). Semantics: versions within [minimum, maximumTested] minus known-bad list are "supported by this Arc build" — not individually tested releases. 0.120.0 → blocked, 0.136.0 → supported, 0.155.1 → supported, 0.156.0 → untested.

### Files changed

- Application source: `arc-runtime/{releases,digest,probe,archive,acquire,bootstrap}.ts` (new), `paths.ts` (exported `arcRuntimeExecutableName`), `compatibility.ts` (maximumTested), `app-paths.ts` (`resolveArcRuntimeSeedRoot`), `main.ts` (bootstrap call before resolver, thin)
- Build: `scripts/prepare-arc-runtimes.mts` (new), `electron-builder.config.json` (`extraResources`), `package.json` (`prepare-arc-runtimes` wired into dev/dist/package chains), `.gitignore` (narrow: `.arc-runtime-cache/`, `resources/arc-runtimes/`)
- Notices: `third-party-notices/codex.md` (new, source-controlled)
- Tests: `arc-runtime-releases.test.ts` (12), `arc-runtime-acquire.test.ts` (8), `arc-runtime-bootstrap.test.ts` (11), `arc-runtime-environment.test.ts` (3), `arc-runtime-real-binary.test.ts` (4, conditional on staged seed), compatibility file (+1 matrix test)
- Generated build artifacts: `apps/desktop/resources/arc-runtimes/**` and `apps/desktop/.arc-runtime-cache/**` (gitignored, not committed)

### Packaging verification

`pnpm --filter @bb/desktop run package` (unpacked `--mac --dir --arm64`, does NOT touch `/Applications`) produced `release/mac-arm64/Arc Agent.app` containing `Contents/Resources/arc-runtimes/codex/0.155.1/codex` with digest `8eaf1ad1…a9e` (exact pinned match) and working `codex-cli 0.155.1`; only the Apple-silicon seed is packaged; `THIRD_PARTY_NOTICES.md` present. Local build unsigned (no Developer ID identity on this machine) — the seed sits inside the bundle resource tree so normal Electron bundle signing covers it when a signing identity is present; release-signing/notarization validation remains Phase 22.

### Tests

- `pnpm --filter @bb/desktop typecheck` → PASS
- Phase 3 focused suites → 47/47 PASS (includes real-binary digest + version + notices assertions against the staged seed)
- `pnpm --filter @bb/desktop test` → **473 passed / 3 failed** — failures identical to Phase 0–2 baseline (nightly publish-feed, server-moved notice, browser-view popup). +38 tests, zero regressions.

### Decisions

ADR-020 through ADR-024 added.

### Unresolved items

- Provider install-source/health cosmetics for managed binaries (npm-global detection) — later provider-source phase.
- Live full-app provider turn against Arc Codex (requires accounts; Phase 7+). PATH resolution proven at process level + provider artifact verified PATH-based.
- Runtime update/rollback UI and manifest reconcile — Phase 11.
- Release signing/notarization — Phase 22.

### Gate

PASS.

---

## Phase 4 — Arc-Managed OMP / Oh My Pi Runtime

Date: 2026-09-19. Same checkout @ `4113ce06` (verified against Phase 3 state before editing).

### Pinned release (independently verified against GitHub)

- Version: **18.2.6** — tag `v18.2.6`, release name `v18.2.6`, **not** a prerelease, not a draft, created 2026-09-18 (GitHub API, 2026-09-19)
- Asset: `omp-darwin-arm64` — direct standalone binary, **187,226,128 bytes** (not an archive)
- Asset SHA-256: `d498da40d577e1ffa681ca8632c2ea40a9f722a08b880412011d37dffee9513a` — **exact match** (GitHub API digest + locally computed after download, both equal)
- Version command: `omp --version` → output `omp/18.2.6` (parsed by the shared semver regex)
- License: **MIT**, verified verbatim at tag `v18.2.6` `LICENSE` — Copyright (c) 2025 Mario Zechner; 2025-2026 Can Bölük; 2026 Stencil Labs, Inc. Full text preserved in `apps/desktop/third-party-notices/omp.md` and shipped in the bundle
- All prompt-supplied values matched official metadata; no divergence, no silent version switch

### Artifact-kind architecture

`ArcRuntimeRelease` gained `artifactKind: "archive" | "executable"`. Archive assets (Codex) keep the Phase 3 single-entry tar extraction path; executable assets (OMP) are staged directly (regular-file check → source digest vs pin → copy → 0o755 → staged digest re-check → `--version` probe). Download cache keys on the asset digest with a kind-specific extension (`.tar.gz` / `.bin`); cache reuse still re-verifies SHA-256 — never bypassed. Trusted URL allowlist is per-runtime (`openai/codex`, `can1357/oh-my-pi`); `latest` aliases rejected; runtimes without a recorded origin fail validation. No OMP-only parallel pipeline; `prepareArcManagedRuntimes` default is now both pinned releases.

### ACP provider integration (verified, no source ported)

Installed provider-acp host artifact declares `acp-omp` as `launch: { command: "omp", args: ["acp"] }`, `signInCommand: "omp login"`, and resolves commands via bundled `resolveCommand`/`which` against the process PATH — the same pattern Codex uses (ADR-023/028). Private PATH suffices end to end. **Protocol-level proof**: spawned the real pinned `omp acp` with `PATH=/usr/bin:/bin` and an unused HOME; it answered an ACP `initialize` JSON-RPC request with `protocolVersion: 1`, `agentInfo: { name: "oh-my-pi", version: "18.2.6" }`, `authMethods` (existing local credentials), and `agentCapabilities { loadSession: true, … }` — **runtime ready with no AI account**, confirming runtime readiness is independent of account readiness. Capabilities ride under `agentCapabilities` (current ACP schema). Test-guarded (`arc-runtime-omp-acp.test.ts`, skipped if the real seed is absent).

### OMP config isolation (Option A — verified OMP overrides, Arc-child env only)

Source-verified against oh-my-pi v18.2.6 `packages/utils/src/dirs.ts` + `docs/config-usage.md`:

- `PI_CONFIG_DIR` relocates the OMP user config root (name joined under the process home); Arc sets it to the home-relative path of `<userData>/omp` when userData is inside home (the macOS `~/Library/Application Support/…` case); skipped (with `PI_CODING_AGENT_DIR` still set) if userData ever lives outside home
- `PI_CODING_AGENT_DIR` absolutely overrides the agent dir (settings, auth storage `agent.db`, sessions, `mcp.json`) for the default profile — always set to `<userData>/omp/agent`
- No XDG variables needed: with the config root relocated, every data/state/cache category falls back under the Arc root; external `~/.omp` is never touched
- No invented `OMP_*` variables; nothing global is modified; standalone OMP and normal terminals unaffected
- Broker note for later phases: `omp auth-broker serve` binds `127.0.0.1:8765` by default, token file `<config-dir>/auth-broker.token` mode 0600/0700; `auth-broker list --json` enumerates **registered OAuth provider definitions, not connected accounts** (docs-verified — matters for the Accounts page); endpoints `/v1/{healthz,snapshot,usage,credentials/check,…}` are bearer-gated except `healthz`

### Bootstrap behavior for OMP (all test-proven, generic engine reused)

- Fresh install: seed digest + probe → staged copy verified → moved to `runtimes/omp/18.2.6/omp` → manifest last (`activeVersion=18.2.6`, `source=arc-bundled`, digest, `installedAt`, `previousVersion=null`)
- Idempotent restart reuses the copy; same-version missing binary repaired from seed; valid newer active (18.3.0) never downgraded; broken different version → `kept-broken`; digest mismatch → manifest untouched
- All existing Codex bootstrap/acquire tests pass unchanged in behavior

### Compatibility policy

OMP `minimum = maximumTested = 18.2.6` (ADR-027): 18.2.6 → supported, 18.3.0 → untested, 18.2.5/17.x → blocked. Codex policy untouched.

### Files changed

- `src/arc-runtime/releases.ts` — artifact kinds, per-runtime URL allowlists, `ARC_OMP_RELEASE`, both-kind validation rules
- `src/arc-runtime/acquire.ts` — `assetPath` terminology, direct-executable staging branch
- `src/arc-runtime/bootstrap.ts` — default release list now both pins (no other change; engine was already generic)
- `src/arc-runtime/environment.ts` — OMP state isolation env (`PI_CONFIG_DIR`, `PI_CODING_AGENT_DIR`) on the Arc child env only
- `src/arc-runtime/compatibility.ts` — OMP policy
- `scripts/prepare-arc-runtimes.mts` — generalized asset cache (kind-specific extension), combined notices from all `third-party-notices/*.md`
- `third-party-notices/omp.md` (new, source-controlled; MIT verbatim)
- Tests: `arc-runtime-releases` (+9 OMP pin/validation), `arc-runtime-acquire` (+4 direct-executable, call-site rename), `arc-runtime-bootstrap-omp.test.ts` (new, 6), `arc-runtime-environment` (+5 OMP resolution/isolation), `arc-runtime-omp-acp.test.ts` (new, 1 real protocol handshake), `arc-runtime-real-binary` (+4 OMP digest/version/notice), `arc-runtime-compatibility` (+4 OMP matrix), fixture `artifactKind` additions
- No changes to `main.ts` (bootstrap default covers both), electron-builder config (whole `resources/arc-runtimes` tree already packaged), or any provider source

### Packaging verification

`pnpm --filter @bb/desktop run package` (unpacked `--mac --dir --arm64`; `/Applications` untouched) produced `release/mac-arm64/Arc Agent.app` containing BOTH:

```text
Contents/Resources/arc-runtimes/codex/0.155.1/codex  sha256 8eaf1ad1…a9e  → codex-cli 0.155.1
Contents/Resources/arc-runtimes/omp/18.2.6/omp        sha256 d498da40…513a → omp/18.2.6
Contents/Resources/arc-runtimes/THIRD_PARTY_NOTICES.md  (Apache-2.0 Codex + MIT OMP sections)
```

Only darwin-arm64 assets present. Local build unsigned for lack of a Developer ID identity (same as Phase 3; Phase 22 covers release signing).

### Tests

- `pnpm --filter @bb/desktop typecheck` → PASS
- Phase 4 focused suites → 80/80 PASS (8 files; includes real-binary OMP digest/version/notices and the real ACP `initialize` handshake)
- `pnpm --filter @bb/desktop test` → **506 passed / 3 failed** — failures identical to the Phase 0–3 baseline. +33 tests, zero regressions.

### Decisions

ADR-025 through ADR-028 added.

### Unresolved items

- First real OMP turn through the full BB stack requires accounts (Phase 7+); runtime readiness and ACP protocol startup are proven, account readiness is explicitly separate (`authMethods` drives it)
- Broker/client usage integration and the Accounts page (`auth-broker list` semantics) — Phase 8; security observations recorded above
- Broker default port 8765 could collide with a standalone-OMP broker; per-process env isolation avoids config collision, port coordination belongs to the broker-integration phase
- Runtime update/rollback UI — Phase 11; release signing — Phase 22

### Gate

PASS.
