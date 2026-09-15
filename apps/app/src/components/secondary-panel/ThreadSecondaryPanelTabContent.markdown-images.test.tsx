// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileReference } from "@bb/server-contract";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import {
  HostFilePreviewTabContent,
  HostScopedFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";

const seenTarget = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: () => ({
    data: { path: "/workspace", hostId: "host_preview" },
  }),
  useEnvironmentDiffFiles: vi.fn(),
  useEnvironmentFilePreview: vi.fn(),
}));

vi.mock("@/hooks/queries/host-file-preview-query", () => ({
  useLiveFilePreview: (target: FileReference) => {
    seenTarget(target);
    const path = target.kind === "host" ? "readme.md" : target.path;
    return {
      data: {
        kind: "text",
        content:
          "![relative](images/chart.png) ![escape](../../outside.png) [Sibling](next.md#L2)",
        mimeType: "text/markdown",
        name: "readme.md",
        path: target.path,
        url: `/api/v1/file-previews/lease/${path}`,
        resource: {
          target,
          path,
          rootPath: "/workspace",
          absolutePath: "/workspace/docs/readme.md",
          baseUrl: "/api/v1/file-previews/lease",
          url: `/api/v1/file-previews/lease/${path}`,
          expiresAtMs: Date.now() + 60_000,
        },
      },
      error: null,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const common = { isPanelOpen: true, lineRange: null };
const host: FileReference = {
  kind: "host",
  hostId: "host_preview",
  path: "/workspace/docs/readme.md",
};
const cases = [
  {
    name: "workspace",
    target: {
      kind: "workspace",
      environmentId: "env_preview",
      path: "docs/readme.md",
    },
    node: (
      <WorkspaceFilePreviewTabContent
        {...common}
        activePath="docs/readme.md"
        environmentId="env_preview"
        source={{ kind: "working-tree" }}
        statusLabel={null}
      />
    ),
  },
  {
    name: "project",
    target: host,
    node: (
      <ProjectFilePreviewTabContent
        {...common}
        activePath="docs/readme.md"
        environmentId={null}
        hostId="host_preview"
        projectId="project"
        rootPath="/workspace"
      />
    ),
  },
  {
    name: "thread host",
    target: host,
    node: (
      <HostFilePreviewTabContent
        {...common}
        activePath={host.path}
        copyPath={host.path}
        environmentId="env_preview"
        threadId="thread"
      />
    ),
  },
  {
    name: "host",
    target: host,
    node: (
      <HostScopedFilePreviewTabContent
        {...common}
        activePath={host.path}
        hostId="host_preview"
      />
    ),
  },
  {
    name: "thread storage",
    target: {
      kind: "thread-storage",
      threadId: "thread",
      path: "docs/readme.md",
    },
    node: (
      <ThreadStorageFilePreviewTabContent
        {...common}
        activePath="docs/readme.md"
        threadId="thread"
      />
    ),
  },
];

describe("canonical native Markdown routing", () => {
  it.each(cases)(
    "routes $name images and links through the shared resource",
    ({ target, node }) => {
      const openFilePreview = vi.fn(() => true);
      render(
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          {node}
        </AppNavigationHostProvider>,
      );
      expect(seenTarget).toHaveBeenCalledWith(target);
      expect(
        screen.getByRole("img", { name: "relative" }).getAttribute("src"),
      ).toBe(
        `/api/v1/file-previews/lease/${target.kind === "host" ? "" : "docs/"}images/chart.png`,
      );
      expect(
        screen.getByRole("img", { name: "escape" }).getAttribute("src"),
      ).toBe("../../outside.png");
      fireEvent.click(screen.getByRole("link", { name: "Sibling" }));
      expect(openFilePreview).toHaveBeenCalledWith({
        target: {
          ...target,
          path: target.path.replace("readme.md", "next.md"),
        },
        location: { kind: "range", startLine: 2, endLine: 2 },
      });
    },
  );
});
