import type {
  CreateFilePreviewResponse,
  FileReference,
  HostFileListRequest,
  HostFileReadRequest,
  HostFileWriteRequest,
  HostPathListRequest,
  HostFileListResponse,
  HostFileReadResponse,
  HostFileWriteResponse,
  HostMkdirResponse,
  HostMovePathResponse,
  HostPathListResponse,
  HostRemovePathResponse,
  ResolveFileResourceResponse,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type FileReadArgs = HostFileReadRequest & { signal?: AbortSignal };
export type FileWriteArgs = HostFileWriteRequest;
export type FileListArgs = HostFileListRequest & { signal?: AbortSignal };
export type PathListArgs = HostPathListRequest & { signal?: AbortSignal };

export interface FileMkdirArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FileMoveArgs {
  hostId?: string;
  sourcePath: string;
  destinationPath: string;
  rootPath?: string;
}

export interface FileRemoveArgs {
  hostId?: string;
  path: string;
  rootPath?: string;
  recursive?: boolean;
}

export interface FilePreviewArgs {
  hostId?: string;
  rootPath: string;
  signal?: AbortSignal;
  ttlMs?: number;
}

export interface ExperimentalFileResourceArgs {
  target: FileReference;
  signal?: AbortSignal;
}

export type FileReadResult = HostFileReadResponse;
export type FileWriteResult = HostFileWriteResponse;
export type FileListResult = HostFileListResponse;
export type PathListResult = HostPathListResponse;
export type FileMkdirResult = HostMkdirResponse;
export type FileMoveResult = HostMovePathResponse;
export type FileRemoveResult = HostRemovePathResponse;
export type FilePreviewResult = CreateFilePreviewResponse;
export type ExperimentalFileResourceResult = ResolveFileResourceResponse;

export interface FilesArea {
  read(args: FileReadArgs): Promise<FileReadResult>;
  write(args: FileWriteArgs): Promise<FileWriteResult>;
  list(args: FileListArgs): Promise<FileListResult>;
  listPaths(args: PathListArgs): Promise<PathListResult>;
  mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
  move(args: FileMoveArgs): Promise<FileMoveResult>;
  remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
  createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
  experimental_resolveResource(
    args: ExperimentalFileResourceArgs,
  ): Promise<ExperimentalFileResourceResult>;
}

export function createFilesArea(args: CreateSdkAreaArgs): FilesArea {
  const { transport } = args;
  return {
    async read(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.files.read.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    async write(input) {
      return transport.readJson(
        transport.api.v1.files.write.$post({ json: input }),
      );
    },
    async list(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.files.list.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    async listPaths(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.files.paths.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    async mkdir(input) {
      return transport.readJson(
        transport.api.v1.files.mkdir.$post({ json: input }),
      );
    },
    async move(input) {
      return transport.readJson(
        transport.api.v1.files.move.$post({ json: input }),
      );
    },
    async remove(input) {
      return transport.readJson(
        transport.api.v1.files.remove.$post({ json: input }),
      );
    },
    async createPreview(input) {
      return transport.readJson(
        transport.api.v1.files.previews.$post(
          {
            json: {
              hostId: input.hostId,
              rootPath: input.rootPath,
              ttlMs: input.ttlMs,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async experimental_resolveResource(input) {
      return transport.readJson(
        transport.api.v1.files.resources.$post(
          { json: { target: input.target } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
