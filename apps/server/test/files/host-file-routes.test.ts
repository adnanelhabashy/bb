import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedThreadFixture,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { DEFAULT_PATH_LIST_EXCLUDE_NAMES } from "../../src/routes/path-list-policy.js";

const DEFAULT_EXCLUDE_NAMES = [...DEFAULT_PATH_LIST_EXCLUDE_NAMES];

const WRITTEN_RESULT = {
  outcome: "written",
  sha256: "a".repeat(64),
  sizeBytes: 5,
} as const;

const READ_RESULT = {
  path: "/home/me/notes/note.md",
  content: "# Hi",
  contentEncoding: "utf8",
  mimeType: "text/markdown",
  modifiedAtMs: 1234,
  sha256: "b".repeat(64),
  sizeBytes: 4,
} as const;

function postJson(path: string, body: unknown): [string, RequestInit] {
  return [
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ];
}

describe("host file routes", () => {
  it("rejects hostile-origin and text/plain privileged mutations before host RPC", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return { ok: true, result: { ok: true } };
        },
      });

      const mutations = [
        ["/api/v1/files/write", { path: "/notes/a.md", content: "attacker" }],
        ["/api/v1/files/mkdir", { path: "/notes/private" }],
        [
          "/api/v1/files/move",
          {
            sourcePath: "/notes/a.md",
            destinationPath: "/notes/b.md",
          },
        ],
        ["/api/v1/files/remove", { path: "/notes/b.md" }],
      ] as const;

      for (const [route, payload] of mutations) {
        const hostile = await harness.app.request(route, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify(payload),
        });
        expect(hostile.status, route).toBe(403);

        const simpleRequest = await harness.app.request(route, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: JSON.stringify(payload),
        });
        expect(simpleRequest.status, route).toBe(415);
      }

      expect(commands).toEqual([]);
    });
  });

  it("revalidates preview files while keeping sandboxed HTML uncached", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: unknown[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          if (
            request.command.type === "host.read_file" &&
            request.command.path.endsWith(".png")
          ) {
            return {
              ok: true,
              result: {
                path: "/notes/chart.png",
                contentEncoding: "base64",
                mimeType: "image/png",
                sha256: "d".repeat(64),
                sizeBytes: 4,
                notModified: true,
              },
            };
          }
          return {
            ok: true,
            result: {
              path: "/notes/report.html",
              content: "<!doctype html><h1>Report</h1>",
              contentEncoding: "utf8",
              mimeType: "text/html",
              sha256: "c".repeat(64),
              sizeBytes: 31,
            },
          };
        },
      });

      const leaseResponse = await harness.app.request(
        ...postJson("/api/v1/files/previews", { rootPath: "/notes" }),
      );
      expect(leaseResponse.status).toBe(200);
      const lease = await readJson(leaseResponse);
      expect(lease).toMatchObject({
        baseUrl: expect.stringMatching(/^\/api\/v1\/file-previews\//),
      });
      if (
        typeof lease !== "object" ||
        lease === null ||
        !("baseUrl" in lease) ||
        typeof lease.baseUrl !== "string"
      ) {
        throw new Error("Preview response missing baseUrl");
      }

      const image = await harness.app.request(`${lease.baseUrl}/chart.png`, {
        headers: { "if-none-match": `"${"d".repeat(64)}"` },
      });
      expect(image.status).toBe(304);
      expect(image.headers.get("cache-control")).toBe("private, no-cache");

      const content = await harness.app.request(
        `${lease.baseUrl}/report.html`,
        {
          headers: { "if-none-match": `"${"c".repeat(64)}"` },
        },
      );
      expect(content.status).toBe(200);
      expect(content.headers.get("cache-control")).toBe("no-store");
      expect(content.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(content.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(content.text()).resolves.toContain("<h1>Report</h1>");
      expect(commands).toEqual([
        {
          type: "host.read_file",
          path: "/notes/chart.png",
          rootPath: "/notes",
          ifNoneMatch: {
            kind: "sha256",
            values: ["d".repeat(64)],
          },
        },
        {
          type: "host.read_file",
          path: "/notes/report.html",
          rootPath: "/notes",
        },
      ]);
    });
  });

  it("uses the same canonical resolver for reads, writes, directory listings, and previews", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, environment, thread } = seedThreadFixture(
        harness,
        { environment: { path: "C:\\worktrees\\project" } },
      );
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          commands.push(command);
          if (command.type === "host.write_file")
            return {
              ok: true,
              result: { outcome: "conflict", currentSha256: "concurrent" },
            };
          if (command.type === "host.list_paths")
            return { ok: true, result: { paths: [], truncated: false } };
          if (command.type === "host.list_files")
            return { ok: true, result: { files: [], truncated: false } };
          return { ok: true, result: READ_RESULT };
        },
      });
      const cases = [
        {
          target: {
            kind: "workspace",
            environmentId: environment.id,
            path: "docs/plan.md",
          },
          rootPath: "C:\\worktrees\\project",
          path: "C:\\worktrees\\project\\docs\\plan.md",
        },
        {
          target: { kind: "host", hostId: host.id, path: "/shared/plan.md" },
          rootPath: "/shared",
          path: "/shared/plan.md",
        },
        {
          target: {
            kind: "thread-storage",
            threadId: thread.id,
            path: "docs/plan.md",
          },
          rootPath: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`,
          path: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}/docs/plan.md`,
        },
      ];
      for (const { target, path, rootPath } of cases) {
        const read = await harness.app.request(
          ...postJson("/api/v1/files/read", { experimental_target: target }),
        );
        expect(read.status).toBe(200);
        expect(commands.at(-1)).toEqual({
          type: "host.read_file",
          path,
          rootPath,
        });
        const write = await harness.app.request(
          ...postJson("/api/v1/files/write", {
            experimental_target: target,
            content: "edited",
            expectedSha256: "original",
          }),
        );
        expect(write.status).toBe(200);
        expect(await readJson(write)).toEqual({
          outcome: "conflict",
          currentSha256: "concurrent",
        });
        expect(commands.at(-1)).toMatchObject({
          type: "host.write_file",
          path,
          rootPath,
          expectedSha256: "original",
        });
        for (const endpoint of ["list", "paths"]) {
          const list = await harness.app.request(
            ...postJson(`/api/v1/files/${endpoint}`, {
              experimental_target: target,
              experimental_directory: "root",
              ...(endpoint === "paths"
                ? { includeFiles: true, includeDirectories: true }
                : {}),
            }),
          );
          expect(list.status).toBe(200);
          expect(commands.at(-1)).toMatchObject({ path: rootPath });
        }
        const preview = await harness.app.request(
          ...postJson("/api/v1/files/resources", { target }),
        );
        expect(await readJson(preview)).toMatchObject({
          absolutePath: path,
          rootPath,
        });
      }
      const count = commands.length;
      for (const body of [
        {
          experimental_target: {
            kind: "workspace",
            environmentId: environment.id,
            path: "../escape.md",
          },
        },
        {
          experimental_target: cases[0]?.target,
          hostId: host.id,
          path: "/override",
        },
      ]) {
        expect(
          (await harness.app.request(...postJson("/api/v1/files/read", body)))
            .status,
        ).toBe(400);
      }
      expect(commands).toHaveLength(count);
    });
  });

  it("resolves canonical file references to confined preview leases", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, environment, thread } = seedThreadFixture(
        harness,
        {
          environment: { path: "/worktrees/project" },
        },
      );
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return {
            ok: true,
            result: {
              path:
                request.command.type === "host.read_file"
                  ? request.command.path
                  : "",
              content: "# Report",
              contentEncoding: "utf8",
              mimeType: "text/markdown",
              sha256: "c".repeat(64),
              sizeBytes: 8,
            },
          };
        },
      });

      const workspaceResponse = await harness.app.request(
        ...postJson("/api/v1/files/resources", {
          target: {
            kind: "workspace",
            environmentId: environment.id,
            path: "reports/summary.md",
          },
        }),
      );
      expect(workspaceResponse.status).toBe(200);
      const workspace = await readJson(workspaceResponse);
      expect(workspace).toMatchObject({
        baseUrl: expect.stringMatching(/^\/api\/v1\/file-previews\//),
        path: "reports/summary.md",
        target: {
          kind: "workspace",
          environmentId: environment.id,
          path: "reports/summary.md",
        },
        url: expect.stringMatching(/\/reports\/summary\.md$/),
      });
      if (
        typeof workspace !== "object" ||
        workspace === null ||
        !("url" in workspace) ||
        typeof workspace.url !== "string"
      ) {
        throw new Error("File resource response missing url");
      }

      const content = await harness.app.request(workspace.url);
      expect(content.status).toBe(200);
      await expect(content.text()).resolves.toBe("# Report");

      const storageResponse = await harness.app.request(
        ...postJson("/api/v1/files/resources", {
          target: {
            kind: "thread-storage",
            threadId: thread.id,
            path: "reports/stored.md",
          },
        }),
      );
      const storage = await readJson(storageResponse);
      expect(storageResponse.status).toBe(200);
      expect(storage).toMatchObject({
        path: "reports/stored.md",
        target: {
          kind: "thread-storage",
          threadId: thread.id,
          path: "reports/stored.md",
        },
      });
      if (
        typeof storage !== "object" ||
        storage === null ||
        !("url" in storage) ||
        typeof storage.url !== "string"
      ) {
        throw new Error("Storage resource response missing url");
      }
      expect((await harness.app.request(storage.url)).status).toBe(200);

      const hostResponse = await harness.app.request(
        ...postJson("/api/v1/files/resources", {
          target: {
            kind: "host",
            hostId: host.id,
            path: "/exports/final.pdf",
          },
        }),
      );
      const hostResource = await readJson(hostResponse);
      expect(hostResponse.status).toBe(200);
      expect(hostResource).toMatchObject({
        path: "final.pdf",
        target: {
          kind: "host",
          hostId: host.id,
          path: "/exports/final.pdf",
        },
      });
      if (
        typeof hostResource !== "object" ||
        hostResource === null ||
        !("url" in hostResource) ||
        typeof hostResource.url !== "string"
      ) {
        throw new Error("Host resource response missing url");
      }
      expect((await harness.app.request(hostResource.url)).status).toBe(200);

      expect(commands).toEqual([
        {
          type: "host.read_file",
          path: "/worktrees/project/reports/summary.md",
          rootPath: "/worktrees/project",
        },
        {
          type: "host.read_file",
          path: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}/reports/stored.md`,
          rootPath: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`,
        },
        {
          type: "host.read_file",
          path: "/exports/final.pdf",
          rootPath: "/exports",
        },
      ]);
    });
  });

  it("rejects traversal and invalid absolute resource paths before leasing", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host } = seedThreadFixture(harness);
      for (const target of [
        {
          kind: "workspace",
          environmentId: environment.id,
          path: "../secret.md",
        },
        { kind: "host", hostId: host.id, path: "relative.pdf" },
        {
          kind: "host",
          hostId: host.id,
          path: "/exports/../secret.pdf",
        },
      ]) {
        const response = await harness.app.request(
          ...postJson("/api/v1/files/resources", { target }),
        );
        expect(response.status).toBe(400);
      }
    });
  });

  it("routes recursive path listings and confined mutations to the selected daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          if (request.command.type === "host.list_paths") {
            return { ok: true, result: { paths: [], truncated: false } };
          }
          if (request.command.type === "host.list_files") {
            return { ok: true, result: { files: [], truncated: false } };
          }
          return { ok: true, result: { ok: true } };
        },
      });

      for (const [route, payload] of [
        [
          "/api/v1/files/paths",
          { path: "/notes", includeFiles: true, includeDirectories: true },
        ],
        [
          "/api/v1/files/paths",
          {
            path: "/notes",
            includeFiles: true,
            includeDirectories: true,
            includeHidden: false,
          },
        ],
        [
          "/api/v1/files/list",
          { path: "/notes", includeHidden: false, excludeNames: [".obsidian"] },
        ],
        [
          "/api/v1/files/mkdir",
          { path: "/notes/projects", rootPath: "/notes" },
        ],
        [
          "/api/v1/files/move",
          {
            sourcePath: "/notes/a.md",
            destinationPath: "/notes/b.md",
            rootPath: "/notes",
          },
        ],
        ["/api/v1/files/remove", { path: "/notes/b.md", rootPath: "/notes" }],
      ] as const) {
        const response = await harness.app.request(...postJson(route, payload));
        expect(
          response.status,
          `${route}: ${await response.clone().text()}`,
        ).toBe(200);
      }

      expect(commands).toEqual([
        {
          type: "host.list_paths",
          path: "/notes",
          limit: 1000,
          includeFiles: true,
          includeDirectories: true,
          includeHidden: true,
          respectGitIgnore: false,
          excludeNames: DEFAULT_EXCLUDE_NAMES,
        },
        {
          type: "host.list_paths",
          path: "/notes",
          limit: 1000,
          includeFiles: true,
          includeDirectories: true,
          includeHidden: false,
          respectGitIgnore: false,
          excludeNames: DEFAULT_EXCLUDE_NAMES,
        },
        {
          type: "host.list_files",
          path: "/notes",
          limit: 1000,
          includeHidden: false,
          respectGitIgnore: false,
          excludeNames: [".obsidian"],
        },
        {
          type: "host.mkdir",
          path: "/notes/projects",
          rootPath: "/notes",
          recursive: false,
        },
        {
          type: "host.move_path",
          sourcePath: "/notes/a.md",
          destinationPath: "/notes/b.md",
          rootPath: "/notes",
        },
        {
          type: "host.remove_path",
          path: "/notes/b.md",
          rootPath: "/notes",
          recursive: false,
        },
      ]);
    });
  });

  it("fills write defaults and resolves the primary host at the boundary", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          requests.push(request);
          if (request.command.type !== "host.write_file") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          return { ok: true, result: WRITTEN_RESULT };
        },
      });

      const response = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(WRITTEN_RESULT);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.command).toEqual({
        type: "host.write_file",
        path: "/home/me/notes/note.md",
        content: "hello",
        contentEncoding: "utf8",
        createParents: false,
      });
    });
  });

  it("passes the create-only null guard through to the daemon", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const commands: unknown[] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          commands.push(request.command);
          return {
            ok: true,
            result: { outcome: "conflict", currentSha256: null },
          };
        },
      });

      const response = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: host.id,
          path: "/home/me/notes/new.md",
          content: "hello",
          expectedSha256: null,
          createParents: true,
        }),
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        outcome: "conflict",
        currentSha256: null,
      });
      expect(commands[0]).toMatchObject({
        expectedSha256: null,
        createParents: true,
      });
    });
  });

  it("serves reads and remaps daemon ENOENT to 404", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "host.read_file") {
            throw new Error(`Unexpected RPC command ${request.command.type}`);
          }
          if (request.command.path === "/home/me/notes/note.md") {
            return { ok: true, result: READ_RESULT };
          }
          return {
            ok: false,
            errorCode: "ENOENT",
            errorMessage: "Path does not exist",
          };
        },
      });

      const okResponse = await harness.app.request(
        ...postJson("/api/v1/files/read", {
          hostId: host.id,
          path: "/home/me/notes/note.md",
          rootPath: "/home/me/notes",
        }),
      );
      expect(okResponse.status).toBe(200);
      expect(await readJson(okResponse)).toEqual(READ_RESULT);

      const missingResponse = await harness.app.request(
        ...postJson("/api/v1/files/read", {
          hostId: host.id,
          path: "/home/me/notes/missing.md",
        }),
      );
      expect(missingResponse.status).toBe(404);
    });
  });

  it("allows a non-primary host target", async () => {
    await withTestHarness(async (harness) => {
      const { host: primary, session: primarySession } = seedHostSession(
        harness.deps,
        { id: "host-file-primary" },
      );
      seedPrimaryHost(harness.deps, primary.id);
      const { host: secondary, session: secondarySession } = seedHostSession(
        harness.deps,
        { id: "host-file-secondary" },
      );

      registerHostRpcResponder(harness, {
        hostId: primary.id,
        sessionId: primarySession.id,
        handle: () => ({ ok: true, result: WRITTEN_RESULT }),
      });
      const primaryOk = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: primary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(primaryOk.status).toBe(200);

      registerHostRpcResponder(harness, {
        hostId: secondary.id,
        sessionId: secondarySession.id,
        handle: () => ({ ok: true, result: WRITTEN_RESULT }),
      });
      const secondaryOk = await harness.app.request(
        ...postJson("/api/v1/files/write", {
          hostId: secondary.id,
          path: "/home/me/notes/note.md",
          content: "hello",
        }),
      );
      expect(secondaryOk.status).toBe(200);
    });
  });
});
