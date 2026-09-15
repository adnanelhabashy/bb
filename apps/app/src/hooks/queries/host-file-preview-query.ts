import {
  useEnvironmentDetailRealtimeSubscription,
  useThreadDetailRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import type {
  FileReference,
  ResolveFileResourceResponse,
} from "@bb/server-contract";
import { useQuery } from "@tanstack/react-query";
import { decodeBase64Bytes, encodeBase64Bytes } from "@/lib/base64-bytes";
import { sdk } from "@/lib/sdk";
import {
  buildFilePreview,
  isHtmlFilePreviewPath,
  normalizeFilePreviewMimeType,
  type FilePreview,
} from "@bb/client-core";
import type { QueryOptions } from "./query-helpers";
import { HEAVY_PAYLOAD_QUERY_POLICY } from "./query-policies";

interface HostMediaPreviewType {
  kind: "image" | "video";
  mimeType: string;
}

const HOST_MEDIA_PREVIEW_TYPES = new Map<string, HostMediaPreviewType>([
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".bmp", { kind: "image", mimeType: "image/bmp" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".heic", { kind: "image", mimeType: "image/heic" }],
  [".heif", { kind: "image", mimeType: "image/heif" }],
  [".ico", { kind: "image", mimeType: "image/vnd.microsoft.icon" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".png", { kind: "image", mimeType: "image/png" }],
  [".svg", { kind: "image", mimeType: "image/svg+xml" }],
  [".svgz", { kind: "image", mimeType: "image/svg+xml" }],
  [".tif", { kind: "image", mimeType: "image/tiff" }],
  [".tiff", { kind: "image", mimeType: "image/tiff" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".3g2", { kind: "video", mimeType: "video/3gpp2" }],
  [".3gp", { kind: "video", mimeType: "video/3gpp" }],
  [".avi", { kind: "video", mimeType: "video/x-msvideo" }],
  [".m4v", { kind: "video", mimeType: "video/x-m4v" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".mpeg", { kind: "video", mimeType: "video/mpeg" }],
  [".mpg", { kind: "video", mimeType: "video/mpeg" }],
  [".ogv", { kind: "video", mimeType: "video/ogg" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
  [".wmv", { kind: "video", mimeType: "video/x-ms-wmv" }],
]);

function getHostFileName(path: string): string {
  const lastSeparatorIndex = Math.max(
    path.lastIndexOf("/"),
    path.lastIndexOf("\\"),
  );
  return path.slice(lastSeparatorIndex + 1);
}

function getHostMediaPreviewType(name: string): HostMediaPreviewType | null {
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0) return null;
  return (
    HOST_MEDIA_PREVIEW_TYPES.get(name.slice(extensionIndex).toLowerCase()) ??
    null
  );
}

export function useHostFilePreview(
  hostId: string | null,
  path: string | null,
  options?: QueryOptions,
) {
  return useLiveFilePreview(
    hostId !== null && path !== null ? { kind: "host", hostId, path } : null,
    options,
  );
}

export function useLiveFilePreview(
  target: FileReference | null,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && target !== null;
  useEnvironmentDetailRealtimeSubscription(
    target?.kind === "workspace" ? target.environmentId : undefined,
    { enabled: enabled && target?.kind === "workspace" },
  );
  useThreadDetailRealtimeSubscription(
    target?.kind === "thread-storage" ? target.threadId : undefined,
    { enabled: enabled && target?.kind === "thread-storage" },
  );
  const activeTarget = enabled ? target : null;
  return useQuery<
    FilePreview & { resource: ResolveFileResourceResponse | null }
  >({
    queryKey: ["live-file-preview", activeTarget],
    queryFn: async ({ signal }) => {
      if (activeTarget === null)
        throw new Error("File preview target is incomplete");
      const activePath = activeTarget.path;
      const name = getHostFileName(activePath);
      const resource = await sdk.files
        .experimental_resolveResource({
          target: activeTarget,
          signal,
        })
        .catch(() => null);
      signal.throwIfAborted();
      const previewUrl = resource?.url ?? null;
      const mediaPreviewType = getHostMediaPreviewType(name);
      if (previewUrl !== null && mediaPreviewType !== null) {
        return {
          ...mediaPreviewType,
          name,
          path: activePath,
          url: previewUrl,
          resource,
        };
      }

      const response = await sdk.files.read({
        experimental_target: activeTarget,
        signal,
      });
      const contentBytes =
        response.contentEncoding === "base64"
          ? decodeBase64Bytes(response.content)
          : new TextEncoder().encode(response.content);
      const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
      const preview = buildFilePreview({
        contentBytes,
        mimeType,
        name,
        path: activePath,
        url: previewUrl ?? activePath,
      });
      if (
        previewUrl !== null ||
        (preview.kind !== "image" &&
          preview.kind !== "video" &&
          !isHtmlFilePreviewPath(activePath))
      ) {
        return { ...preview, resource };
      }

      const base64Content =
        response.contentEncoding === "base64"
          ? response.content
          : encodeBase64Bytes(contentBytes);
      return {
        ...preview,
        resource,
        url: `data:${mimeType};base64,${base64Content}`,
      };
    },
    enabled,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchInterval: 8 * 60_000,
    ...HEAVY_PAYLOAD_QUERY_POLICY,
  });
}
