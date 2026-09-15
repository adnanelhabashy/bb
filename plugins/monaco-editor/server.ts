import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { fileReferenceSchema } from "@bb/server-contract/file-reference";
import { z } from "zod";

const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

const MAX_TREE_ENTRIES = 10_000;

const ASSET_LEASE_TTL_MS = 60 * 60 * 1000;

const ASSET_LEASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const fileSchema = z.object({ file: fileReferenceSchema }).strict();

export const rpcContract = defineRpcContract({
  assets: {
    input: z.null(),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
  read: {
    input: fileSchema,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        absolutePath: z.string(),
        relativePath: z.string(),
      }),
      z.object({ kind: z.literal("unsupported"), reason: z.string() }),
    ]),
  },
  tree: {
    input: fileSchema,
    output: z.object({
      root: z.string(),
      entries: z.array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      ),
      truncated: z.boolean(),
    }),
  },
  write: {
    input: fileSchema.extend({
      content: z.string(),
      expectedSha256: z.string().nullable(),
    }),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("written"), sha256: z.string() }),
      z.object({
        outcome: z.literal("conflict"),
        currentSha256: z.string().nullable(),
      }),
    ]),
  },
});

function isBundleStale(moduleDir: string, bundleDir: string): boolean {
  const builtAtMs = statSync(path.join(bundleDir, "editor.js")).mtimeMs;
  const entryDir = path.join(moduleDir, "monaco-bundle");
  if (!existsSync(entryDir)) return false;

  const inputs = [
    path.join(moduleDir, "scripts", "stage-assets.mjs"),
    ...readdirSync(entryDir).map((name) => path.join(entryDir, name)),
    path.join(moduleDir, "package.json"),
  ];
  return inputs.some(
    (input) => existsSync(input) && statSync(input).mtimeMs > builtAtMs,
  );
}

async function ensureMonacoBundleDir(
  log: (message: string) => void,
): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "monaco"),
    path.join(moduleDir, "dist", "monaco"),
  ];
  const built = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (built !== undefined && !isBundleStale(moduleDir, built)) return built;

  log(
    built === undefined
      ? "Monaco bundle missing; building it (first run in a source checkout)"
      : "Monaco bundle is older than its sources; rebuilding it",
  );
  const script = new URL("./scripts/stage-assets.mjs", import.meta.url).href;
  await import(script);

  const staged = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (staged === undefined) {
    throw new Error(
      "could not build the Monaco bundle; run `pnpm --filter bb-plugin-monaco-editor build:monaco`",
    );
  }
  return staged;
}

export default async function plugin(bb: BbPluginApi) {
  let assetLease: { baseUrl: string; expiresAtMs: number } | null = null;

  async function assets() {
    const now = Date.now();
    if (
      assetLease === null ||
      assetLease.expiresAtMs - now < ASSET_LEASE_REFRESH_MARGIN_MS
    ) {
      const bundleDir = await ensureMonacoBundleDir((message) =>
        bb.log.info(message),
      );
      assetLease = await bb.sdk.files.createPreview({
        rootPath: bundleDir,
        ttlMs: ASSET_LEASE_TTL_MS,
      });
    }
    return assetLease;
  }

  bb.rpc.register(rpcContract, {
    assets: () => assets(),

    async read({ file }) {
      const [result, resource] = await Promise.all([
        bb.sdk.files.read({ experimental_target: file }),
        bb.sdk.files.experimental_resolveResource({ target: file }),
      ]);

      if (result.contentEncoding !== "utf8") {
        return {
          kind: "unsupported" as const,
          reason: "This file is not text",
        };
      }
      if (result.sizeBytes > MAX_EDITABLE_BYTES) {
        return {
          kind: "unsupported" as const,
          reason: `This file is too large to edit (${Math.round(result.sizeBytes / 1024 / 1024)} MB)`,
        };
      }
      return {
        kind: "text" as const,
        content: result.content,
        sha256: result.sha256,
        absolutePath: resource.absolutePath,
        relativePath: resource.path,
      };
    },

    async tree({ file }) {
      const resource = await bb.sdk.files.experimental_resolveResource({
        target: file,
      });
      const result = await bb.sdk.files.listPaths({
        experimental_target: file,
        experimental_directory: "root",
        includeFiles: true,
        includeDirectories: true,
        includeHidden: true,
        limit: MAX_TREE_ENTRIES,
      });
      return {
        root: resource.rootPath,
        entries: result.paths.map((entry) => ({
          path: entry.path,
          kind: entry.kind,
        })),
        truncated: result.truncated,
      };
    },

    async write({ file, content, expectedSha256 }) {
      const result = await bb.sdk.files.write({
        experimental_target: file,
        content,
        contentEncoding: "utf8",
        expectedSha256,
      });
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : { outcome: "conflict" as const, currentSha256: result.currentSha256 };
    },
  });
}
