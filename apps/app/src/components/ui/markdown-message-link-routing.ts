import { buildMarkdownContextRouting } from "./markdown-file-image-routing";
import type { MarkdownLinkRouting } from "./markdown-link-routing.js";
import type { MarkdownPreviewLinkHandler } from "./markdown-link.js";
import type { MarkdownPreviewLocalFileLinkHandler } from "./markdown-local-file-link.js";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";

interface BuildMarkdownMessageLinkRoutingArgs {
  onOpenLink?: MarkdownPreviewLinkHandler;
  onOpenLocalFileLink?: MarkdownPreviewLocalFileLinkHandler;
  threadId?: string;
  workspaceRootPath?: string;
}

export function buildMarkdownMessageLinkRouting({
  onOpenLink,
  onOpenLocalFileLink,
  threadId,
  workspaceRootPath,
}: BuildMarkdownMessageLinkRoutingArgs): MarkdownLinkRouting | undefined {
  if (
    onOpenLink === undefined &&
    onOpenLocalFileLink === undefined &&
    threadId === undefined
  ) {
    return undefined;
  }

  return buildMarkdownContextRouting({
    absolutePaths: { kind: "trusted-host" },
    relativePaths:
      workspaceRootPath === undefined
        ? undefined
        : { baseDir: workspaceRootPath, rootPath: workspaceRootPath },
    onOpenLink,
    onOpenLocalFileLink,
    resolveSrc:
      threadId === undefined
        ? undefined
        : ({ path }) => buildThreadHostFileContentUrl(threadId, path),
  });
}
