import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { fileReferenceSchema } from "@bb/server-contract/file-reference";
import {
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "@/lib/absolute-file-path";
import {
  buildFilePreviewLeaseContentUrl,
  buildThreadStorageRawContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import {
  buildMarkdownFileImageRouting,
  buildMarkdownContextRouting,
} from "./markdown-file-image-routing";
import type { MarkdownLinkRouting } from "./markdown-link-routing";

function resolveResourceLinkTarget(
  target: ExperimentalFileOpenOptions["target"],
  resourcePath: string,
  rootRelativePath: string,
): ExperimentalFileOpenOptions["target"] | null {
  if (target.kind !== "host") return { ...target, path: rootRelativePath };
  const slashPath = target.path.replace(/\\/g, "/");
  const suffix = `/${resourcePath}`;
  if (!slashPath.endsWith(suffix)) return null;
  const rootPath = slashPath.slice(0, -suffix.length) || "/";
  const joinedPath = `${rootPath === "/" ? "" : rootPath}/${rootRelativePath}`;
  return {
    ...target,
    path:
      target.path.includes("\\") && !target.path.startsWith("/")
        ? joinedPath.replace(/\//g, "\\")
        : joinedPath,
  };
}

interface DocumentContext {
  target: ExperimentalFileOpenOptions["target"];
  path: string;
  rootPath: string | null;
  threadId: string | null;
  resolveRelativeSrc: (path: string) => string;
}

function parseDocumentContext(resource: unknown): DocumentContext | null {
  if (
    typeof resource !== "object" ||
    resource === null ||
    !("target" in resource)
  )
    return null;
  const result = fileReferenceSchema.safeParse(resource.target);
  if (!result.success) return null;
  const target = result.data;
  if (
    "baseUrl" in resource &&
    typeof resource.baseUrl === "string" &&
    "path" in resource &&
    typeof resource.path === "string"
  ) {
    const baseUrl = resource.baseUrl;
    return {
      target,
      path: resource.path,
      rootPath:
        "rootPath" in resource && typeof resource.rootPath === "string"
          ? normalizeAbsoluteFilePath({ path: resource.rootPath })
          : null,
      threadId: null,
      resolveRelativeSrc: (path) =>
        buildFilePreviewLeaseContentUrl(baseUrl, path),
    };
  }
  if (
    target.kind === "host" ||
    !("rootPath" in resource) ||
    typeof resource.rootPath !== "string" ||
    !("threadId" in resource) ||
    typeof resource.threadId !== "string" ||
    !resource.threadId.trim() ||
    (target.kind === "thread-storage" && target.threadId !== resource.threadId)
  )
    return null;
  const rootPath = normalizeAbsoluteFilePath({ path: resource.rootPath });
  if (rootPath === null) return null;
  const threadId = resource.threadId;
  return {
    target,
    path: target.path,
    rootPath,
    threadId,
    resolveRelativeSrc: (path) =>
      target.kind === "workspace"
        ? buildThreadWorktreeRawContentUrl(threadId, path)
        : buildThreadStorageRawContentUrl(threadId, path),
  };
}

export function buildMarkdownDocumentLinkRouting({
  resource,
  messageRouting,
  openFilePreview,
}: {
  resource: unknown;
  messageRouting: MarkdownLinkRouting;
  openFilePreview: (intent: ExperimentalFileOpenOptions) => boolean;
}): MarkdownLinkRouting {
  const document = parseDocumentContext(resource);
  if (document === null) return {};
  const rootPath = document.rootPath ?? "/__bb_markdown_file_root__";
  const routing = buildMarkdownFileImageRouting({
    path: document.path,
    rootPath: document.rootPath,
    threadId: document.threadId,
    resolveRelativeSrc: document.resolveRelativeSrc,
  });
  if (routing?.localImage === undefined) return {};
  return buildMarkdownContextRouting({
    absolutePaths: routing.localImage.absolutePaths,
    relativePaths: routing.localImage.relativePaths,
    resolveSrc: routing.localImage.resolveSrc,
    onOpenLink: messageRouting.onOpenLink,
    onOpenLocalFileLink: (link) => {
      if (!isAbsoluteFilePathWithinRoot({ candidatePath: link.path, rootPath }))
        return messageRouting.localFile?.onOpenLink(link) ?? false;
      const target = resolveResourceLinkTarget(
        document.target,
        document.path,
        link.path.slice(rootPath === "/" ? 1 : rootPath.length + 1),
      );
      return (
        target !== null &&
        openFilePreview({
          target,
          location:
            link.lineRange === null
              ? null
              : {
                  kind: "range",
                  startLine: link.lineRange.startLineNumber,
                  endLine: link.lineRange.endLineNumber,
                },
        })
      );
    },
  });
}
