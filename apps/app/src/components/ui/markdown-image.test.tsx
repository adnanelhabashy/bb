// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownImage } from "./markdown-image";
import { readMarkdownImageDimensions, rememberMarkdownImageDimensions } from "./markdown-image-dimensions";

const source = "https://example.com/screenshot.png";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockVisibility() {
  let notify: IntersectionObserverCallback;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  return (target: Element, isIntersecting: boolean) => act(() => {
    notify([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

function completeImage(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

describe("MarkdownImage", () => {
  it("reserves learned geometry on remount before fetching or decoding", async () => {
    const visible = mockVisibility();
    const first = render(<MarkdownImage src={source} alt="Screenshot" />);
    const image = first.getByAltText<HTMLImageElement>("Screenshot");
    expect(image.hasAttribute("src")).toBe(false);
    visible(image, true);
    expect(image.src).toBe(source);
    completeImage(image, 780, 1688);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    first.unmount();
    const second = render(<MarkdownImage src={source} alt="Screenshot" />);
    const restored = second.getByAltText<HTMLImageElement>("Screenshot");
    expect(restored.hasAttribute("src")).toBe(false);
    expect(restored.style.aspectRatio).toBe(String(780 / 1688));
    expect(restored.style.width).toContain("780px");
    expect(restored.dataset.markdownImageState).toBe("loading");
  });

  it("keeps offscreen and hidden images unfetched and starts intersecting images at high priority", () => {
    const visible = mockVisibility();
    const { getByAltText } = render(<>
      <MarkdownImage src={source} alt="Visible" />
      <MarkdownImage src={`${source}?offscreen`} alt="Offscreen" />
      <div hidden><MarkdownImage src={`${source}?hidden`} alt="Hidden" /></div>
    </>);
    const image = getByAltText<HTMLImageElement>("Visible");
    const offscreen = getByAltText<HTMLImageElement>("Offscreen");
    const hidden = getByAltText<HTMLImageElement>("Hidden");
    visible(offscreen, false);
    visible(hidden, true);
    expect(offscreen.hasAttribute("src")).toBe(false);
    expect(hidden.hasAttribute("src")).toBe(false);
    visible(image, true);
    expect(image.getAttribute("loading")).toBe("eager");
    expect(image.getAttribute("fetchpriority")).toBe("high");
  });

  it("honors explicit dimensions and updates stale learned dimensions after loading changed pixels", async () => {
    rememberMarkdownImageDimensions(source, { width: 780, height: 1688 });
    const visible = mockVisibility();
    const { getByAltText } = render(<MarkdownImage src={source} width="320" height="200" alt="Sized" />);
    const image = getByAltText<HTMLImageElement>("Sized");
    expect(image.style.aspectRatio).toBe("1.6");
    expect(image.style.width).toContain("320px");
    visible(image, true);
    completeImage(image, 900, 600);
    await waitFor(() => expect(readMarkdownImageDimensions(source)).toEqual({ width: 900, height: 600 }));
    expect(image.style.aspectRatio).toBe("1.6");
  });

  it("does not cache the fallback dimensions for picture sources", async () => {
    mockVisibility();
    rememberMarkdownImageDimensions(source, { width: 780, height: 1688 });
    const { getByAltText } = render(<picture>
      <source srcSet="https://example.com/dark.png" media="(prefers-color-scheme: dark)" />
      <MarkdownImage src={source} alt="Responsive" />
    </picture>);
    const image = getByAltText<HTMLImageElement>("Responsive");
    expect(image.style.aspectRatio).toBe("");
    completeImage(image, 900, 600);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
    expect(readMarkdownImageDimensions(source)).toEqual({ width: 780, height: 1688 });
  });

  it("preserves geometry and alt text on errors and can recover on a later load", async () => {
    const visible = mockVisibility();
    rememberMarkdownImageDimensions(source, { width: 640, height: 480 });
    const { getByAltText } = render(<MarkdownImage src={source} alt="Retry screenshot" />);
    const image = getByAltText<HTMLImageElement>("Retry screenshot");
    visible(image, true);
    fireEvent.error(image);
    expect(image.dataset.markdownImageState).toBe("error");
    expect(image.style.aspectRatio).toBe(String(640 / 480));
    expect(image.className).not.toContain("text-transparent");
    completeImage(image, 640, 480);
    await waitFor(() => expect(image.dataset.markdownImageState).toBe("ready"));
  });
});

describe("Markdown image dimension storage", () => {
  it("bounds entries and preserves the full source identity", () => {
    for (let index = 0; index < 257; index++) {
      rememberMarkdownImageDimensions(`${source}?version=${index}`, { width: index + 1, height: 20 });
    }
    expect(readMarkdownImageDimensions(`${source}?version=0`)).toBeUndefined();
    expect(readMarkdownImageDimensions(`${source}?version=256`)).toEqual({ width: 257, height: 20 });
    expect(readMarkdownImageDimensions(source)).toBeUndefined();
  });

  it("ignores malformed stored data, invalid dimensions, and inline image payloads", () => {
    sessionStorage.setItem("bb.markdown-image-dimensions.v1", '[null,["bad",{"width":-1,"height":10}]]');
    expect(readMarkdownImageDimensions("bad")).toBeUndefined();
    rememberMarkdownImageDimensions(source, { width: Infinity, height: 20 });
    expect(readMarkdownImageDimensions(source)).toBeUndefined();
    rememberMarkdownImageDimensions("data:image/png;base64,abc", { width: 20, height: 20 });
    expect(readMarkdownImageDimensions("data:image/png;base64,abc")).toBeUndefined();
  });
});
