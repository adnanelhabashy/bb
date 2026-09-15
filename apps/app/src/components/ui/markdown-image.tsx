import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  readMarkdownImageDimensions,
  rememberMarkdownImageDimensions,
} from "./markdown-image-dimensions";

const visibleImages = new Map<Element, () => void>();
let visibilityObserver: IntersectionObserver | undefined;

function observeImage(image: HTMLImageElement, load: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    load();
    return () => {};
  }
  visibilityObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (
        entry.isIntersecting &&
        !entry.target.closest('[hidden], [inert], [aria-hidden="true"]')
      ) {
        visibleImages.get(entry.target)?.();
      }
    }
  });
  visibleImages.set(image, load);
  visibilityObserver.observe(image);
  return () => {
    visibilityObserver?.unobserve(image);
    visibleImages.delete(image);
    if (visibleImages.size === 0) {
      visibilityObserver?.disconnect();
      visibilityObserver = undefined;
    }
  };
}

function positiveDimension(value: number | string | undefined): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return number !== undefined && Number.isFinite(number) && number > 0
    ? number
    : undefined;
}

export function MarkdownImage({
  src,
  srcSet,
  width,
  height,
  style,
  className,
  onLoad,
  onError,
  ...attributes
}: ComponentPropsWithoutRef<"img"> & { src: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [dimensions, setDimensions] = useState(() =>
    srcSet ? undefined : readMarkdownImageDimensions(src),
  );
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [responsive, setResponsive] = useState(Boolean(srcSet));
  const requestedWidth = positiveDimension(width);
  const requestedHeight = positiveDimension(height);
  const ratio = requestedWidth && requestedHeight
    ? requestedWidth / requestedHeight
    : dimensions ? dimensions.width / dimensions.height : undefined;
  const displayWidth = requestedWidth ?? (requestedHeight && ratio
    ? requestedHeight * ratio
    : dimensions?.width);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (image.parentElement?.tagName === "PICTURE") {
      setResponsive(true);
      setDimensions(undefined);
    }
    return observeImage(image, () => setActive(true));
  }, []);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image || (!active && !responsive)) return;
    let cancelled = false;
    const ready = async () => {
      if (!image.complete || image.naturalWidth === 0) return;
      const intrinsic = { width: image.naturalWidth, height: image.naturalHeight };
      if (!responsive) {
        rememberMarkdownImageDimensions(src, intrinsic);
        setDimensions(intrinsic);
      }
      try {
        await image.decode();
      } catch {}
      if (!cancelled && image.complete && image.naturalWidth > 0) setStatus("ready");
    };
    image.addEventListener("load", ready);
    void ready();
    return () => {
      cancelled = true;
      image.removeEventListener("load", ready);
    };
  }, [src, active, responsive]);

  return (
    <img
      {...attributes}
      ref={imageRef}
      src={active || responsive ? src : undefined}
      srcSet={srcSet}
      width={width}
      height={height}
      data-markdown-image-src={src}
      data-markdown-image-state={status}
      loading={active ? "eager" : "lazy"}
      fetchPriority={active ? "high" : "auto"}
      decoding="async"
      className={cn(className, status === "loading" && "bg-surface-recessed text-transparent")}
      style={{
        ...(ratio && displayWidth ? {
          aspectRatio: String(ratio),
          width: `min(${displayWidth}px, calc(max(384px, 50vh) * ${ratio}))`,
          height: "auto",
        } : status === "loading" ? { minWidth: "1lh", minHeight: "1lh" } : {}),
        ...style,
      }}
      onLoad={onLoad}
      onError={(event) => {
        setStatus("error");
        onError?.(event);
      }}
    />
  );
}
