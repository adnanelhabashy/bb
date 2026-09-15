import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPdfBlob } from "./pdf-source.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPdfBlob", () => {
  it("loads a PDF-typed raw response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { "content-type": "application/pdf" },
        }),
      ),
    );

    const blob = await loadPdfBlob(
      "/api/v1/file-previews/lease_1/report.pdf",
      new AbortController().signal,
    );

    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
  });
});
