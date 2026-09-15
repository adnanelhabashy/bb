import { z } from "zod";
import {
  FILE_LIST_EXCLUDE_NAME_MAX_LENGTH,
  FILE_LIST_EXCLUDE_NAMES_MAX,
  FILE_LIST_LIMIT_MAX,
} from "@bb/domain";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import { fileReferenceSchema, type FileReference } from "./file-reference.js";

export { fileReferenceSchema } from "./file-reference.js";
export type { FileReference } from "./file-reference.js";

export const hostFileReadRequestSchema = z.union([
  z
    .object({
      hostId: z.string().min(1).optional(),
      path: z.string().min(1),
      rootPath: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      experimental_target: fileReferenceSchema,
    })
    .strict(),
]);
export type HostFileReadRequest = z.infer<typeof hostFileReadRequestSchema>;

export const hostFileWriteRequestSchema = z.union([
  z
    .object({
      hostId: z.string().min(1).optional(),
      path: z.string().min(1),
      rootPath: z.string().min(1).optional(),
      content: z.string(),
      contentEncoding: z.enum(["utf8", "base64"]).optional(),
      createParents: z.boolean().optional(),
      expectedSha256: z.string().nullable().optional(),
      mode: z.number().int().min(0).max(0o777).optional(),
    })
    .strict(),
  z
    .object({
      experimental_target: fileReferenceSchema,
      content: z.string(),
      contentEncoding: z.enum(["utf8", "base64"]).optional(),
      createParents: z.boolean().optional(),
      expectedSha256: z.string().nullable().optional(),
      mode: z.number().int().min(0).max(0o777).optional(),
    })
    .strict(),
]);
export type HostFileWriteRequest = z.infer<typeof hostFileWriteRequestSchema>;

const fileListExcludeNamesRequestSchema = z
  .array(z.string().min(1).max(FILE_LIST_EXCLUDE_NAME_MAX_LENGTH))
  .max(FILE_LIST_EXCLUDE_NAMES_MAX)
  .optional();

export const hostFileListRequestSchema = z.union([
  z
    .object({
      hostId: z.string().min(1).optional(),
      path: z.string().min(1),
      query: z.string().optional(),
      limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
      includeHidden: z.boolean().optional(),
      excludeNames: fileListExcludeNamesRequestSchema,
    })
    .strict(),
  z
    .object({
      experimental_target: fileReferenceSchema,
      experimental_directory: z.enum(["self", "root"]),
      query: z.string().optional(),
      limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
      includeHidden: z.boolean().optional(),
      excludeNames: fileListExcludeNamesRequestSchema,
    })
    .strict(),
]);
export type HostFileListRequest = z.infer<typeof hostFileListRequestSchema>;

export const hostPathListRequestSchema = z.union([
  z
    .object({
      hostId: z.string().min(1).optional(),
      path: z.string().min(1),
      query: z.string().optional(),
      limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
      includeFiles: z.boolean(),
      includeDirectories: z.boolean(),
      includeHidden: z.boolean().optional(),
      excludeNames: fileListExcludeNamesRequestSchema,
    })
    .strict(),
  z
    .object({
      experimental_target: fileReferenceSchema,
      experimental_directory: z.enum(["self", "root"]),
      query: z.string().optional(),
      limit: z.number().int().positive().max(FILE_LIST_LIMIT_MAX).optional(),
      includeFiles: z.boolean(),
      includeDirectories: z.boolean(),
      includeHidden: z.boolean().optional(),
      excludeNames: fileListExcludeNamesRequestSchema,
    })
    .strict(),
]);
export type HostPathListRequest = z.infer<typeof hostPathListRequestSchema>;

export const hostMkdirRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
export type HostMkdirRequest = z.infer<typeof hostMkdirRequestSchema>;

export const hostMovePathRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    sourcePath: z.string().min(1),
    destinationPath: z.string().min(1),
    rootPath: z.string().min(1).optional(),
  })
  .strict();
export type HostMovePathRequest = z.infer<typeof hostMovePathRequestSchema>;

export const hostRemovePathRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    path: z.string().min(1),
    rootPath: z.string().min(1).optional(),
    recursive: z.boolean().optional(),
  })
  .strict();
export type HostRemovePathRequest = z.infer<typeof hostRemovePathRequestSchema>;

export const createFilePreviewRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
    rootPath: z.string().min(1),
    ttlMs: z.number().int().min(60_000).max(3_600_000).optional(),
  })
  .strict();
export type CreateFilePreviewRequest = z.infer<
  typeof createFilePreviewRequestSchema
>;
export interface CreateFilePreviewResponse {
  baseUrl: string;
  expiresAtMs: number;
}

export const resolveFileResourceRequestSchema = z
  .object({ target: fileReferenceSchema })
  .strict();

export type ResolveFileResourceRequest = z.infer<
  typeof resolveFileResourceRequestSchema
>;

export interface ResolveFileResourceResponse {
  absolutePath: string;
  rootPath: string;
  baseUrl: string;
  expiresAtMs: number;
  path: string;
  target: FileReference;
  url: string;
}

export type HostFileReadResponse = Exclude<
  HostDaemonOnlineRpcResultByType["host.read_file"],
  { notModified: true }
>;
export type HostFileWriteResponse =
  HostDaemonOnlineRpcResultByType["host.write_file"];
export type HostFileListResponse =
  HostDaemonOnlineRpcResultByType["host.list_files"];
export type HostPathListResponse =
  HostDaemonOnlineRpcResultByType["host.list_paths"];
export type HostMkdirResponse = HostDaemonOnlineRpcResultByType["host.mkdir"];
export type HostMovePathResponse =
  HostDaemonOnlineRpcResultByType["host.move_path"];
export type HostRemovePathResponse =
  HostDaemonOnlineRpcResultByType["host.remove_path"];
