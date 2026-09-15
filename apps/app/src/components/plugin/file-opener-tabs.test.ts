import { describe, expect, it } from "vitest";
import { threadTabsSchema } from "@bb/server-contract";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";
import {
  buildFileOpenerPanelTab,
  createFileOpenerOriginalTab,
  createFileOpenerTabForRequest,
  legacyFileOpenerProps,
  parseFileOpenerParams,
  resolveFileOpenerParams,
} from "./file-opener-tabs";

const MARKDOWN_OPENER = {
  component: () => null,
  extensions: ["md"],
  generation: 1,
  id: "markdown",
  pluginId: "docs",
  title: "Docs editor",
} satisfies PluginFileOpenerSlot;

const REQUESTS: readonly {
  label: string;
  request: OpenSecondaryPanelTabRequest;
}[] = [
  {
    label: "workspace file",
    request: {
      kind: "workspace-file-preview",
      tab: {
        lineRange: { endLineNumber: 12, startLineNumber: 8 },
        path: "docs/readme.md",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    },
  },
  {
    label: "host file",
    request: {
      kind: "host-file-preview",
      tab: { lineRange: null, path: "/Users/dev/notes.md" },
    },
  },
  {
    label: "thread-storage file",
    request: {
      kind: "thread-storage-file-preview",
      tab: { lineRange: null, path: "plan.md" },
    },
  },
];

describe("createFileOpenerTabForRequest thread-tabs contract", () => {
  it.each(REQUESTS.map(({ label, request }) => [label, request] as const))(
    "produces a %s tab the thread-tabs contract accepts",
    (_label, request) => {
      const tab = createFileOpenerTabForRequest({
        environmentHostId: "host_docs",
        fileOpeners: [MARKDOWN_OPENER],
        preference: {},
        projectId: null,
        request,
        resolvedEnvironmentId: "env_docs",
        threadId: "thr_docs",
      });

      expect(tab?.fileOpenerOwner).toBeDefined();
      expect(() => threadTabsSchema.parse([tab])).not.toThrow();
    },
  );

  it("keeps the native preview when a workspace has no canonical location", () => {
    const tab = createFileOpenerTabForRequest({
      fileOpeners: [MARKDOWN_OPENER],
      preference: {},
      projectId: null,
      request: {
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "docs/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      },
      resolvedEnvironmentId: null,
      threadId: null,
    });

    expect(tab).toBeNull();
  });

  it("preserves the selected host for a project-backed opener", () => {
    const tab = createFileOpenerTabForRequest({
      fileOpeners: [MARKDOWN_OPENER],
      preference: {},
      projectHostId: "host_remote",
      projectRootPath: "/remote/project",
      projectId: "proj_1",
      request: {
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "docs/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      },
      resolvedEnvironmentId: null,
      threadId: null,
    });

    const params = parseFileOpenerParams(
      tab?.paramsJson ?? null,
      tab?.fileOpenerOwner,
    );
    expect(params?.experimental_file).toEqual({
      kind: "host",
      hostId: "host_remote",
      path: "/remote/project/docs/readme.md",
    });
    expect(() => threadTabsSchema.parse([tab])).not.toThrow();
  });
});

describe("createFileOpenerOriginalTab", () => {
  it("recognizes persisted legacy params while reconstructing from the owner", () => {
    const openerTab = {
      ...buildFileOpenerPanelTab(
        MARKDOWN_OPENER,
        {
          experimental_file: {
            kind: "workspace" as const,
            environmentId: "env_1",
            path: "docs/readme.md",
          },
        },
        {
          environmentId: "env_1",
          kind: "workspace-file-preview" as const,
          projectId: null,
          tab: {
            lineRange: null,
            path: "docs/readme.md",
            source: { kind: "working-tree" as const },
            statusLabel: null,
          },
          threadId: "thr_1",
        },
      ),
      paramsJson: JSON.stringify({
        path: "docs/readme.md",
        source: {
          kind: "workspace",
          environmentId: "env_1",
          projectId: null,
          threadId: "thr_1",
        },
      }),
    };

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: "env_1",
      kind: "workspace-file-preview",
      path: "docs/readme.md",
    });
  });

  it("uses the canonical reference to reconstruct the native workspace preview", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        experimental_file: {
          kind: "workspace",
          environmentId: "env_opened",
          path: "persisted/readme.md",
        },
      },
      {
        environmentId: "env_stale",
        kind: "workspace-file-preview",
        projectId: "proj_stale",
        tab: {
          lineRange: { endLineNumber: 12, startLineNumber: 8 },
          path: "stale/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
        threadId: "thr_stale",
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: "env_opened",
      kind: "workspace-file-preview",
      lineRange: { endLineNumber: 12, startLineNumber: 8 },
      path: "persisted/readme.md",
      projectId: null,
      source: { kind: "working-tree" },
    });
  });

  it("uses the canonical reference to reconstruct the native host preview", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        experimental_file: {
          kind: "host",
          hostId: "host_opened",
          path: "/persisted/notes.md",
        },
      },
      {
        environmentId: null,
        hostId: "host_stale",
        kind: "host-file-preview",
        tab: {
          lineRange: { endLineNumber: 4, startLineNumber: 4 },
          path: "/stale/notes.md",
        },
        threadId: null,
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: null,
      hostId: "host_opened",
      kind: "host-file-preview",
      lineRange: { endLineNumber: 4, startLineNumber: 4 },
      path: "/persisted/notes.md",
      threadId: null,
    });
  });

  it("uses the canonical reference to reconstruct the native thread-storage preview", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        experimental_file: {
          kind: "thread-storage",
          threadId: "thr_opened",
          path: "persisted/plan.md",
        },
      },
      {
        environmentId: "env_stale",
        kind: "thread-storage-file-preview",
        tab: { lineRange: null, path: "stale/plan.md" },
        threadId: "thr_stale",
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: null,
      isPinned: false,
      kind: "thread-storage-file-preview",
      path: "persisted/plan.md",
      threadId: "thr_opened",
    });
  });
});

describe("legacy file opener compatibility", () => {
  it("resolves legacy persisted params through each trusted owner location", () => {
    const legacyParams = (kind: "workspace" | "host" | "thread-storage") =>
      JSON.stringify({
        path: kind === "host" ? "/vault/file.md" : "docs/file.md",
        source: {
          kind,
          environmentId: kind === "thread-storage" ? null : "env_1",
          projectId: null,
          threadId: "thr_1",
        },
      });

    expect(
      resolveFileOpenerParams({
        owner: {
          environmentId: "env_1",
          kind: "workspace-file-preview",
          projectId: null,
          tab: {
            lineRange: null,
            path: "docs/file.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
          threadId: "thr_1",
        },
        paramsJson: legacyParams("workspace"),
      }),
    ).toEqual({
      experimental_file: {
        kind: "workspace",
        environmentId: "env_1",
        path: "docs/file.md",
      },
    });
    expect(
      resolveFileOpenerParams({
        environmentHostId: "host_1",
        owner: {
          environmentId: "env_1",
          hostId: null,
          kind: "host-file-preview",
          tab: { lineRange: null, path: "/vault/file.md" },
          threadId: "thr_1",
        },
        paramsJson: legacyParams("host"),
      }),
    ).toEqual({
      experimental_file: {
        kind: "host",
        hostId: "host_1",
        path: "/vault/file.md",
      },
    });
    expect(
      resolveFileOpenerParams({
        owner: {
          environmentId: null,
          kind: "thread-storage-file-preview",
          tab: { lineRange: null, path: "docs/file.md" },
          threadId: "thr_1",
        },
        paramsJson: legacyParams("thread-storage"),
      }),
    ).toEqual({
      experimental_file: {
        kind: "thread-storage",
        threadId: "thr_1",
        path: "docs/file.md",
      },
    });
  });

  it("resolves project-backed legacy workspace tabs to an absolute host file", () => {
    const owner = {
      environmentId: null,
      kind: "workspace-file-preview" as const,
      projectId: "proj_1",
      tab: {
        lineRange: null,
        path: "docs/file.md",
        source: { kind: "working-tree" as const },
        statusLabel: null,
      },
      threadId: null,
    };
    const resolved = resolveFileOpenerParams({
      owner,
      paramsJson: JSON.stringify({
        path: "docs/file.md",
        source: {
          kind: "workspace",
          environmentId: null,
          experimental_hostId: "host_1",
          projectId: "proj_1",
          threadId: null,
        },
      }),
      projectHostId: "host_1",
      projectRootPath: "/workspace/project",
    });

    expect(resolved).toEqual({
      experimental_file: {
        kind: "host",
        hostId: "host_1",
        path: "/workspace/project/docs/file.md",
      },
    });
    expect(legacyFileOpenerProps(owner, resolved!.experimental_file)).toEqual({
      path: "docs/file.md",
      source: {
        kind: "workspace",
        environmentId: null,
        experimental_hostId: "host_1",
        projectId: "proj_1",
        threadId: null,
      },
    });
  });

  it("rejects a legacy source kind that disagrees with its trusted owner", () => {
    expect(
      resolveFileOpenerParams({
        owner: {
          environmentId: "env_1",
          kind: "workspace-file-preview",
          projectId: null,
          tab: {
            lineRange: null,
            path: "docs/file.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
          threadId: "thr_1",
        },
        paramsJson: JSON.stringify({
          path: "docs/file.md",
          source: {
            kind: "host",
            environmentId: "env_1",
            projectId: null,
            threadId: "thr_1",
          },
        }),
      }),
    ).toBeNull();
  });
});

describe("canonical opener persistence", () => {
  it("normalizes old duplicated identity and keeps distinct file tabs", () => {
    const owner = {
      kind: "workspace-file-preview" as const,
      environmentId: "env_old",
      projectId: null,
      threadId: "thread_old",
      tab: {
        path: "stale.md",
        lineRange: null,
        source: { kind: "working-tree" as const },
        statusLabel: null,
      },
    };
    const file = {
      kind: "workspace" as const,
      environmentId: "env_actual",
      path: "actual.md",
    };
    const first = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      { experimental_file: file },
      owner,
    );
    const second = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      { experimental_file: { ...file, path: "second.md" } },
      owner,
    );
    expect(first.id).not.toBe(second.id);
    const parsed = threadTabsSchema.parse([
      {
        ...first,
        fileOpenerOwner: owner,
        paramsJson: JSON.stringify({ experimental_file: file }),
      },
    ]);
    expect(parsed[0]).toMatchObject({
      paramsJson: null,
      fileOpenerOwner: { kind: "file-preview", file, tab: { lineRange: null } },
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("stale.md");
    expect(serialized).not.toContain("env_old");
    expect(threadTabsSchema.parse(JSON.parse(serialized))).toEqual(parsed);
  });
});
