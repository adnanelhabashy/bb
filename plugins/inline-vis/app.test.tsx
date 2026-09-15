// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalFileResource,
  ExperimentalFileReference,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
  experimental_environmentId: "env_1",
};

function resourceFor(
  target: ExperimentalFileReference,
): ExperimentalFileResource {
  return {
    absolutePath: `/workspace/${target.path}`,
    rootPath: "/workspace",
    baseUrl: "/api/v1/file-previews/lease_1",
    expiresAtMs: Date.now() + 60_000,
    path: target.path,
    target,
    url: `/api/v1/file-previews/lease_1/${target.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  };
}

function renderDirective(
  attributes: Record<string, string>,
  options: RenderSlotOptions = {},
  openWorkspaceFile: ((file: string) => boolean) | null = null,
) {
  return renderSlot(
    app.messageDirectives[0]!,
    {
      attributes,
      source: "::inline-vis{}",
      message,
      openWorkspaceFile,
    },
    {
      experimental_resolveFileResource: resourceFor,
      ...options,
    },
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<html><body>ok</body></html>", {
        headers: { "content-type": "text/html" },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("inline-vis messageDirective registration", () => {
  it("registers the inline-vis directive", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("inline-vis");
  });
});

describe("InlineVisDirective", () => {
  it("requires a file attribute without resolving a resource", async () => {
    const slot = renderDirective({});
    expect((await slot.findByRole("alert")).textContent).toMatch(
      /requires a file attribute/i,
    );
    expect(slot.experimental_fileResourceCalls).toEqual([]);
  });

  it("rejects unsupported sources and unsafe paths before resolution", async () => {
    const unknownSource = renderDirective({
      file: "demo.html",
      source: "project",
    });
    expect((await unknownSource.findByRole("alert")).textContent).toMatch(
      /source.*workspace or thread-storage/i,
    );
    expect(unknownSource.experimental_fileResourceCalls).toEqual([]);
    cleanup();

    const traversal = renderDirective({ file: "../secret.html" });
    expect((await traversal.findByRole("alert")).textContent).toMatch(
      /source-relative/i,
    );
    expect(traversal.experimental_fileResourceCalls).toEqual([]);
  });

  it("resolves a workspace HTML file and renders its leased URL in an opaque-origin sandbox", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective(
      { file: "charts/demo file.html" },
      {},
      openWorkspaceFile,
    );

    const iframe = await waitFor(() => {
      const element = slot.container.querySelector("iframe");
      expect(element).toBeTruthy();
      return element as HTMLIFrameElement;
    });
    expect(slot.experimental_fileResourceCalls).toEqual([
      {
        target: {
          kind: "workspace",
          environmentId: "env_1",
          path: "charts/demo file.html",
        },
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/file-previews/lease_1/charts/demo%20file.html",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(iframe.getAttribute("src")).toBe(
      "/api/v1/file-previews/lease_1/charts/demo%20file.html",
    );
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.style.height).toBe("224px");

    fireEvent.click(
      slot.getByRole("button", {
        name: "Open charts/demo file.html in sidebar",
      }),
    );
    expect(openWorkspaceFile).toHaveBeenCalledWith("charts/demo file.html");
  });

  it("resolves thread-storage without a workspace action", async () => {
    const openWorkspaceFile = vi.fn(() => true);
    const slot = renderDirective(
      { source: "thread-storage", file: "reports/result.html" },
      {},
      openWorkspaceFile,
    );
    await waitFor(() =>
      expect(slot.container.querySelector("iframe")).toBeTruthy(),
    );
    expect(slot.experimental_fileResourceCalls).toEqual([
      {
        target: {
          kind: "thread-storage",
          threadId: "thr_1",
          path: "reports/result.html",
        },
      },
    ]);
    expect(
      slot.queryByRole("button", { name: /open .* in sidebar/i }),
    ).toBeNull();
    expect(openWorkspaceFile).not.toHaveBeenCalled();
  });

  it("renders fetched Markdown through the host renderer", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("# Notes\n\nReady for review.", {
        headers: { "content-type": "text/markdown" },
      }),
    );
    const slot = renderDirective({ file: "reports/notes.md", height: "480" });
    const markdown = await slot.findByTestId("bb-markdown");
    expect(markdown.textContent).toBe("# Notes\n\nReady for review.");
    expect(markdown.parentElement?.style.height).toBe("480px");
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  it("reserves the requested height while resource resolution is pending", async () => {
    let resolveResource = (_resource: ExperimentalFileResource) => {};
    const pending = new Promise<ExperimentalFileResource>((resolve) => {
      resolveResource = resolve;
    });
    const slot = renderDirective(
      { file: "demo.html", height: "480" },
      { experimental_resolveFileResource: () => pending },
      vi.fn(() => true),
    );
    const loading = await slot.findByRole("status", {
      name: "Loading visualization demo.html",
    });
    expect((loading as HTMLElement).style.height).toBe("480px");
    resolveResource(
      resourceFor({
        kind: "workspace",
        environmentId: "env_1",
        path: "demo.html",
      }),
    );
    const iframe = await waitFor(() => {
      const element = slot.container.querySelector("iframe");
      expect(element).toBeTruthy();
      return element as HTMLIFrameElement;
    });
    expect(iframe.style.height).toBe("480px");
  });

  it("shows resource and content failures", async () => {
    const resolutionFailure = renderDirective(
      { file: "missing.html" },
      {
        experimental_resolveFileResource: () => {
          throw new Error("Workspace is unavailable");
        },
      },
    );
    expect((await resolutionFailure.findByRole("alert")).textContent).toMatch(
      /workspace is unavailable/i,
    );
    cleanup();

    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const missing = renderDirective({ file: "missing.html" });
    expect((await missing.findByRole("alert")).textContent).toMatch(
      /preview file not found/i,
    );
  });

  it("rejects out-of-range heights", async () => {
    const slot = renderDirective({ file: "demo.html", height: "42" });
    expect((await slot.findByRole("alert")).textContent).toMatch(
      /120 to 1200/i,
    );
    expect(slot.experimental_fileResourceCalls).toEqual([]);
  });
});

it("retries a workspace preview when the message environment becomes available", async () => {
  const registration = app.messageDirectives[0]!;
  const Component = registration.component;
  const props = {
    attributes: { file: "demo.html" },
    source: "::inline-vis{}",
    message: { ...message, experimental_environmentId: null },
    openWorkspaceFile: null,
  };
  const slot = renderSlot(registration, props, {
    experimental_resolveFileResource: resourceFor,
  });
  expect((await slot.findByRole("alert")).textContent).toContain(
    "no workspace environment",
  );
  slot.lifecycle.rerender(<Component {...props} message={message} />);
  await waitFor(() =>
    expect(slot.container.querySelector("iframe")).not.toBeNull(),
  );
});
