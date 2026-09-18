import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArcManagedRuntimeEnvironment } from "../src/arc-runtime/environment.js";
import { createArcRuntimePaths } from "../src/arc-runtime/paths.js";
import type { ArcActiveRuntime } from "../src/arc-runtime/types.js";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "arc-env-test-"));
  tempDirs.push(dir);
  return dir;
}

async function fakeCodex(dir: string, identity: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "codex");
  await writeFile(path, `#!/bin/sh\necho "${identity}"\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

function codexVersion(
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("codex", ["--version"], { env, cwd }, (error, stdout) => {
      if (error !== null) {
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Arc-managed Codex environment resolution", () => {
  it("resolves Arc Codex even when a global Codex exists", async () => {
    const root = await tempDir();
    const userDataPath = join(root, "userData");
    const globalBin = join(root, "global-bin");
    const isolatedHome = join(root, "home");
    await mkdir(globalBin, { recursive: true });
    await mkdir(isolatedHome, { recursive: true });
    await fakeCodex(globalBin, "global-codex");
    const managedCodex = await fakeCodex(
      join(userDataPath, "arc-runtimes", "runtimes", "codex", "0.155.1"),
      "arc-managed-codex",
    );

    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const activeRuntimes: ArcActiveRuntime[] = [
      { id: "codex", executablePath: managedCodex },
    ];
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes,
      env: { PATH: globalBin, HOME: isolatedHome },
      platform: "darwin",
      runtimePaths,
    });

    await expect(codexVersion(env)).resolves.toBe("arc-managed-codex");
  });

  it("resolves Arc Codex with no Codex anywhere on the original PATH", async () => {
    const root = await tempDir();
    const userDataPath = join(root, "userData");
    const isolatedHome = join(root, "home");
    await mkdir(isolatedHome, { recursive: true });
    const managedCodex = await fakeCodex(
      join(userDataPath, "arc-runtimes", "runtimes", "codex", "0.155.1"),
      "arc-managed-codex",
    );

    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [{ id: "codex", executablePath: managedCodex }],
      env: { PATH: "/usr/bin:/bin", HOME: isolatedHome },
      platform: "darwin",
      runtimePaths,
    });

    expect(env.PATH?.startsWith(`${join(userDataPath, "arc-runtimes", "runtimes", "codex", "0.155.1")}:`)).toBe(
      true,
    );
    await expect(codexVersion(env)).resolves.toBe("arc-managed-codex");
  });

  it("preserves the original PATH when no Arc Codex is active", async () => {
    const userDataPath = join(await tempDir(), "userData");
    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [],
      env: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      runtimePaths,
    });
    expect(env.PATH).toBe("/usr/bin:/bin");
  });
});

async function fakeOmp(dir: string, identity: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, "omp");
  await writeFile(path, `#!/bin/sh\necho "${identity}"\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

function ompVersion(env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile("omp", ["--version"], { env }, (error, stdout) => {
      if (error !== null) {
        rejectPromise(error);
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

describe("Arc-managed OMP environment resolution", () => {
  it("resolves Arc OMP even when a global OMP exists", async () => {
    const root = await tempDir();
    const userDataPath = join(root, "userData");
    const globalBin = join(root, "global-bin");
    const managedOmp = await fakeOmp(
      join(userDataPath, "arc-runtimes", "runtimes", "omp", "18.2.6"),
      "arc-managed-omp",
    );
    await fakeOmp(globalBin, "global-omp");

    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [{ id: "omp", executablePath: managedOmp }],
      env: { PATH: globalBin },
      homeDirectory: join(root, "home"),
      platform: "darwin",
      runtimePaths,
    });

    await expect(ompVersion(env)).resolves.toBe("arc-managed-omp");
  });

  it("isolates OMP state under Arc userData via verified OMP overrides", async () => {
    const root = await tempDir();
    const homeDirectory = join(root, "home");
    // Mirrors macOS: Electron userData lives inside the user's home directory.
    const userDataPath = join(
      homeDirectory,
      "Library",
      "Application Support",
      "Arc Agent",
    );
    const managedOmp = await fakeOmp(
      join(userDataPath, "arc-runtimes", "runtimes", "omp", "18.2.6"),
      "arc-managed-omp",
    );

    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [{ id: "omp", executablePath: managedOmp }],
      env: { PATH: "/usr/bin:/bin" },
      homeDirectory,
      platform: "darwin",
      runtimePaths,
    });

    expect(env.PI_CODING_AGENT_DIR).toBe(join(userDataPath, "omp", "agent"));
    const relativeConfigDir = env.PI_CONFIG_DIR;
    expect(relativeConfigDir).toBeDefined();
    expect(join(homeDirectory, relativeConfigDir ?? "")).toBe(
      join(userDataPath, "omp"),
    );
  });

  it("does not leak isolation variables when Arc OMP is not active", async () => {
    const userDataPath = join(await tempDir(), "userData");
    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [],
      env: { PATH: "/usr/bin:/bin" },
      platform: "darwin",
      runtimePaths,
    });
    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(env.PI_CONFIG_DIR).toBeUndefined();
  });

  it("keeps existing user OMP overrides untouched when Arc OMP is not active", async () => {
    const userDataPath = join(await tempDir(), "userData");
    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [],
      env: {
        PATH: "/usr/bin:/bin",
        PI_CODING_AGENT_DIR: "/Users/someone/.omp/agent",
        PI_CONFIG_DIR: ".omp",
      },
      platform: "darwin",
      runtimePaths,
    });
    expect(env.PI_CODING_AGENT_DIR).toBe("/Users/someone/.omp/agent");
    expect(env.PI_CONFIG_DIR).toBe(".omp");
  });

  it("skips PI_CONFIG_DIR when userData lives outside the home directory", async () => {
    const root = await tempDir();
    const userDataPath = join(root, "userData");
    const homeDirectory = join(root, "home");
    const managedOmp = await fakeOmp(
      join(userDataPath, "arc-runtimes", "runtimes", "omp", "18.2.6"),
      "arc-managed-omp",
    );

    const runtimePaths = createArcRuntimePaths({ userDataPath });
    const env = buildArcManagedRuntimeEnvironment({
      activeRuntimes: [{ id: "omp", executablePath: managedOmp }],
      env: { PATH: "/usr/bin:/bin" },
      homeDirectory,
      platform: "darwin",
      runtimePaths,
    });

    expect(env.PI_CODING_AGENT_DIR).toBe(join(userDataPath, "omp", "agent"));
    expect(env.PI_CONFIG_DIR).toBeUndefined();
  });
});
