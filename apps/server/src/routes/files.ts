import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import mimeTypes from "mime-types";
import {
  publicApiRoutes,
  typedRoutes,
  type FileReference,
  type PublicApiSchema,
  type ResolveFileResourceResponse,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { browserRequestProblem } from "../browser-request-guard.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../types.js";
import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import {
  callHostOnlineRpcForWork,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  type DaemonFileReadResult,
  requireDaemonFileContentResult,
  remapDaemonFileRouteError,
  serveDaemonFileContent,
} from "../services/hosts/daemon-file-response.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../services/hosts/primary-host.js";
import {
  requireEnvironment,
  requirePublicThread,
  requirePublicThreadEnvironment,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { requireThreadStoragePath } from "../services/threads/thread-storage.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
} from "./path-list-policy.js";

const HOST_FILE_LIST_LIMIT_DEFAULT = 1000;

const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const HTML_PREVIEW_CONTENT_TYPE = "text/html; charset=utf-8";
const HTML_PREVIEW_CSP = "sandbox allow-scripts";
const NO_STORE_CACHE_CONTROL = "no-store";
const NOSNIFF_CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_MIME_TYPE = "text/html";
const FILE_PREVIEW_TTL_MS = 10 * 60 * 1000;

interface FilePreviewLease {
  hostId: string;
  rootPath: string;
  expiresAtMs: number;
}

interface ResolvedFileResource {
  hostId: string;
  path: string;
  relativePath: string;
  rootPath: string;
  target: ResolveFileResourceResponse["target"];
}

function normalizeMimeType(value: string | null | undefined): string | null {
  const normalizedValue = value?.split(";")[0]?.trim().toLowerCase();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

function isAbsoluteHostPath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeHostPath(value: string): string {
  return path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)
    ? path.win32.normalize(value)
    : path.posix.normalize(value);
}

function joinHostPath(rootPath: string, segments: string[]): string {
  return path.win32.isAbsolute(rootPath) && !path.posix.isAbsolute(rootPath)
    ? path.win32.join(rootPath, ...segments)
    : path.posix.join(rootPath, ...segments);
}

function splitAbsoluteHostPath(filePath: string): {
  path: string;
  relativePath: string;
  rootPath: string;
} {
  const hostPath =
    path.win32.isAbsolute(filePath) && !path.posix.isAbsolute(filePath)
      ? path.win32
      : path.posix;
  const normalizedPath = hostPath.normalize(filePath);
  const relativePath = hostPath.basename(normalizedPath);
  return {
    path: normalizedPath,
    relativePath,
    rootPath: hostPath.dirname(normalizedPath),
  };
}

function buildPreviewContentUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl}/${relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function isHtmlMimeType(value: string | null | undefined): boolean {
  return normalizeMimeType(value) === HTML_MIME_TYPE;
}

function createRawFilesystemPathInvalidError(): ApiError {
  return new ApiError(400, "invalid_path", "Invalid file path", false);
}

function createRawFilesystemPathUnsupportedError(): ApiError {
  return new ApiError(
    415,
    "unsupported_media_type",
    "HTML preview only supports text/html files",
    false,
  );
}

function parseRawFilesystemPath(rawPath: string): string {
  if (rawPath.includes("\0") || !path.isAbsolute(rawPath)) {
    throw createRawFilesystemPathInvalidError();
  }
  return path.resolve(rawPath);
}

function assertHtmlPreviewPath(filePath: string): void {
  if (!isHtmlMimeType(mimeTypes.lookup(filePath) || null)) {
    throw createRawFilesystemPathUnsupportedError();
  }
}

function assertRawFilesystemHtmlPreviewResult(
  result: DaemonFileReadResult,
): void {
  if (!isHtmlMimeType(result.mimeType) || result.contentEncoding !== "utf8") {
    throw createRawFilesystemPathUnsupportedError();
  }

  if (result.sizeBytes > HTML_PREVIEW_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "HTML preview exceeds the 5 MB limit",
      false,
    );
  }
}

function createRawFilesystemHtmlPreviewResponse(
  result: DaemonFileReadResult,
): Response {
  assertRawFilesystemHtmlPreviewResult(result);
  return createDaemonFileContentResponse(result, {
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-security-policy": HTML_PREVIEW_CSP,
      "content-type": HTML_PREVIEW_CONTENT_TYPE,
      "x-content-type-options": NOSNIFF_CONTENT_TYPE_OPTIONS,
    },
  });
}

async function serveRawFilesystemHtmlFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string,
): Promise<Response> {
  const filePath = parseRawFilesystemPath(rawPath);
  assertHtmlPreviewPath(filePath);
  const { environment } = requirePublicThreadEnvironment(deps.db, threadId);
  return serveDaemonFileContent(
    deps,
    {
      hostId: environment.hostId,
      path: filePath,
    },
    createRawFilesystemHtmlPreviewResponse,
  );
}

export function registerFileRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.rawFile, async (context, query) =>
    serveRawFilesystemHtmlFile(deps, context.req.param("id"), query.path),
  );

  const fileRoutes = publicApiRoutes.files;
  const previewRoutes = publicApiRoutes.filePreviews;
  const previewLeases = new Map<string, FilePreviewLease>();

  const createPreviewLease = (args: {
    hostId: string;
    rootPath: string;
    ttlMs?: number;
  }): { baseUrl: string; expiresAtMs: number } => {
    const now = Date.now();
    for (const [id, lease] of previewLeases) {
      if (lease.expiresAtMs <= now) previewLeases.delete(id);
    }
    const id = randomUUID();
    const expiresAtMs = now + (args.ttlMs ?? FILE_PREVIEW_TTL_MS);
    previewLeases.set(id, {
      hostId: args.hostId,
      rootPath: normalizeHostPath(args.rootPath),
      expiresAtMs,
    });
    return {
      baseUrl: `/api/v1/file-previews/${encodeURIComponent(id)}`,
      expiresAtMs,
    };
  };

  const resolveHostId = (hostId: string | undefined): string => {
    const resolved = hostId ?? requirePrimaryHostId(deps);
    assertUsableHostId(deps, { hostId: resolved });
    return resolved;
  };

  const requirePrivilegedJsonMutation = (
    context: Parameters<typeof browserRequestProblem>[0],
  ): void => {
    const problem = browserRequestProblem(context, deps, {
      requireJsonForMutation: true,
    });
    if (problem === null) {
      return;
    }
    throw new ApiError(
      problem.status,
      problem.status === 403 ? "forbidden_origin" : "unsupported_media_type",
      problem.error,
      false,
    );
  };

  for (const route of [
    fileRoutes.write,
    fileRoutes.mkdir,
    fileRoutes.move,
    fileRoutes.remove,
  ]) {
    app.use(route.path, async (context, next) => {
      requirePrivilegedJsonMutation(context);
      await next();
    });
  }

  const runHostFileMutation = async <T>(
    hostId: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await run();
    } finally {
      deps.workspaceReadCaches.invalidateHost(hostId);
    }
  };

  const runHostFileMutationCommand = <TCommand extends HostDaemonRpcCommand>(
    hostId: string,
    command: TCommand,
  ) =>
    runHostFileMutation(hostId, () =>
      callHostOnlineRpcForWork(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command,
      }),
    );

  const withHostFileRoute = async <T>(
    hostIdInput: string | undefined,
    run: (hostId: string) => Promise<T>,
  ): Promise<T> => {
    const hostId = resolveHostId(hostIdInput);
    try {
      return await run(hostId);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  };

  post(fileRoutes.read, async (context, payload) => {
    const target =
      "experimental_target" in payload
        ? await resolveFileResource(payload.experimental_target)
        : payload;
    return withHostFileRoute(target.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: target.path,
          ...(target.rootPath !== undefined
            ? { rootPath: target.rootPath }
            : {}),
        },
      });
      return context.json(requireDaemonFileContentResult(result));
    });
  });

  post(fileRoutes.write, async (context, payload) => {
    const target =
      "experimental_target" in payload
        ? await resolveFileResource(payload.experimental_target)
        : payload;
    return withHostFileRoute(target.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.write_file",
        path: target.path,
        content: payload.content,
        contentEncoding: payload.contentEncoding ?? "utf8",
        createParents: payload.createParents ?? false,
        ...(target.rootPath !== undefined ? { rootPath: target.rootPath } : {}),
        ...(payload.expectedSha256 !== undefined
          ? { expectedSha256: payload.expectedSha256 }
          : {}),
        ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
      });
      return context.json(result);
    });
  });

  post(fileRoutes.list, async (context, payload) => {
    const target =
      "experimental_target" in payload
        ? await resolveFileResource(payload.experimental_target)
        : { ...payload, rootPath: payload.path };
    return withHostFileRoute(target.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_files",
          path:
            "experimental_directory" in payload &&
            payload.experimental_directory === "root"
              ? target.rootPath
              : target.path,
          limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
          includeHidden:
            payload.includeHidden ?? WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [
            ...(payload.excludeNames ?? DEFAULT_PATH_LIST_EXCLUDE_NAMES),
          ],
          ...(payload.query !== undefined ? { query: payload.query } : {}),
        },
      });
      return context.json(result);
    });
  });

  post(fileRoutes.listPaths, async (context, payload) => {
    const target =
      "experimental_target" in payload
        ? await resolveFileResource(payload.experimental_target)
        : { ...payload, rootPath: payload.path };
    return withHostFileRoute(target.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_paths",
          path:
            "experimental_directory" in payload &&
            payload.experimental_directory === "root"
              ? target.rootPath
              : target.path,
          limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
          includeFiles: payload.includeFiles,
          includeDirectories: payload.includeDirectories,
          includeHidden:
            payload.includeHidden ?? WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [
            ...(payload.excludeNames ?? DEFAULT_PATH_LIST_EXCLUDE_NAMES),
          ],
          ...(payload.query !== undefined ? { query: payload.query } : {}),
        },
      });
      return context.json(result);
    });
  });

  post(fileRoutes.mkdir, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.mkdir",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.move, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.move_path",
        sourcePath: payload.sourcePath,
        destinationPath: payload.destinationPath,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.remove, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.remove_path",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.createPreview, (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    if (!isAbsoluteHostPath(payload.rootPath)) {
      throw new ApiError(
        400,
        "invalid_path",
        "rootPath must be absolute",
        false,
      );
    }
    return context.json(
      createPreviewLease({
        hostId,
        rootPath: payload.rootPath,
        ttlMs: payload.ttlMs,
      }),
    );
  });

  const resolveRelativeFileResource = (args: {
    hostId: string;
    path: string;
    rootPath: string;
    target: ResolveFileResourceResponse["target"];
  }): ResolvedFileResource => {
    return {
      hostId: args.hostId,
      path: joinHostPath(args.rootPath, args.path.split("/")),
      relativePath: args.path,
      rootPath: args.rootPath,
      target: args.target,
    };
  };

  const resolveFileResource = async (
    target: FileReference,
  ): Promise<ResolvedFileResource> => {
    if (target.kind === "workspace") {
      const environment = requireReadyEnvironment(
        deps.db,
        target.environmentId,
      );
      assertUsableHostId(deps, { hostId: environment.hostId });
      return resolveRelativeFileResource({
        hostId: environment.hostId,
        path: target.path,
        rootPath: environment.path,
        target: {
          kind: "workspace",
          environmentId: environment.id,
          path: target.path,
        },
      });
    }
    if (target.kind === "thread-storage") {
      const thread = requirePublicThread(deps.db, target.threadId);
      if (!thread.environmentId) {
        throw new ApiError(409, "invalid_request", "Thread has no environment");
      }
      const environment = requireEnvironment(deps.db, thread.environmentId);
      assertUsableHostId(deps, { hostId: environment.hostId });
      const storagePath = await requireThreadStoragePath(deps, {
        hostId: environment.hostId,
        threadId: thread.id,
      });
      return resolveRelativeFileResource({
        hostId: environment.hostId,
        path: target.path,
        rootPath: storagePath,
        target: {
          kind: "thread-storage",
          threadId: thread.id,
          path: target.path,
        },
      });
    }

    const hostId = target.hostId;
    assertUsableHostId(deps, { hostId });
    const hostPath = splitAbsoluteHostPath(target.path);
    return {
      hostId,
      ...hostPath,
      target: { kind: "host", hostId, path: hostPath.path },
    };
  };

  post(fileRoutes.resolveResource, async (context, payload) => {
    const resource = await resolveFileResource(payload.target);
    const lease = createPreviewLease({
      hostId: resource.hostId,
      rootPath: resource.rootPath,
    });
    return context.json({
      ...lease,
      absolutePath: resource.path,
      rootPath: resource.rootPath,
      path: resource.relativePath,
      target: resource.target,
      url: buildPreviewContentUrl(lease.baseUrl, resource.relativePath),
    });
  });

  get(previewRoutes.content, async (context) => {
    const id = context.req.param("id");
    const lease = previewLeases.get(id);
    if (!lease || lease.expiresAtMs <= Date.now()) {
      previewLeases.delete(id);
      throw new ApiError(404, "not_found", "File preview expired", false);
    }
    const rawPath = context.req.param("filePath").replace(/\\/g, "/");
    const segments = rawPath.split("/");
    if (
      rawPath.startsWith("/") ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      throw new ApiError(400, "invalid_path", "Invalid preview path", false);
    }
    const isHtmlPath = isHtmlMimeType(mimeTypes.lookup(rawPath) || null);
    return serveDaemonFileContent(
      deps,
      {
        hostId: lease.hostId,
        ...(!isHtmlPath
          ? { ifNoneMatch: context.req.header("if-none-match") }
          : {}),
        path: joinHostPath(lease.rootPath, segments),
        rootPath: lease.rootPath,
      },
      (result) => {
        const headers = new Headers({ "x-content-type-options": "nosniff" });
        const isHtml = isHtmlMimeType(result.mimeType);
        if (isHtml) {
          assertRawFilesystemHtmlPreviewResult(result);
          headers.set("cache-control", "no-store");
          headers.set("content-security-policy", HTML_PREVIEW_CSP);
          headers.set("content-type", HTML_PREVIEW_CONTENT_TYPE);
        }
        return createDaemonFileContentResponse(result, {
          headers,
          ifNoneMatch: isHtml ? undefined : context.req.header("if-none-match"),
        });
      },
    );
  });
}
