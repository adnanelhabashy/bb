import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256File } from "./digest.js";
import {
  readArcRuntimeManifest,
  writeArcRuntimeManifest,
  type ArcRuntimeManifest,
} from "./manifest.js";
import { arcRuntimeExecutableName, type ArcRuntimePaths } from "./paths.js";
import { probeArcRuntimeVersion } from "./probe.js";
import {
  ARC_RUNTIME_RELEASES,
  validateArcRuntimeRelease,
  type ArcRuntimeRelease,
} from "./releases.js";
import type { ArcRuntimeId } from "./types.js";

export type ArcRuntimeBootstrapAction =
  | "installed"
  | "already-active"
  | "repaired"
  | "seed-missing"
  | "kept-existing"
  | "kept-broken"
  | "failed";

export interface ArcRuntimeBootstrapResult {
  runtimeId: ArcRuntimeId;
  action: ArcRuntimeBootstrapAction;
  detail: string;
}

export interface PrepareArcManagedRuntimesArgs {
  createdByArcVersion: string;
  onDiagnostic?: (message: string) => void;
  platform: string;
  releases?: readonly ArcRuntimeRelease[];
  runtimePaths: ArcRuntimePaths;
  seedRoot: string;
}

async function isRunnableExecutable(
  path: string,
  isWindows: boolean,
): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      return false;
    }
    if (isWindows) {
      return true;
    }
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function diagnose(
  args: PrepareArcManagedRuntimesArgs,
  message: string,
): void {
  args.onDiagnostic?.(`[arc-runtime] ${message}`);
}

async function installFromSeed(args: {
  manifest: ArcRuntimeManifest;
  manifestPath: string;
  release: ArcRuntimeRelease;
  repair: boolean;
  runtimePaths: ArcRuntimePaths;
  seedPath: string;
}): Promise<ArcRuntimeBootstrapResult> {
  const { release, runtimePaths, seedPath, manifest, manifestPath, repair } =
    args;
  const existing = manifest.runtimes[release.runtimeId];
  const isWindows = manifest.platform.startsWith("win32");

  const seedDigest = await sha256File(seedPath).catch(() => null);
  if (seedDigest !== release.executableSha256) {
    return {
      runtimeId: release.runtimeId,
      action: "failed",
      detail: `bundled seed digest mismatch: expected ${release.executableSha256}, got ${seedDigest ?? "unreadable"}`,
    };
  }
  const seedProbe = await probeArcRuntimeVersion({ executablePath: seedPath });
  if (
    seedProbe.kind === "failed" ||
    seedProbe.version !== release.expectedExecutableVersion
  ) {
    return {
      runtimeId: release.runtimeId,
      action: "failed",
      detail:
        seedProbe.kind === "failed"
          ? `seed version probe failed: ${seedProbe.reason}`
          : `seed reports ${seedProbe.version}, expected ${release.expectedExecutableVersion}`,
    };
  }

  const versionRoot = runtimePaths.versionRoot(
    release.runtimeId,
    release.version,
  );
  await mkdir(runtimePaths.stagingRoot, { recursive: true });
  const stagingDir = join(
    runtimePaths.stagingRoot,
    `${release.runtimeId}-${release.version}-${process.pid}`,
  );
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  try {
    const stagedExecutable = join(
      stagingDir,
      arcRuntimeExecutableName(release.runtimeId),
    );
    await copyFile(seedPath, stagedExecutable);
    await chmod(stagedExecutable, isWindows ? 0o644 : 0o755);

    const stagedDigest = await sha256File(stagedExecutable);
    if (stagedDigest !== release.executableSha256) {
      return {
        runtimeId: release.runtimeId,
        action: "failed",
        detail: "copied executable digest mismatch; refusing to activate",
      };
    }
    const stagedProbe = await probeArcRuntimeVersion({
      executablePath: stagedExecutable,
    });
    if (
      stagedProbe.kind === "failed" ||
      stagedProbe.version !== release.expectedExecutableVersion
    ) {
      return {
        runtimeId: release.runtimeId,
        action: "failed",
        detail: "copied executable failed version verification",
      };
    }

    await mkdir(dirname(versionRoot), { recursive: true });
    await rm(versionRoot, { recursive: true, force: true });
    await rename(stagingDir, versionRoot);

    const nextManifest: ArcRuntimeManifest = {
      ...manifest,
      runtimes: {
        ...manifest.runtimes,
        [release.runtimeId]: {
          activeVersion: release.version,
          previousVersion: repair
            ? existing.previousVersion
            : existing.activeVersion,
          source: "arc-bundled",
          digest: stagedDigest,
          installedAt: Date.now(),
        },
      },
    };
    await writeArcRuntimeManifest({ manifest: nextManifest, manifestPath });

    return {
      runtimeId: release.runtimeId,
      action: repair ? "repaired" : "installed",
      detail: `${release.runtimeId} ${release.version} ${
        repair ? "repaired from" : "installed from"
      } bundled seed (digest ${stagedDigest})`,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function bootstrapRelease(
  args: PrepareArcManagedRuntimesArgs,
  release: ArcRuntimeRelease,
  seedPath: string,
): Promise<ArcRuntimeBootstrapResult> {
  const validation = validateArcRuntimeRelease(release);
  if (validation.kind === "invalid") {
    return {
      runtimeId: release.runtimeId,
      action: "failed",
      detail: `invalid pinned release metadata: ${validation.problem}`,
    };
  }

  const isWindows = args.platform.startsWith("win32");
  const manifestPath = args.runtimePaths.manifestPath;
  const manifestResult = await readArcRuntimeManifest({
    createdByArcVersion: args.createdByArcVersion,
    manifestPath,
    platform: args.platform,
  });
  if (manifestResult.kind === "unsupported-version") {
    return {
      runtimeId: release.runtimeId,
      action: "failed",
      detail: `manifest declares unsupported schema version ${manifestResult.schemaVersion}; leaving untouched`,
    };
  }
  const manifest = manifestResult.manifest;
  const entry = manifest.runtimes[release.runtimeId];

  if (entry.activeVersion === release.version) {
    const executablePath = args.runtimePaths.executablePath(
      release.runtimeId,
      release.version,
    );
    if (await isRunnableExecutable(executablePath, isWindows)) {
      if (entry.digest === null) {
        const digest = await sha256File(executablePath).catch(() => null);
        if (digest !== null) {
          await writeArcRuntimeManifest({
            manifest: {
              ...manifest,
              runtimes: {
                ...manifest.runtimes,
                [release.runtimeId]: { ...entry, digest },
              },
            },
            manifestPath,
          });
        }
      }
      return {
        runtimeId: release.runtimeId,
        action: "already-active",
        detail: `${release.runtimeId} ${release.version} already active; reusing verified copy`,
      };
    }
    diagnose(
      args,
      `${release.runtimeId} ${release.version} active in manifest but ${executablePath} is missing or broken; repairing from bundled seed`,
    );
    const result = await installFromSeed({
      manifest,
      manifestPath,
      release,
      repair: true,
      runtimePaths: args.runtimePaths,
      seedPath,
    });
    if (result.action === "repaired") {
      return result;
    }
    return {
      runtimeId: release.runtimeId,
      action: "failed",
      detail: `repair failed: ${result.detail}`,
    };
  }

  if (entry.activeVersion !== null) {
    const executablePath = args.runtimePaths.executablePath(
      release.runtimeId,
      entry.activeVersion,
    );
    if (await isRunnableExecutable(executablePath, isWindows)) {
      return {
        runtimeId: release.runtimeId,
        action: "kept-existing",
        detail: `${release.runtimeId} ${entry.activeVersion} is active and valid; bundled seed ${release.version} will not force a downgrade`,
      };
    }
    return {
      runtimeId: release.runtimeId,
      action: "kept-broken",
      detail: `${release.runtimeId} ${entry.activeVersion} is active but its executable is broken; recovery is deferred to the runtime repair/update flow`,
    };
  }

  return installFromSeed({
    manifest,
    manifestPath,
    release,
    repair: false,
    runtimePaths: args.runtimePaths,
    seedPath,
  });
}

export async function prepareArcManagedRuntimes(
  args: PrepareArcManagedRuntimesArgs,
): Promise<ArcRuntimeBootstrapResult[]> {
  const results: ArcRuntimeBootstrapResult[] = [];
  const releases = args.releases ?? ARC_RUNTIME_RELEASES;
  for (const release of releases) {
    const seedPath = join(
      args.seedRoot,
      release.runtimeId,
      release.version,
      arcRuntimeExecutableName(release.runtimeId),
    );
    const seedExists = await isRunnableExecutable(
      seedPath,
      args.platform.startsWith("win32"),
    );
    if (!seedExists) {
      diagnose(
        args,
        `bundled ${release.runtimeId} seed not available at ${seedPath}; skipping managed runtime bootstrap`,
      );
      results.push({
        runtimeId: release.runtimeId,
        action: "seed-missing",
        detail: `no bundled seed at ${seedPath}`,
      });
      continue;
    }

    try {
      results.push(await bootstrapRelease(args, release, seedPath));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      diagnose(args, `${release.runtimeId} bootstrap failed: ${detail}`);
      results.push({ runtimeId: release.runtimeId, action: "failed", detail });
    }
  }
  return results;
}
