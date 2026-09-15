// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import { resetDeprecatedAliasWarningsForTests } from "./plugin-sdk-deprecated-aliases";
import { AppNavigationHostProvider } from "./app-navigation-host";

afterEach(cleanup);

describe("plugin SDK deprecated aliases", () => {
  beforeEach(() => {
    resetDeprecatedAliasWarningsForTests();
  });

  it("hands experimental_UrlLink a stable alias that warns on its first render, not on access", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const runtime = pluginSdkAppImplementation;
      const alias = Reflect.get(runtime, "experimental_UrlLink");
      expect(typeof alias).toBe("function");
      expect(Reflect.get(runtime, "experimental_UrlLink")).toBe(alias);
      expect(warn).not.toHaveBeenCalled();
      expect(Object.keys(runtime)).not.toContain("experimental_UrlLink");

      const LegacyUrlLink = alias as typeof runtime.UrlLink;
      const view = render(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl: () => true }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <LegacyUrlLink href="https://example.com/docs">
                Docs
              </LegacyUrlLink>
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      expect(screen.getByText("Docs").closest("a")?.getAttribute("href")).toBe(
        "https://example.com/docs",
      );
      view.rerender(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl: () => true }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <LegacyUrlLink href="https://example.com/docs">
                Docs again
              </LegacyUrlLink>
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "experimental_UrlLink is deprecated; use UrlLink. Removed in bb 0.42",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("forwards navigate.experimental_openUrl to openUrl and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const openUrl = vi.fn(() => true);
    const results: unknown[] = [];
    function Probe() {
      const navigate = pluginSdkAppImplementation.useBbNavigate();
      const legacyOpenUrl = Reflect.get(navigate, "experimental_openUrl");
      return (
        <button
          type="button"
          onClick={() => {
            if (typeof legacyOpenUrl !== "function") {
              results.push("missing");
              return;
            }
            results.push(legacyOpenUrl("https://example.com/a"));
            results.push(legacyOpenUrl("https://example.com/b"));
          }}
        >
          Open
        </button>
      );
    }
    try {
      render(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <Probe />
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(results).toEqual([true, true]);
      expect(openUrl).toHaveBeenNthCalledWith(1, {
        url: "https://example.com/a",
      });
      expect(openUrl).toHaveBeenNthCalledWith(2, {
        url: "https://example.com/b",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "experimental_openUrl is deprecated; use openUrl. Removed in bb 0.42",
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("plugin SDK Markdown", () => {
  it("uses the surrounding thread detail navigation for file and web links", () => {
    const onOpenLink = vi.fn(() => false);
    const openUrl = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;

    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          onOpenLink={onOpenLink}
          onOpenLocalFileLink={onOpenLocalFileLink}
          resolveMentionLink={() => null}
          threadId="thr_plugin"
          workspaceRootPath="/workspace"
        >
          <Markdown content="Open [README](README.md), ![chart](images/chart.png), or [the docs](https://example.com/docs)." />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );

    const fileLink = screen.getByRole("link", { name: "README" });
    expect(fileLink.getAttribute("href")).toBe("file:///workspace/README.md");
    fireEvent.click(fileLink);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/workspace/README.md",
    });
    expect(screen.getByRole("img", { name: "chart" }).getAttribute("src")).toBe(
      "/api/v1/threads/thr_plugin/host-files/content?path=%2Fworkspace%2Fimages%2Fchart.png",
    );

    fireEvent.click(screen.getByRole("link", { name: "the docs" }));
    expect(openUrl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    });
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("resolves Markdown document links and images through a file resource lease", () => {
    const openFilePreview = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    const resource = {
      absolutePath: "/workspace/reports/report.md",
      rootPath: "/workspace",
      baseUrl: "/api/v1/file-previews/lease_1",
      expiresAtMs: Date.now() + 60_000,
      path: "reports/nested/report.md",
      target: {
        kind: "workspace" as const,
        environmentId: "env_document",
        path: "reports/nested/report.md",
      },
      url: "/api/v1/file-previews/lease_1/reports/nested/report.md",
    };
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <Markdown
          content="[Sibling](sibling.md#L2) ![Chart](../chart%20one.svg)"
          experimental_document={resource}
        />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Sibling" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        ...resource.target,
        path: "reports/nested/sibling.md",
      },
      location: { kind: "range", startLine: 2, endLine: 2 },
    });
    expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe(
      "/api/v1/file-previews/lease_1/reports/chart%20one.svg",
    );
  });

  it("accepts the previous Markdown document context at runtime", () => {
    const openFilePreview = vi.fn(() => true);
    const LegacyMarkdown =
      pluginSdkAppImplementation.Markdown as ComponentType<{
        content: string;
        experimental_document: unknown;
      }>;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <LegacyMarkdown
          content="[Sibling](sibling.md#L2) ![Chart](../chart.svg)"
          experimental_document={{
            rootPath: "/workspace",
            target: {
              kind: "workspace",
              environmentId: "env_document",
              path: "reports/report.md",
            },
            threadId: "thr_document",
          }}
        />
      </AppNavigationHostProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Sibling" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "workspace",
        environmentId: "env_document",
        path: "reports/sibling.md",
      },
      location: { kind: "range", startLine: 2, endLine: 2 },
    });
    expect(screen.getByRole("img", { name: "Chart" }).getAttribute("src")).toBe(
      "/api/v1/threads/thr_document/worktree/files/chart.svg",
    );
  });

  it("opens links from a host file resource on the same host", () => {
    const openFilePreview = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <Markdown
          content="[Sibling](sibling.md)"
          experimental_document={{
            absolutePath: "/workspace/reports/report.md",
            rootPath: "/workspace",
            baseUrl: "/api/v1/file-previews/lease_1",
            expiresAtMs: Date.now() + 60_000,
            path: "reports/report.md",
            target: {
              kind: "host",
              hostId: "host_1",
              path: "C:\\vault\\reports\\report.md",
            },
            url: "/api/v1/file-previews/lease_1/reports/report.md",
          }}
        />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Sibling" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "host",
        hostId: "host_1",
        path: "C:\\vault\\reports\\sibling.md",
      },
      location: null,
    });
  });

  it("keeps escaping relative paths out of file navigation and preserves absolute links", () => {
    const openFilePreview = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          onOpenLink={() => false}
          onOpenLocalFileLink={() => {
            throw new Error("Used ambient workspace");
          }}
          resolveMentionLink={() => null}
          threadId="thr_document"
          workspaceRootPath="/workspace"
        >
          <Markdown
            content="[Escape](../../../outside.md) ![Escape](../../../outside.svg) [Absolute](/outside.md) ![Absolute](/outside.svg)"
            experimental_document={{
              absolutePath: "/workspace/reports/report.md",
              rootPath: "/workspace",
              baseUrl: "/api/v1/file-previews/lease_1",
              expiresAtMs: Date.now() + 60_000,
              path: "reports/report.md",
              target: {
                kind: "thread-storage",
                threadId: "thr_document",
                path: "reports/report.md",
              },
              url: "/api/v1/file-previews/lease_1/reports/report.md",
            }}
          />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Escape" }).getAttribute("href"),
    ).toBe("../../../outside.md");
    expect(
      screen.getByRole("img", { name: "Escape" }).getAttribute("src"),
    ).toBe("../../../outside.svg");
    expect(openFilePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Absolute" }));
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(
      screen.getByRole("img", { name: "Absolute" }).getAttribute("src"),
    ).toBe("/outside.svg");
  });

  it("routes web links without requiring a thread navigation context", () => {
    const openUrl = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <Markdown content="[Docs](https://example.com/docs)" />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" });
  });
});

describe("plugin SDK navigation components", () => {
  it("exposes the file link through the real runtime", () => {
    const openFilePreview = vi.fn(() => true);
    const FileLink = pluginSdkAppImplementation.experimental_FileLink;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <FileLink
          target={{
            kind: "thread-storage",
            threadId: "thr_1",
            path: "reports/result.md",
          }}
        >
          result.md
        </FileLink>
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "result.md" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "thread-storage",
        threadId: "thr_1",
        path: "reports/result.md",
      },
      location: null,
    });
  });
});
