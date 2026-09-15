import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  definePluginApp,
  experimental_useFileResources,
  Markdown,
  type ExperimentalFileReference,
  type ExperimentalFileResource,
  type PluginMessageDirectiveProps,
  type MarkdownProps,
} from "@get-bb/plugin-sdk/app";

type PreviewSource = "workspace" | "thread-storage";

const PREVIEW_SOURCE_CONFIG = {
  workspace: { opensWorkspace: true },
  "thread-storage": { opensWorkspace: false },
} as const satisfies Record<PreviewSource, { opensWorkspace: boolean }>;

type PreviewKind = "html" | "markdown";

type LoadState =
  | { status: "missing-file" }
  | { status: "invalid-height"; message: string }
  | { status: "loading"; file: string }
  | {
      status: "ready";
      kind: "html";
      file: string;
      source: PreviewSource;
      resource: ExperimentalFileResource;
    }
  | {
      status: "ready";
      kind: "markdown";
      file: string;
      source: PreviewSource;
      content: string;
      document: NonNullable<MarkdownProps["experimental_document"]>;
    }
  | { status: "error"; file: string; message: string };

const DEFAULT_HEIGHT_PX = 224;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1_200;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

const PREVIEW_KIND_BY_EXTENSION: ReadonlyMap<string, PreviewKind> = new Map([
  ["html", "html"],
  ["htm", "html"],
  ["md", "markdown"],
  ["markdown", "markdown"],
]);

function requirePreviewFile(value: string): {
  file: string;
  kind: PreviewKind;
} {
  const file = value.trim();
  const segments = file.split("/");
  if (
    !file ||
    file.includes("\\") ||
    file.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`"file" must be a source-relative path: ${file}`);
  }
  const extension = file.split(".").at(-1)?.toLowerCase() ?? "";
  const kind = PREVIEW_KIND_BY_EXTENSION.get(extension);
  if (kind === undefined) {
    throw new Error(
      `"file" must end with .html, .htm, .md, or .markdown, got ${JSON.stringify(file)}`,
    );
  }
  return { file, kind };
}

function buildResourceTarget(
  environmentId: string | null,
  threadId: string,
  file: string,
  source: PreviewSource,
): ExperimentalFileReference {
  if (source === "workspace") {
    if (environmentId === null) {
      throw new Error("This message has no workspace environment");
    }
    return { kind: "workspace", environmentId, path: file };
  }
  return { kind: "thread-storage", threadId, path: file };
}

async function readPreviewText(
  resource: ExperimentalFileResource,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(resource.url, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Preview file not found: ${resource.path}`);
    }
    if (response.status === 413) {
      throw new Error(
        `Preview file is too large (max ${MAX_PREVIEW_BYTES} bytes).`,
      );
    }
    throw new Error(`Preview request failed with status ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error(
      `Preview file is too large (${bytes.byteLength} bytes; max ${MAX_PREVIEW_BYTES}).`,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Preview file is not valid UTF-8 text.");
  }
}

function parsePreviewHeight(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return DEFAULT_HEIGHT_PX;
  if (!/^\d+$/.test(normalized)) return null;
  const height = Number(normalized);
  return Number.isSafeInteger(height) &&
    height >= MIN_HEIGHT_PX &&
    height <= MAX_HEIGHT_PX
    ? height
    : null;
}

function PreviewCard({
  file,
  action,
  children,
}: {
  file: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-semibold">inline-vis</span>
          <span className="truncate opacity-70">{file}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function InlineVisDirective({
  attributes,
  source,
  message,
  openWorkspaceFile,
}: PluginMessageDirectiveProps) {
  const fileResources = experimental_useFileResources();
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const heightAttr = attributes.height;
  const previewHeight = parsePreviewHeight(heightAttr);
  const heightError =
    previewHeight === null
      ? `inline-vis height must be a whole number from ${MIN_HEIGHT_PX} to ${MAX_HEIGHT_PX} pixels.`
      : null;
  const [state, setState] = useState<LoadState>(() =>
    heightError
      ? { status: "invalid-height", message: heightError }
      : fileAttr
        ? { status: "loading", file: fileAttr }
        : { status: "missing-file" },
  );

  useEffect(() => {
    if (heightError) {
      setState({ status: "invalid-height", message: heightError });
      return;
    }
    if (!fileAttr) {
      setState({ status: "missing-file" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", file: fileAttr });

    void (async () => {
      try {
        const source = sourceAttr?.trim() ?? "workspace";
        if (source !== "workspace" && source !== "thread-storage") {
          throw new Error(
            `"source" must be workspace or thread-storage, got ${JSON.stringify(source)}`,
          );
        }
        const { file, kind } = requirePreviewFile(fileAttr);
        const resource = await fileResources.resolve(
          buildResourceTarget(
            message.experimental_environmentId ?? null,
            message.threadId,
            file,
            source,
          ),
          { signal: controller.signal },
        );
        const content = await readPreviewText(resource, controller.signal);
        if (controller.signal.aborted) return;
        setState(
          kind === "markdown"
            ? {
                status: "ready",
                kind,
                file,
                source,
                content,
                document: resource,
              }
            : { status: "ready", kind, file, source, resource },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          file: fileAttr,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [fileAttr, fileResources, heightError, message.threadId, sourceAttr]);

  if (state.status === "missing-file") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        title={source}
      >
        inline-vis requires a file attribute, e.g.{" "}
        <code>::inline-vis{'{file="demo.html"}'}</code>
      </div>
    );
  }

  if (state.status === "invalid-height") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        title={source}
      >
        {state.message}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <PreviewCard
        file={state.file}
        action={
          openWorkspaceFile === null ? null : (
            <span aria-hidden className="size-5 shrink-0" />
          )
        }
      >
        <div
          role="status"
          aria-busy="true"
          aria-label={`Loading visualization ${state.file}`}
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="w-full p-3"
        >
          <Skeleton className="size-full" />
        </div>
      </PreviewCard>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="my-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        title={source}
      >
        Failed to load {state.file}: {state.message}
      </div>
    );
  }

  const sourceConfig = PREVIEW_SOURCE_CONFIG[state.source];

  return (
    <PreviewCard
      file={state.file}
      action={
        !sourceConfig.opensWorkspace || openWorkspaceFile === null ? null : (
          <button
            type="button"
            aria-label={`Open ${state.file} in sidebar`}
            title="Open in sidebar"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              openWorkspaceFile(state.file);
            }}
          >
            <Icon name="ExternalLink" aria-hidden className="size-3" />
          </button>
        )
      }
    >
      {state.kind === "markdown" ? (
        <div
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="overflow-auto p-3"
        >
          <Markdown
            content={state.content}
            experimental_document={state.document}
          />
        </div>
      ) : (
        <iframe
          title={`inline-vis: ${state.file}`}
          src={state.resource.url}
          sandbox="allow-scripts"
          style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
          className="block w-full border-0 bg-background"
        />
      )}
    </PreviewCard>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "inline-vis",
    component: InlineVisDirective,
  });
});
