import type { ExperimentalFileReference } from "@get-bb/plugin-sdk";
import type { ThreadTabFileOpenerOwner } from "@bb/server-contract";
import { fileReferenceSchema } from "@bb/server-contract/file-reference";
import {
  createPluginPanelFixedPanelTab,
  type PluginPanelFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import type { FileOpenerPreferenceMap } from "@/lib/file-opener-preference";
import {
  resolveFileOpenerReplacement,
  type FileOpenerOverride,
} from "@/lib/plugin-slot-resolvers";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";

const FILE_OPENER_ACTION_ID_PREFIX = "file-opener:";

export interface PluginFileOpenerFile {
  experimental_file: ExperimentalFileReference;
}

interface LegacyPluginFileOpenerSource {
  kind: "workspace" | "host" | "thread-storage";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
  experimental_hostId?: string;
}

interface LegacyPluginFileOpenerFile {
  path: string;
  source: LegacyPluginFileOpenerSource;
}

export type FileOpenerOriginalTab = Extract<
  SecondaryFileFixedPanelTab,
  {
    kind:
      | "workspace-file-preview"
      | "host-file-preview"
      | "thread-storage-file-preview";
  }
>;

export function fileOpenerIdFromActionId(actionId: string): string | null {
  return actionId.startsWith(FILE_OPENER_ACTION_ID_PREFIX)
    ? actionId.slice(FILE_OPENER_ACTION_ID_PREFIX.length)
    : null;
}

export function buildFileOpenerPanelTab(
  opener: Pick<PluginFileOpenerSlot, "id" | "pluginId">,
  file: PluginFileOpenerFile,
  owner: ThreadTabFileOpenerOwner,
): PluginPanelFixedPanelTab {
  return {
    ...createPluginPanelFixedPanelTab({
      actionId: `${FILE_OPENER_ACTION_ID_PREFIX}${opener.id}`,
      paramsJson: JSON.stringify(file),
      pluginId: opener.pluginId,
      title:
        file.experimental_file.path.split(/[\\/]/u).at(-1) ??
        file.experimental_file.path,
    }),
    paramsJson: null,
    fileOpenerOwner: {
      kind: "file-preview",
      file: file.experimental_file,
      tab: { lineRange: owner.tab.lineRange },
    },
  };
}

export function parseFileOpenerParams(
  paramsJson: string | null,
  owner?: ThreadTabFileOpenerOwner,
): PluginFileOpenerFile | null {
  if (owner?.kind === "file-preview") return { experimental_file: owner.file };
  if (paramsJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const file = parsed as { experimental_file?: unknown };
  const result = fileReferenceSchema.safeParse(file.experimental_file);
  return result.success ? { experimental_file: result.data } : null;
}

function parseLegacyFileOpenerParams(
  paramsJson: string | null,
): LegacyPluginFileOpenerFile | null {
  if (paramsJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { path, source } = parsed as { path?: unknown; source?: unknown };
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof source !== "object" || source === null) return null;
  const { kind, threadId, environmentId, projectId, experimental_hostId } =
    source as {
      kind?: unknown;
      threadId?: unknown;
      environmentId?: unknown;
      projectId?: unknown;
      experimental_hostId?: unknown;
    };
  if (kind !== "workspace" && kind !== "host" && kind !== "thread-storage") {
    return null;
  }
  return {
    path,
    source: {
      kind,
      threadId: typeof threadId === "string" ? threadId : null,
      environmentId: typeof environmentId === "string" ? environmentId : null,
      projectId: typeof projectId === "string" ? projectId : null,
      ...(typeof experimental_hostId === "string"
        ? { experimental_hostId }
        : {}),
    },
  };
}

function hasFileOpenerParams(paramsJson: string | null): boolean {
  return (
    parseFileOpenerParams(paramsJson) !== null ||
    parseLegacyFileOpenerParams(paramsJson) !== null
  );
}

export function getLegacyProjectFileOpenerHostId(
  paramsJson: string | null,
  owner: ThreadTabFileOpenerOwner,
): string | null | undefined {
  if (
    owner.kind !== "workspace-file-preview" ||
    owner.environmentId !== null ||
    owner.projectId === null
  ) {
    return undefined;
  }
  const legacy = parseLegacyFileOpenerParams(paramsJson);
  if (legacy?.source.kind !== "workspace") return undefined;
  return legacy.source.experimental_hostId ?? null;
}

export function resolveFileOpenerParams({
  environmentHostId,
  owner,
  paramsJson,
  projectHostId,
  projectRootPath,
}: {
  environmentHostId?: string | null;
  owner: ThreadTabFileOpenerOwner;
  paramsJson: string | null;
  projectHostId?: string | null;
  projectRootPath?: string | null;
}): PluginFileOpenerFile | null {
  const current = parseFileOpenerParams(paramsJson, owner);
  if (current !== null) return current;
  const legacy = parseLegacyFileOpenerParams(paramsJson);
  if (legacy === null) return null;
  if (
    (owner.kind === "workspace-file-preview" &&
      legacy.source.kind !== "workspace") ||
    (owner.kind === "host-file-preview" && legacy.source.kind !== "host") ||
    (owner.kind === "thread-storage-file-preview" &&
      legacy.source.kind !== "thread-storage")
  ) {
    return null;
  }
  return fileForOwnerRequest({
    environmentHostId,
    owner,
    projectHostId,
    projectRootPath,
  });
}

export function legacyFileOpenerProps(
  owner: ThreadTabFileOpenerOwner,
  file: ExperimentalFileReference,
  contextThreadId: string | null = null,
): LegacyPluginFileOpenerFile {
  switch (owner.kind) {
    case "file-preview":
      return {
        path: file.path,
        source: {
          kind: file.kind,
          environmentId: file.kind === "workspace" ? file.environmentId : null,
          projectId: null,
          threadId:
            file.kind === "thread-storage" ? file.threadId : contextThreadId,
          ...(file.kind === "host" ? { experimental_hostId: file.hostId } : {}),
        },
      };

    case "workspace-file-preview":
      return {
        path: owner.tab.path,
        source: {
          kind: "workspace",
          environmentId: owner.environmentId,
          projectId: owner.projectId,
          threadId: owner.threadId,
          ...(file.kind === "host" ? { experimental_hostId: file.hostId } : {}),
        },
      };
    case "host-file-preview":
      return {
        path: owner.tab.path,
        source: {
          kind: "host",
          environmentId: owner.environmentId,
          projectId: null,
          threadId: owner.threadId,
          ...(owner.hostId === null
            ? {}
            : { experimental_hostId: owner.hostId }),
        },
      };
    case "thread-storage-file-preview":
      return {
        path: owner.tab.path,
        source: {
          kind: "thread-storage",
          environmentId: owner.environmentId,
          projectId: null,
          threadId: owner.threadId,
        },
      };
  }
}

export function createFileOpenerOriginalTab(
  tab: PluginPanelFixedPanelTab,
): FileOpenerOriginalTab | null {
  const owner = tab.fileOpenerOwner;
  if (owner === undefined) return null;
  if (owner.kind === "file-preview") {
    const file = owner.file;
    const common = {
      id: `${tab.id}:file-opener-original`,
      path: file.path,
      lineRange: owner.tab.lineRange,
    };
    switch (file.kind) {
      case "workspace":
        return {
          ...common,
          kind: "workspace-file-preview",
          environmentId: file.environmentId,
          projectId: null,
          source: { kind: "working-tree" },
          statusLabel: null,
        };
      case "host":
        return {
          ...common,
          kind: "host-file-preview",
          environmentId: null,
          threadId: null,
          hostId: file.hostId,
        };
      case "thread-storage":
        return {
          ...common,
          kind: "thread-storage-file-preview",
          environmentId: null,
          threadId: file.threadId,
          isPinned: false,
        };
    }
  }
  if (!hasFileOpenerParams(tab.paramsJson)) return null;

  const id = `${tab.id}:file-opener-original`;
  if (owner.kind === "workspace-file-preview") {
    return {
      ...owner.tab,
      environmentId: owner.environmentId,
      id,
      kind: "workspace-file-preview",
      path: owner.tab.path,
      projectId: owner.projectId,
    };
  }
  if (owner.kind === "host-file-preview") {
    return {
      ...owner.tab,
      environmentId: owner.environmentId,
      hostId: owner.hostId,
      id,
      kind: "host-file-preview",
      path: owner.tab.path,
      threadId: owner.threadId,
    };
  }
  if (owner.kind === "thread-storage-file-preview") {
    return {
      ...owner.tab,
      environmentId: owner.environmentId,
      id,
      isPinned: false,
      kind: "thread-storage-file-preview",
      path: owner.tab.path,
      threadId: owner.threadId,
    };
  }
  return null;
}

interface CreateFileOpenerTabForRequestArgs {
  environmentHostId?: string | null;
  fileOpeners: readonly PluginFileOpenerSlot[];
  preference: FileOpenerPreferenceMap;
  projectHostId?: string | null;
  projectRootPath?: string | null;
  projectId: string | null;
  request: OpenSecondaryPanelTabRequest;
  resolvedEnvironmentId: string | null | undefined;
  threadId: string | null | undefined;
  viewer?: FileOpenerOverride;
}

export function createFileOpenerTabForRequest({
  fileOpeners,
  environmentHostId,
  preference,
  projectHostId,
  projectRootPath,
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
  viewer,
}: CreateFileOpenerTabForRequestArgs): PluginPanelFixedPanelTab | null {
  const owner = ownerRequestForOpenRequest({
    projectId,
    request,
    resolvedEnvironmentId,
    threadId,
  });
  if (owner === null) return null;
  const file = fileForOwnerRequest({
    environmentHostId,
    owner,
    projectHostId,
    projectRootPath,
  });
  if (file === null) return null;
  const resolved = resolveFileOpenerReplacement({
    registrations: fileOpeners,
    preference,
    path: file.experimental_file.path,
    ...(viewer !== undefined ? { override: viewer } : {}),
  });
  return resolved.kind === "plugin"
    ? buildFileOpenerPanelTab(resolved.registration, file, owner)
    : null;
}

function ownerRequestForOpenRequest({
  projectId,
  request,
  resolvedEnvironmentId,
  threadId,
}: Omit<
  CreateFileOpenerTabForRequestArgs,
  "fileOpeners" | "preference"
>): ThreadTabFileOpenerOwner | null {
  switch (request.kind) {
    case "workspace-file-preview": {
      if (
        request.environmentId === undefined &&
        resolvedEnvironmentId === undefined
      ) {
        return null;
      }
      if (request.tab.source.kind !== "working-tree") return null;
      if (request.tab.statusLabel === "deleted") return null;
      const environmentId =
        request.environmentId ?? resolvedEnvironmentId ?? null;
      return {
        kind: request.kind,
        environmentId,
        projectId: environmentId === null ? projectId : null,
        tab: request.tab,
        threadId: threadId ?? null,
      };
    }
    case "host-file-preview": {
      if (request.hostId !== undefined) {
        return {
          kind: request.kind,
          environmentId: null,
          hostId: request.hostId,
          tab: request.tab,
          threadId: null,
        };
      }
      if (!threadId || !resolvedEnvironmentId) return null;
      return {
        kind: request.kind,
        environmentId: resolvedEnvironmentId,
        hostId: null,
        tab: request.tab,
        threadId,
      };
    }
    case "thread-storage-file-preview": {
      const storageThreadId = request.threadId ?? threadId;
      if (!storageThreadId) return null;
      return {
        kind: request.kind,
        environmentId: resolvedEnvironmentId ?? null,
        tab: request.tab,
        threadId: storageThreadId,
      };
    }
    default:
      return null;
  }
}

function joinHostFilePath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/u, "")}${separator}${relativePath.replace(/^[\\/]+/u, "")}`;
}

function fileForOwnerRequest(args: {
  environmentHostId?: string | null;
  owner: ThreadTabFileOpenerOwner;
  projectHostId?: string | null;
  projectRootPath?: string | null;
}): PluginFileOpenerFile | null {
  const { environmentHostId, owner, projectHostId, projectRootPath } = args;
  switch (owner.kind) {
    case "file-preview":
      return { experimental_file: owner.file };
    case "workspace-file-preview":
      if (owner.environmentId !== null) {
        return {
          experimental_file: {
            kind: "workspace",
            environmentId: owner.environmentId,
            path: owner.tab.path,
          },
        };
      }
      if (!projectHostId || !projectRootPath) return null;
      return {
        experimental_file: {
          kind: "host",
          hostId: projectHostId,
          path: joinHostFilePath(projectRootPath, owner.tab.path),
        },
      };
    case "host-file-preview":
      const hostId = owner.hostId ?? environmentHostId;
      if (!hostId) return null;
      return {
        experimental_file: {
          kind: "host",
          hostId,
          path: owner.tab.path,
        },
      };
    case "thread-storage-file-preview":
      return {
        experimental_file: {
          kind: "thread-storage",
          threadId: owner.threadId,
          path: owner.tab.path,
        },
      };
  }
}
