import type { FileReference } from "@bb/server-contract";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { buildMarkdownDocumentLinkRouting } from "@/components/ui/markdown-document-link-routing";
import { buildAbsoluteFilePath } from "@/lib/absolute-file-path";
import { type ReactNode, useEffect, useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { DiffPresentation } from "@/components/code/code-rendering";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing.js";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  useEnvironmentDiffFiles,
  useEnvironment,
  useEnvironmentFilePreview,
} from "@/hooks/queries/environment-queries";
import { useLiveFilePreview } from "@/hooks/queries/host-file-preview-query";
import {
  buildProjectFileContentUrl,
  buildThreadWorktreeRawContentUrl,
} from "@/lib/file-content-urls";
import type {
  EnvironmentFilePreviewSource,
  FilePreview,
  FilePreviewLineRange,
  WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANEL_SCROLL_SLOT_CLASS } from "./panelChromeClasses";
import { DiffFilesPanel } from "./git-diff/DiffFilesPanel";
import { clearDiffFileCardStates } from "./git-diff/diffFilesStore";
import { buildGitDiffIdentity } from "./git-diff/gitDiffPanelHelpers";
import { useDiffFileContentsRequester } from "./git-diff/useDiffFileContentsRequester";
import { SecondaryPanelFilePreview } from "./ThreadStorageFilePreview";
import { buildMarkdownFileImageRouting } from "@/components/ui/markdown-file-image-routing";

const GIT_DIFF_SKELETON_FILE_COUNT = 3;

interface GitDiffTabContentProps {
  environmentId?: string;
  target: WorkspaceDiffTarget | undefined;
  isPanelOpen: boolean;
  gitDiffPresentation: DiffPresentation;
  onClearPendingGitDiffIntent?: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  pendingGitDiffScrollPath?: string | null;
  workspaceRootPath?: string | null;
}

interface WorkspaceFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  source: EnvironmentFilePreviewSource | null;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  threadId?: string | null;
}

interface ProjectFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  environmentId: string | null;
  hostId: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  projectId: string;
  rootPath?: string | null;
  threadId?: string | null;
}

interface HostFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath: string;
  environmentId?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

interface HostScopedFilePreviewTabContentProps {
  activePath: string;
  hostId: string;
  isPanelOpen: boolean;
  lineRange: FilePreviewLineRange | null;
  onOpenInEditor?: (path: string) => void;
}

interface ThreadStorageFilePreviewTabContentProps {
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
  threadId: string;
}

function filePreviewQueryProps(query: UseQueryResult<FilePreview>) {
  return {
    error: query.error,
    filePreview: query.data,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    onRefresh: () => void query.refetch(),
  };
}

function GitDiffMessageSlot({ children }: { children: ReactNode }) {
  return (
    <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>{children}</div>
  );
}

function ThreadDiffSkeleton() {
  return (
    <div className="space-y-2 pt-2">
      {Array.from({ length: GIT_DIFF_SKELETON_FILE_COUNT }).map((_, index) => (
        <div
          key={`git-diff-skeleton-${index}`}
          className="rounded-lg border border-border bg-surface-raised"
        >
          <div className="border-b border-border bg-surface-recessed px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className="h-3 w-48 max-w-full rounded-sm" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0 rounded-sm" />
            </div>
          </div>
          <div className="space-y-1.5 px-2.5 py-2">
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-[94%] rounded-sm" />
            <Skeleton className="h-3 w-[90%] rounded-sm" />
            <Skeleton className="h-3 w-[86%] rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GitDiffTabContent({
  environmentId,
  target,
  isPanelOpen,
  gitDiffPresentation,
  onClearPendingGitDiffIntent,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  pendingGitDiffScrollPath,
  workspaceRootPath,
}: GitDiffTabContentProps) {
  const isQueryEnabled =
    isPanelOpen && Boolean(environmentId) && target !== undefined;
  const {
    data: diffFilesResponse,
    dataUpdatedAt: diffFilesUpdatedAt,
    isLoading: isDiffFilesLoading,
    isPlaceholderData: isDiffFilesPlaceholder,
    error: diffFilesError,
  } = useEnvironmentDiffFiles(environmentId ?? "", {
    enabled: isQueryEnabled,
    target,
  });

  const mergeBaseRef =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.mergeBaseRef
      : null;
  const diffIdentity = buildGitDiffIdentity({
    environmentId,
    mergeBaseRef,
    target,
  });
  const onRequestFileContents = useDiffFileContentsRequester({
    environmentId,
    target,
    mergeBaseRef,
  });

  useEffect(() => {
    clearDiffFileCardStates(diffIdentity);
  }, [diffIdentity]);

  const isPreparing =
    isQueryEnabled &&
    (isDiffFilesLoading ||
      (diffFilesResponse === undefined && diffFilesError === null));

  if (isPreparing) {
    return (
      <GitDiffMessageSlot>
        <ThreadDiffSkeleton />
      </GitDiffMessageSlot>
    );
  }

  if (diffFilesError) {
    return (
      <GitDiffMessageSlot>
        <div className="rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive">
          <p>
            {diffFilesError instanceof Error
              ? diffFilesError.message
              : "Failed to load git diff"}
          </p>
        </div>
      </GitDiffMessageSlot>
    );
  }

  if (diffFilesResponse === undefined) {
    return (
      <GitDiffMessageSlot>
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      </GitDiffMessageSlot>
    );
  }

  if (diffFilesResponse.outcome === "unavailable") {
    return (
      <GitDiffMessageSlot>
        <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Workspace unavailable</p>
          <p className="mt-1 leading-5">{diffFilesResponse.failure.message}</p>
        </div>
      </GitDiffMessageSlot>
    );
  }

  if (diffFilesResponse.outcome === "not_applicable") {
    return (
      <GitDiffMessageSlot>
        <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
          <p className="mt-1 leading-5">{diffFilesResponse.message}</p>
        </div>
      </GitDiffMessageSlot>
    );
  }

  if (
    diffFilesResponse.files.length === 0 ||
    !environmentId ||
    target === undefined
  ) {
    return (
      <GitDiffMessageSlot>
        <EmptyStatePanel className="rounded-lg">
          No diff to display.
        </EmptyStatePanel>
      </GitDiffMessageSlot>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {diffFilesResponse.truncated ? (
        <div
          role="status"
          className="mx-4 mb-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
        >
          Showing the first {diffFilesResponse.files.length} changed files.
          Additional changes are omitted.
        </div>
      ) : null}
      <DiffFilesPanel
        environmentId={environmentId}
        target={target}
        diffIdentity={diffIdentity}
        files={diffFilesResponse.files}
        initialPatches={diffFilesResponse.initialPatches}
        filesUpdatedAt={diffFilesUpdatedAt}
        presentation={gitDiffPresentation}
        filePathRoot={workspaceRootPath}
        isPanelOpen={isPanelOpen}
        isPlaceholderData={isDiffFilesPlaceholder}
        scrollToPath={pendingGitDiffScrollPath}
        onScrolledToPath={onClearPendingGitDiffIntent}
        onOpenFileInEditor={onOpenFileInEditor}
        onOpenFilePreview={onOpenFilePreview}
        onRequestFileContents={onRequestFileContents}
        onSelectionAddToChat={onSelectionAddToChat}
      />
    </div>
  );
}

function SnapshotFilePreviewTabContent({
  activePath,
  copyPath = null,
  environmentId,
  isPanelOpen,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
  source,
  statusLabel,
  threadId,
}: WorkspaceFilePreviewTabContentProps) {
  const environmentQuery = useEnvironment(environmentId ?? null, {
    enabled:
      environmentId !== null &&
      environmentId !== undefined &&
      markdownLinkRouting?.localImage === undefined,
    staleTime: 5_000,
  });
  const workspaceFilePreviewQuery = useEnvironmentFilePreview(
    environmentId,
    activePath,
    source,
    { enabled: isPanelOpen },
  );
  const environmentRootPath = environmentQuery.data?.path ?? null;
  const environmentProjectId = environmentQuery.data?.projectId;
  const resolvedMarkdownLinkRouting = useMemo(() => {
    if (
      source === null ||
      environmentId === null ||
      environmentId === undefined ||
      (!threadId && environmentProjectId === undefined)
    ) {
      return markdownLinkRouting;
    }
    return buildMarkdownFileImageRouting({
      path: activePath,
      rootPath: environmentRootPath,
      threadId: threadId ?? null,
      linkRouting: markdownLinkRouting,
      resolveRelativeSrc: (path) => {
        if (threadId && source.kind === "working-tree") {
          return buildThreadWorktreeRawContentUrl(threadId, path);
        }
        return environmentProjectId === undefined
          ? path
          : buildProjectFileContentUrl(environmentProjectId, path, {
              environmentId,
            });
      },
    });
  }, [
    activePath,
    environmentId,
    environmentProjectId,
    environmentRootPath,
    markdownLinkRouting,
    source,
    threadId,
  ]);

  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(workspaceFilePreviewQuery)}
      activePath={activePath}
      copyPath={copyPath}
      htmlPreviewUrl={
        threadId && source?.kind === "working-tree"
          ? buildThreadWorktreeRawContentUrl(threadId, activePath)
          : null
      }
      lineRange={lineRange}
      markdownLinkRouting={resolvedMarkdownLinkRouting}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={statusLabel}
    />
  );
}

interface LiveFilePreviewTabContentProps {
  target: FileReference | null;
  activePath: string;
  isPanelOpen: boolean;
  copyPath?: string | null;
  lineRange: FilePreviewLineRange | null;
  markdownLinkRouting?: MarkdownLinkRouting;
  onSelectionAddToChat?: (text: string) => void;
  onOpenInEditor?: (path: string) => void;
}

export function LiveFilePreviewTabContent({
  target,
  activePath,
  isPanelOpen,
  copyPath,
  lineRange,
  markdownLinkRouting,
  onSelectionAddToChat,
  onOpenInEditor,
}: LiveFilePreviewTabContentProps) {
  const query = useLiveFilePreview(target, { enabled: isPanelOpen });
  const navigation = useAppNavigationHost();
  const resource = query.data?.resource;
  const routing = useMemo(
    () =>
      resource === undefined || resource === null
        ? markdownLinkRouting
        : buildMarkdownDocumentLinkRouting({
            resource,
            messageRouting: markdownLinkRouting ?? {},
            openFilePreview: navigation.openFilePreview,
          }),
    [resource, markdownLinkRouting, navigation.openFilePreview],
  );
  return (
    <SecondaryPanelFilePreview
      {...filePreviewQueryProps(query)}
      activePath={target?.path ?? activePath}
      copyPath={copyPath ?? resource?.absolutePath ?? null}
      htmlPreviewUrl={resource?.url ?? null}
      lineRange={lineRange}
      markdownLinkRouting={routing}
      onSelectionAddToChat={onSelectionAddToChat}
      onOpenInEditor={onOpenInEditor}
      statusLabel={null}
    />
  );
}

export function WorkspaceFilePreviewTabContent(
  props: WorkspaceFilePreviewTabContentProps,
) {
  if (
    props.source?.kind !== "working-tree" ||
    props.statusLabel === "deleted"
  ) {
    return <SnapshotFilePreviewTabContent {...props} />;
  }
  return (
    <LiveFilePreviewTabContent
      {...props}
      target={
        props.environmentId
          ? {
              kind: "workspace",
              environmentId: props.environmentId,
              path: props.activePath,
            }
          : null
      }
    />
  );
}

export function ProjectFilePreviewTabContent(
  props: ProjectFilePreviewTabContentProps,
) {
  const target: FileReference | null =
    props.environmentId !== null
      ? {
          kind: "workspace",
          environmentId: props.environmentId,
          path: props.activePath,
        }
      : props.hostId !== null && props.rootPath != null
        ? {
            kind: "host",
            hostId: props.hostId,
            path: buildAbsoluteFilePath({
              path: props.activePath,
              rootPath: props.rootPath,
            }),
          }
        : null;
  return <LiveFilePreviewTabContent {...props} target={target} />;
}

export function HostFilePreviewTabContent(
  props: HostFilePreviewTabContentProps,
) {
  const environment = useEnvironment(props.environmentId ?? null, {
    enabled: props.isPanelOpen,
  });
  const hostId = environment.data?.hostId;
  return (
    <LiveFilePreviewTabContent
      {...props}
      target={hostId ? { kind: "host", hostId, path: props.activePath } : null}
    />
  );
}

export function HostScopedFilePreviewTabContent(
  props: HostScopedFilePreviewTabContentProps,
) {
  return (
    <LiveFilePreviewTabContent
      {...props}
      target={{ kind: "host", hostId: props.hostId, path: props.activePath }}
    />
  );
}

export function ThreadStorageFilePreviewTabContent(
  props: ThreadStorageFilePreviewTabContentProps,
) {
  return (
    <LiveFilePreviewTabContent
      {...props}
      target={{
        kind: "thread-storage",
        threadId: props.threadId,
        path: props.activePath,
      }}
    />
  );
}
