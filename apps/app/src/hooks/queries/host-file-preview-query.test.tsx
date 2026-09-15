// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { HEAVY_PAYLOAD_GC_TIME_MS } from "./query-policies";
import { useHostFilePreview } from "./host-file-preview-query";

const filesSdk = vi.hoisted(() => ({
  experimental_resolveResource: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { files: filesSdk },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useHostFilePreview", () => {
  it("uses a successful preview lease for media without reading or retaining file bytes", async () => {
    filesSdk.experimental_resolveResource.mockResolvedValue({
      expiresAtMs: Date.now() + 60_000,
      url: "/api/v1/file-previews/lease-1/diagram.png",
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/diagram.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
      mimeType: "image/png",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 8,
    });
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/diagram.png"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.experimental_resolveResource).toHaveBeenCalledWith({
      target: {
        kind: "host",
        hostId: "host-1",
        path: "/tmp/diagram.png",
      },
      signal: expect.any(AbortSignal),
    });
    expect(filesSdk.read).not.toHaveBeenCalled();
    expect(result.current.data).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      path: "/tmp/diagram.png",
      url: "/api/v1/file-previews/lease-1/diagram.png",
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: [
          "live-file-preview",
          { kind: "host", hostId: "host-1", path: "/tmp/diagram.png" },
        ],
      })?.gcTime,
    ).toBe(HEAVY_PAYLOAD_GC_TIME_MS);
  });

  it("keeps HTML source bytes while avoiding a base64 fallback after a lease succeeds", async () => {
    filesSdk.experimental_resolveResource.mockResolvedValue({
      expiresAtMs: Date.now() + 60_000,
      url: "/api/v1/file-previews/lease-2/report.html",
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/report.html",
      content: "<h1>Report</h1>",
      contentEncoding: "utf8",
      mimeType: "text/html",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 15,
    });
    const encodeSpy = vi.spyOn(globalThis, "btoa");
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/report.html"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.experimental_resolveResource).toHaveBeenCalledTimes(1);
    expect(filesSdk.read).toHaveBeenCalledTimes(1);
    expect(
      filesSdk.experimental_resolveResource.mock.invocationCallOrder[0],
    ).toBeLessThan(filesSdk.read.mock.invocationCallOrder[0]!);
    expect(encodeSpy).not.toHaveBeenCalled();
    expect(result.current.data).toMatchObject({
      kind: "text",
      content: "<h1>Report</h1>",
      url: "/api/v1/file-previews/lease-2/report.html",
    });
  });

  it("keeps ambiguous TypeScript paths on the source-preview path", async () => {
    filesSdk.experimental_resolveResource.mockResolvedValue({
      expiresAtMs: Date.now() + 60_000,
      url: "/api/v1/file-previews/lease-3/example.ts",
    });
    filesSdk.read.mockResolvedValue({
      path: "/tmp/example.ts",
      content: "export const value = 1;\n",
      contentEncoding: "utf8",
      mimeType: "video/mp2t",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 24,
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/example.ts"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(filesSdk.read).toHaveBeenCalledTimes(1);
    expect(result.current.data).toMatchObject({
      kind: "text",
      content: "export const value = 1;\n",
    });
  });

  it("reads and builds a data URL only after preview lease creation fails", async () => {
    filesSdk.experimental_resolveResource.mockRejectedValue(
      new Error("host unavailable"),
    );
    filesSdk.read.mockResolvedValue({
      path: "/tmp/diagram.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
      mimeType: "image/png",
      modifiedAtMs: 1,
      sha256: "hash",
      sizeBytes: 8,
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useHostFilePreview("host-1", "/tmp/diagram.png"),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      filesSdk.experimental_resolveResource.mock.invocationCallOrder[0],
    ).toBeLessThan(filesSdk.read.mock.invocationCallOrder[0]!);
    expect(result.current.data).toMatchObject({
      kind: "image",
      url: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("aborts an active read and releases the heavy cache entry when disabled", async () => {
    let readSignal: AbortSignal | undefined;
    filesSdk.experimental_resolveResource.mockResolvedValue({
      expiresAtMs: Date.now() + 60_000,
      url: "/api/v1/file-previews/lease-4/example.txt",
    });
    filesSdk.read.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          readSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { rerender } = renderHook(
      ({ enabled }) =>
        useHostFilePreview("host-1", "/tmp/example.txt", { enabled }),
      { initialProps: { enabled: true }, wrapper },
    );

    await waitFor(() => expect(filesSdk.read).toHaveBeenCalledTimes(1));
    const activeQuery = queryClient.getQueryCache().find({
      queryKey: [
        "live-file-preview",
        { kind: "host", hostId: "host-1", path: "/tmp/example.txt" },
      ],
    });
    expect(activeQuery).toBeDefined();

    vi.useFakeTimers();
    rerender({ enabled: false });
    expect(readSignal?.aborted).toBe(true);
    expect(activeQuery?.getObserversCount()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEAVY_PAYLOAD_GC_TIME_MS + 1);
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: [
          "live-file-preview",
          { kind: "host", hostId: "host-1", path: "/tmp/example.txt" },
        ],
      }),
    ).toBeUndefined();
  });
});
