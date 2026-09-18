import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

export const ARC_RUNTIME_MANIFEST_SCHEMA_VERSION = 1;

const arcRuntimeEntrySchema = z.object({
  activeVersion: z.string().min(1).nullable(),
  previousVersion: z.string().min(1).nullable(),
  source: z
    .enum([
      "arc-bundled",
      "arc-managed-download",
      "official-managed-install",
      "external-override",
    ])
    .nullable(),
  digest: z.string().min(1).nullable(),
  installedAt: z.number().int().nonnegative().nullable(),
});

export const arcRuntimeManifestSchema = z.object({
  schemaVersion: z.literal(ARC_RUNTIME_MANIFEST_SCHEMA_VERSION),
  createdByArcVersion: z.string().min(1),
  platform: z.string().min(1),
  runtimes: z.object({
    codex: arcRuntimeEntrySchema,
    "claude-code": arcRuntimeEntrySchema,
    omp: arcRuntimeEntrySchema,
  }),
});

export type ArcRuntimeManifest = z.infer<typeof arcRuntimeManifestSchema>;

export type ArcRuntimeManifestReadResult =
  | {
      kind: "ok";
      manifest: ArcRuntimeManifest;
    }
  | {
      kind: "missing";
      manifest: ArcRuntimeManifest;
    }
  | {
      kind: "invalid";
      manifest: ArcRuntimeManifest;
      problem: string;
    }
  | {
      kind: "unsupported-version";
      manifestPath: string;
      schemaVersion: number;
    };

export interface ResolveArcPlatformIdentityArgs {
  platform: NodeJS.Platform;
  arch: string;
}

export interface CreateEmptyArcRuntimeManifestArgs {
  createdByArcVersion: string;
  platform: string;
}

export interface ReadArcRuntimeManifestArgs
  extends CreateEmptyArcRuntimeManifestArgs {
  manifestPath: string;
}

export interface WriteArcRuntimeManifestArgs {
  manifestPath: string;
  manifest: ArcRuntimeManifest;
}

export function resolveArcPlatformIdentity(
  args: ResolveArcPlatformIdentityArgs,
): string {
  return `${args.platform}-${args.arch}`;
}

export function createEmptyArcRuntimeManifest(
  args: CreateEmptyArcRuntimeManifestArgs,
): ArcRuntimeManifest {
  const emptyEntry = {
    activeVersion: null,
    previousVersion: null,
    source: null,
    digest: null,
    installedAt: null,
  };
  return {
    schemaVersion: ARC_RUNTIME_MANIFEST_SCHEMA_VERSION,
    createdByArcVersion: args.createdByArcVersion,
    platform: args.platform,
    runtimes: {
      codex: { ...emptyEntry },
      "claude-code": { ...emptyEntry },
      omp: { ...emptyEntry },
    },
  };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function readArcRuntimeManifest(
  args: ReadArcRuntimeManifestArgs,
): Promise<ArcRuntimeManifestReadResult> {
  let raw: string;
  try {
    raw = await readFile(args.manifestPath, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return {
        kind: "missing",
        manifest: createEmptyArcRuntimeManifest(args),
      };
    }
    return {
      kind: "invalid",
      manifest: createEmptyArcRuntimeManifest(args),
      problem: `manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "invalid",
      manifest: createEmptyArcRuntimeManifest(args),
      problem: "manifest is not valid JSON",
    };
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    typeof parsed.schemaVersion === "number" &&
    parsed.schemaVersion > ARC_RUNTIME_MANIFEST_SCHEMA_VERSION
  ) {
    return {
      kind: "unsupported-version",
      manifestPath: args.manifestPath,
      schemaVersion: parsed.schemaVersion,
    };
  }

  const result = arcRuntimeManifestSchema.safeParse(parsed);
  if (!result.success) {
    return {
      kind: "invalid",
      manifest: createEmptyArcRuntimeManifest(args),
      problem: `manifest does not match schema version ${ARC_RUNTIME_MANIFEST_SCHEMA_VERSION}`,
    };
  }

  return { kind: "ok", manifest: result.data };
}

export async function writeArcRuntimeManifest(
  args: WriteArcRuntimeManifestArgs,
): Promise<void> {
  const manifest = arcRuntimeManifestSchema.parse(args.manifest);
  const directory = dirname(args.manifestPath);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${basename(args.manifestPath)}.tmp`);
  try {
    await unlink(tempPath);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      throw error;
    }
  }
  try {
    await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(tempPath, args.manifestPath);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}
