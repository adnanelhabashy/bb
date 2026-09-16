import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../src/schema.js";
import type { JsonObject, ThreadEventType } from "@bb/domain";
import { createMigratedConnection } from "../helpers/migrated-connection.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  completedItemHistories,
  environments,
  events,
  threadPruningCursors,
  retainedEventOutputs,
  threads,
} from "../../src/schema.js";
import { advanceThreadPruning } from "../../src/data/thread-pruning.js";
import { getThreadEventRewriteGeneration } from "../../src/data/event-rewrite-generation.js";
import { advanceCompletedItemCompaction } from "../../src/data/completed-item-compaction.js";
import { migrateNextCompletedEventItemOutput } from "../../src/data/sweeps.js";
import { deleteExpiredRetainedEventOutputs } from "../../src/data/retained-event-outputs.js";
import {
  listCompactedEventReferences,
  findCompactedEventById,
} from "../../src/data/completed-item-history.js";
import {
  appendDaemonEventsInTransaction,
  copyStoredThreadEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  getHighWaterMarks,
  getFirstParentedTimelineBoundarySequence,
  isTimelineCursorSequencePresent,
  listEvents,
  listItemEventSpansByItems,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredEventRows,
  listStoredEventRowsByParentToolCallIds,
  listStoredItemLifecycleRowsByItems,
  pruneResolvedItemDeltas,
} from "../../src/data/events.js";

function fixture() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "compaction" });
  const { project } = createProject(db, noopNotifier, {
    name: "compaction",
    source: { type: "local_path", hostId: host.id, path: "/tmp/compaction" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  function seed(
    sequence: number,
    type: ThreadEventType,
    data: JsonObject,
    extra: Partial<typeof events.$inferInsert> = {},
  ) {
    const item = data.item;
    const itemId =
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.id === "string"
        ? item.id
        : typeof data.itemId === "string"
          ? data.itemId
          : null;
    const kind =
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? item.type
        : null;
    const itemKind =
      kind === "commandExecution" ||
      kind === "fileChange" ||
      kind === "reasoning" ||
      kind === "agentMessage"
        ? kind
        : null;
    const row: typeof events.$inferInsert = {
      id: `${thread.id}-${sequence}`,
      threadId: thread.id,
      scopeKind: "turn" as const,
      turnId: "turn",
      providerThreadId: "session",
      sequence,
      type,
      itemId,
      itemKind,
      parentToolCallId: null,
      data: JSON.stringify({ providerThreadId: "session", ...data }),
      createdAt: 1000 + sequence * 3,
      ...extra,
    };
    db.insert(events).values(row).run();
    return row.id;
  }
  function compact(limit = 500) {
    let afterSequence = 0;
    const results = [];
    for (let i = 0; i < 100; i++) {
      const result = db.transaction((tx) =>
        advanceCompletedItemCompaction(tx, {
          threadId: thread.id,
          afterSequence,
          throughSequence: 1_000_000,
          limit,
        }),
      );
      results.push(result);
      if (result.complete) return results;
      expect(result.nextSequence).toBeGreaterThan(afterSequence);
      expect(result.scanned).toBeLessThanOrEqual(limit);
      afterSequence = result.nextSequence;
    }
    throw new Error("Compaction did not finish");
  }
  return { db, host, thread, project, seed, compact };
}
const command = (
  status: string,
  aggregatedOutput: string | null = "final output",
): JsonObject => ({
  type: "commandExecution",
  id: "item",
  command: "printf output",
  cwd: "/tmp",
  status,
  approvalStatus: null,
  ...(aggregatedOutput === null ? {} : { aggregatedOutput }),
});
const normalize = (rows: readonly (typeof events.$inferSelect)[]) =>
  rows.map((row) => ({ ...row, data: JSON.parse(row.data) }));

describe("completed item compaction", () => {
  it.each([
    "ambiguous-start",
    "ambiguous-completion",
    "late-delta",
    "session-mismatch",
    "environment-mismatch",
    "malformed-item",
    "malformed-settlement",
    "unpruned-deltas",
    "large-payload",
  ])("leaves %s history intact and advances finitely", (scenario) => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      const startId = f.seed(2, "item/started", { item: command("pending") });
      f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: "partial",
      });
      const ownerId = f.seed(10, "item/completed", {
        item: command("completed"),
      });
      const settlementId = f.seed(20, "turn/completed", {
        status: "completed",
      });
      if (scenario === "ambiguous-start")
        f.seed(4, "item/started", { item: command("pending") });
      if (scenario === "ambiguous-completion")
        f.seed(11, "item/completed", { item: command("completed") });
      if (scenario === "late-delta")
        f.seed(12, "item/commandExecution/outputDelta", {
          itemId: "item",
          delta: "late",
        });
      if (scenario === "unpruned-deltas")
        f.seed(4, "item/commandExecution/outputDelta", {
          itemId: "item",
          delta: "second",
        });
      if (scenario === "session-mismatch")
        f.db
          .update(events)
          .set({ providerThreadId: "reconnected-session" })
          .where(eq(events.id, startId))
          .run();
      if (scenario === "environment-mismatch") {
        f.db
          .insert(environments)
          .values({
            id: "environment",
            projectId: f.project.id,
            hostId: f.host.id,
            createdAt: 1,
            updatedAt: 1,
          })
          .run();
        f.db
          .update(events)
          .set({ environmentId: "environment" })
          .where(eq(events.id, startId))
          .run();
      }
      if (scenario === "malformed-item")
        f.db
          .update(events)
          .set({ data: "[]" })
          .where(eq(events.id, ownerId))
          .run();
      if (scenario === "malformed-settlement")
        f.db
          .update(events)
          .set({ data: "[]" })
          .where(eq(events.id, settlementId))
          .run();
      if (scenario === "large-payload")
        f.db
          .update(events)
          .set({
            data: JSON.stringify({
              providerThreadId: "session",
              item: command("pending", "x".repeat(1024 * 1024)),
            }),
          })
          .where(eq(events.id, startId))
          .run();
      const before = f.db.select().from(events).orderBy(events.sequence).all();
      const results = f.compact(32);
      expect(results.some((row) => Object.keys(row.skipped).length > 0)).toBe(
        true,
      );
      expect(f.db.select().from(events).orderBy(events.sequence).all()).toEqual(
        before,
      );
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(0);
      if (scenario === "unpruned-deltas") {
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
        f.compact(32);
        expect(f.db.select().from(completedItemHistories).all()).toHaveLength(
          1,
        );
      }
    } finally {
      f.db.$client.close();
    }
  });

  it("rolls back history, source deletion and cursor progress together", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(2, "item/started", { item: command("pending") });
      f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: "partial",
      });
      f.seed(4, "item/completed", { item: command("completed") });
      f.seed(5, "turn/completed", { status: "completed" });
      const before = f.db.select().from(events).all();
      const generation = getThreadEventRewriteGeneration(f.thread.id);
      f.db.$client.exec(
        "CREATE TRIGGER fail_compaction BEFORE DELETE ON events WHEN OLD.type='item/started' BEGIN SELECT RAISE(ABORT, 'injected compaction rollback'); END",
      );
      expect(() => advanceThreadPruning(f.db, "completed-items")).toThrow(
        "injected compaction rollback",
      );
      expect(f.db.select().from(events).all()).toEqual(before);
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(0);
      expect(f.db.select().from(threadPruningCursors).all()).toHaveLength(0);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBe(generation);
      f.db.$client.exec("DROP TRIGGER fail_compaction");
      expect(advanceThreadPruning(f.db, "completed-items").removed).toBe(2);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBeGreaterThan(
        generation,
      );
    } finally {
      f.db.$client.close();
    }
  });

  it("preserves every logical field, nested reused identities, item spans and all page boundaries for four kinds", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      const kinds = [
        "commandExecution",
        "fileChange",
        "reasoning",
        "agentMessage",
      ] as const;
      for (let i = 0; i < 8; i++) {
        const kind = kinds[i % 4]!;
        const parent = i < 4 ? null : "parent";
        const item: JsonObject =
          kind === "commandExecution"
            ? command("pending")
            : kind === "fileChange"
              ? {
                  type: kind,
                  id: "item",
                  changes: [{ path: "file", kind: "update", diff: "diff" }],
                  status: "pending",
                  approvalStatus: null,
                }
              : kind === "reasoning"
                ? { type: kind, id: "item", content: [], summary: [] }
                : { type: kind, id: "item", text: "" };
        if (parent) item.parentToolCallId = parent;
        f.seed(
          2 + i * 4,
          "item/started",
          { item, nullable: null, extra: [false, {}] },
          { parentToolCallId: parent },
        );
        if (kind !== "fileChange")
          f.seed(
            3 + i * 4,
            kind === "commandExecution"
              ? "item/commandExecution/outputDelta"
              : kind === "reasoning"
                ? "item/reasoning/textDelta"
                : "item/agentMessage/delta",
            {
              itemId: "item",
              delta: "partial",
              ...(parent ? { parentToolCallId: parent } : {}),
            },
            { parentToolCallId: parent },
          );
        if (kind === "reasoning")
          f.seed(
            4 + i * 4,
            "item/reasoning/summaryTextDelta",
            {
              itemId: "item",
              delta: "summary",
              ...(parent ? { parentToolCallId: parent } : {}),
            },
            { parentToolCallId: parent },
          );
        const finalItem = {
          ...item,
          ...(kind === "commandExecution" || kind === "fileChange"
            ? { status: "completed" }
            : kind === "agentMessage"
              ? { text: "partial final" }
              : { content: ["partial final"], summary: ["summary"] }),
        };
        f.seed(
          50 + i,
          "item/completed",
          { item: finalItem },
          { parentToolCallId: parent },
        );
      }
      f.seed(100, "turn/completed", { status: "completed" });
      const before = listEvents(f.db, { threadId: f.thread.id });
      const itemRefs = [
        { itemId: "item", scopeKind: "turn" as const, turnId: "turn" },
      ];
      const spans = listItemEventSpansByItems(f.db, {
        threadId: f.thread.id,
        items: itemRefs,
      });
      const lifecycle = listStoredItemLifecycleRowsByItems(f.db, {
        threadId: f.thread.id,
        items: itemRefs,
        maxInlineOutputChars: null,
      });
      const buffered = listStoredBufferedTextDeltaRowsByItems(f.db, {
        threadId: f.thread.id,
        items: itemRefs,
        beforeSequence: 50,
      });
      f.compact();
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(8);
      const expected = normalize(before).map((row) =>
        row.type === "item/commandExecution/outputDelta"
          ? { ...row, data: { ...row.data, delta: "" } }
          : row,
      );
      expect(normalize(listEvents(f.db, { threadId: f.thread.id }))).toEqual(
        expected,
      );
      expect(
        listItemEventSpansByItems(f.db, {
          threadId: f.thread.id,
          items: itemRefs,
        }),
      ).toEqual(spans);
      expect(
        listStoredItemLifecycleRowsByItems(f.db, {
          threadId: f.thread.id,
          items: itemRefs,
          maxInlineOutputChars: null,
        }).map((row) => ({ ...row, data: JSON.parse(row.data) })),
      ).toEqual(
        lifecycle.map((row) => ({ ...row, data: JSON.parse(row.data) })),
      );
      expect(
        listStoredBufferedTextDeltaRowsByItems(f.db, {
          threadId: f.thread.id,
          items: itemRefs,
          beforeSequence: 50,
        }).map((row) => ({ ...row, data: JSON.parse(row.data) })),
      ).toEqual(
        buffered.map((row) => ({ ...row, data: JSON.parse(row.data) })),
      );
      for (const boundary of [0, ...before.map((row) => row.sequence), 101])
        for (const order of ["asc", "desc"] as const)
          for (const type of [
            undefined,
            "item/started",
            "item/agentMessage/delta",
            "item/commandExecution/outputDelta",
            "item/reasoning/textDelta",
            "item/reasoning/summaryTextDelta",
          ] as const)
            for (const limit of [1, 3, 20]) {
              const afterSequence = order === "asc" ? boundary : 0;
              const beforeSequence = order === "desc" ? boundary : 101;
              const want = expected.filter(
                (row) =>
                  row.sequence > afterSequence &&
                  row.sequence < beforeSequence &&
                  (type === undefined || row.type === type),
              );
              if (order === "desc") want.reverse();
              const got = listStoredEventRows(f.db, {
                threadId: f.thread.id,
                afterSequence,
                beforeSequence,
                order,
                limit,
                types: type === undefined ? undefined : [type],
              });
              expect(
                got.map((row) => ({ ...row, data: JSON.parse(row.data) })),
              ).toEqual(
                want
                  .slice(0, limit)
                  .map(({ environmentId: _environmentId, ...row }) => row),
              );
            }
      const nested = listStoredEventRowsByParentToolCallIds(f.db, {
        threadId: f.thread.id,
        parentToolCallIds: ["parent"],
        beforeSequence: 50,
        maxInlineOutputChars: null,
      });
      expect(nested.map((row) => row.id)).toEqual(
        expected
          .filter(
            (row) => row.parentToolCallId === "parent" && row.sequence < 50,
          )
          .map((row) => row.id),
      );
      for (const row of before.filter(
        (row) => row.type !== "item/completed" && row.type.startsWith("item/"),
      )) {
        expect(findCompactedEventById(f.db, row.id)?.sequence).toBe(
          row.sequence,
        );
        expect(
          isTimelineCursorSequencePresent(f.db, {
            threadId: f.thread.id,
            sequence: row.sequence,
          }),
        ).toBe(true);
      }
      expect(
        f.compact().reduce((total, result) => total + result.removed, 0),
      ).toBe(0);
    } finally {
      f.db.$client.close();
    }
  });

  it.each([
    {
      name: "completed",
      status: "completed",
      output: "final output",
      start: true,
      delta: "partial",
      settled: true,
      marker: true,
    },
    {
      name: "failed",
      status: "failed",
      output: "failure",
      start: true,
      delta: "partial",
      settled: true,
      marker: true,
    },
    {
      name: "interrupted",
      status: "interrupted",
      output: "interrupted",
      start: true,
      delta: "partial",
      settled: true,
      marker: true,
    },
    {
      name: "missing start contained",
      status: "completed",
      output: "partial final",
      start: false,
      delta: "partial",
      settled: true,
      marker: true,
    },
    {
      name: "missing start partial output",
      status: "completed",
      output: "final",
      start: false,
      delta: "pending",
      settled: true,
      marker: false,
    },
    {
      name: "missing output",
      status: "completed",
      output: null,
      start: true,
      delta: "pending",
      settled: true,
      marker: false,
    },
    {
      name: "empty output",
      status: "completed",
      output: "",
      start: true,
      delta: "pending",
      settled: true,
      marker: false,
    },
    {
      name: "in progress",
      status: "pending",
      output: "final",
      start: true,
      delta: "pending",
      settled: true,
      marker: false,
    },
    {
      name: "unsettled",
      status: "completed",
      output: "final",
      start: true,
      delta: "pending",
      settled: false,
      marker: false,
    },
  ])("enforces command guard: $name", (args) => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      if (args.start) f.seed(2, "item/started", { item: command("pending") });
      const id = f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: args.delta,
      });
      f.seed(4, "item/completed", { item: command(args.status, args.output) });
      if (args.settled) f.seed(5, "turn/completed", { status: "completed" });
      f.compact();
      expect(
        JSON.parse(
          listEvents(f.db, { threadId: f.thread.id }).find(
            (row) => row.id === id,
          )!.data,
        ).delta,
      ).toBe(args.marker ? "" : args.delta);
      expect(findCompactedEventById(f.db, id) !== null).toBe(args.marker);
    } finally {
      f.db.$client.close();
    }
  });

  it("materializes prefixes for rewind and new late arrivals without resurrecting command text", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(2, "item/started", { item: command("pending") });
      f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: "partial",
      });
      const completion = f.seed(4, "item/completed", {
        item: command("completed"),
      });
      f.seed(5, "turn/completed", { status: "completed" });
      f.compact();
      f.db.transaction((tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: f.thread.id,
            scope: { kind: "turn", turnId: "turn" },
            providerThreadId: "session",
            environmentId: null,
            type: "item/commandExecution/outputDelta",
            itemId: "item",
            itemKind: null,
            parentToolCallId: null,
            data: JSON.stringify({
              providerThreadId: "session",
              itemId: "item",
              delta: "late",
            }),
          },
        ]),
      );
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(0);
      expect(
        JSON.parse(
          listEvents(f.db, { threadId: f.thread.id }).find(
            (row) => row.sequence === 3,
          )!.data,
        ).delta,
      ).toBe("");
      pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      expect(
        f.db.select().from(events).where(eq(events.id, completion)).get(),
      ).toBeDefined();
      f.db.delete(events).where(eq(events.sequence, 6)).run();
      f.compact();
      const before = listEvents(f.db, { threadId: f.thread.id }).filter(
        (row) => row.sequence < 4,
      );
      const result = f.db.transaction((tx) =>
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: f.thread.id,
          cutoffSequence: 4,
          oldMaxSequence: 5,
        }),
      );
      expect(result.deletedEventCount).toBe(2);
      expect(normalize(listEvents(f.db, { threadId: f.thread.id }))).toEqual(
        normalize(before),
      );
      expect(getHighWaterMarks(f.db, [f.thread.id])[f.thread.id]).toBe(3);
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(0);
    } finally {
      f.db.$client.close();
    }
  });

  it("copies logical prefixes with new identities and keeps owner output mutable", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(2, "item/started", { item: command("pending", "start output") });
      f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: "partial",
      });
      const ownerId = f.seed(4, "item/completed", {
        item: command("completed", "final output"),
      });
      f.seed(5, "turn/completed", { status: "completed" });
      f.db
        .insert(retainedEventOutputs)
        .values({
          eventId: ownerId,
          outputPath: "aggregatedOutput",
          value: "retained output",
          expiresAt: 9999999999999,
        })
        .run();
      f.compact();
      const rows = listStoredEventRows(f.db, {
        threadId: f.thread.id,
        beforeSequence: 4,
      });
      const target = createThread(f.db, noopNotifier, {
        projectId: f.project.id,
        providerId: "codex",
      });
      f.db.transaction((tx) =>
        copyStoredThreadEventsInTransaction(tx, {
          rows,
          targetThreadId: target.id,
          targetEnvironmentId: null,
        }),
      );
      const copied = listEvents(f.db, { threadId: target.id });
      expect(copied.map((row) => row.sequence)).toEqual([1, 2, 3]);
      expect(copied.map((row) => row.createdAt)).toEqual(
        rows.map((row) => row.createdAt),
      );
      expect(
        copied.every((row) => !rows.some((source) => source.id === row.id)),
      ).toBe(true);
      const before = listStoredEventRows(f.db, {
        threadId: f.thread.id,
        beforeSequence: 4,
      });
      f.db
        .update(events)
        .set({
          data: JSON.stringify({
            providerThreadId: "session",
            item: command("completed", "truncated"),
          }),
        })
        .where(eq(events.id, ownerId))
        .run();
      f.db
        .delete(retainedEventOutputs)
        .where(eq(retainedEventOutputs.eventId, ownerId))
        .run();
      expect(
        listStoredEventRows(f.db, { threadId: f.thread.id, beforeSequence: 4 }),
      ).toEqual(before);
      f.db.delete(threads).where(eq(threads.id, f.thread.id)).run();
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(0);
    } finally {
      f.db.$client.close();
    }
  });

  it("preserves compacted history through the existing output migration and expiry", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(2, "item/started", {
        item: command("pending", "original start output"),
      });
      f.seed(3, "item/commandExecution/outputDelta", {
        itemId: "item",
        delta: "partial",
      });
      f.seed(4, "item/completed", {
        item: command("completed", "final ".repeat(30000)),
      });
      f.seed(5, "turn/completed", { status: "completed" });
      f.compact();
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(1);
      const before = listStoredEventRows(f.db, {
        threadId: f.thread.id,
        beforeSequence: 4,
      });
      const result = migrateNextCompletedEventItemOutput(f.db, {
        itemKind: "commandExecution",
        outputPath: "aggregatedOutput",
        limit: 10,
        migratedAt: 2000,
      });
      expect(result.migratedRows).toBe(1);
      expect(f.db.select().from(retainedEventOutputs).all()).toHaveLength(1);
      expect(
        listStoredEventRows(f.db, { threadId: f.thread.id, beforeSequence: 4 }),
      ).toEqual(before);
      expect(
        deleteExpiredRetainedEventOutputs(f.db, {
          limit: 10,
          expiredAtOrBefore: Number.MAX_SAFE_INTEGER,
        }).deleted,
      ).toBe(1);
      expect(
        listStoredEventRows(f.db, { threadId: f.thread.id, beforeSequence: 4 }),
      ).toEqual(before);
    } finally {
      f.db.$client.close();
    }
  });

  it.each([
    {
      scope: { turnIds: ["turn"] },
      index: "events_thread_turn_type_item_sequence_idx",
    },
    {
      scope: { parentToolCallIds: ["parent"] },
      index: "events_parent_tool_call_thread_parent_sequence_idx",
    },
    {
      scope: {
        items: [{ itemId: "item", scopeKind: "turn" as const, turnId: "turn" }],
      },
      index: "events_item_lifecycle_thread_item_sequence_idx",
    },
  ])("selects scoped owners before history for $index", ({ scope, index }) => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(
        2,
        "item/started",
        { item: { ...command("pending"), parentToolCallId: "parent" } },
        { parentToolCallId: "parent" },
      );
      f.seed(
        3,
        "item/commandExecution/outputDelta",
        { itemId: "item", delta: "partial", parentToolCallId: "parent" },
        { parentToolCallId: "parent" },
      );
      f.seed(
        20,
        "item/completed",
        { item: { ...command("completed"), parentToolCallId: "parent" } },
        { parentToolCallId: "parent" },
      );
      f.seed(21, "turn/completed", { status: "completed" });
      f.compact();
      const plans: string[][] = [];
      const db = drizzle({
        client: f.db.$client,
        schema,
        logger: {
          logQuery(query, params) {
            plans.push(
              f.db.$client
                .prepare<unknown[], { detail: string }>(
                  `EXPLAIN QUERY PLAN ${query}`,
                )
                .all(...params)
                .map((row) => row.detail),
            );
          },
        },
      });
      const rows = listCompactedEventReferences(db, {
        threadId: f.thread.id,
        ...scope,
        beforeSequence: 10,
        limit: 20,
      });
      expect(rows.map((row) => row.sequence)).toEqual([2, 3]);
      expect(plans).toHaveLength(3);
      for (const plan of plans) {
        expect(plan[0]).toContain(index);
        expect(plan[1]).toContain(
          "sqlite_autoindex_completed_item_histories_1",
        );
      }
    } finally {
      f.db.$client.close();
    }
  });

  it("preserves nested ordering when a child completion lies beyond the window", () => {
    const f = fixture();
    try {
      f.seed(1, "turn/started", {});
      f.seed(2, "item/started", { item: { type: "toolCall", id: "parent", tool: "agent", arguments: {}, status: "pending" } }, { itemId: "parent", itemKind: "toolCall" });
      f.seed(3, "item/started", { item: { ...command("pending"), parentToolCallId: "parent" } }, { parentToolCallId: "parent" });
      f.seed(4, "client/turn/requested", { initiator: "user", input: [{ type: "text", text: "interleaved input", mentions: [] }] }, { scopeKind: "thread", turnId: null });
      f.seed(5, "item/commandExecution/outputDelta", { itemId: "item", delta: "partial", parentToolCallId: "parent" }, { parentToolCallId: "parent" });
      f.seed(20, "item/completed", { item: { ...command("completed"), parentToolCallId: "parent" } }, { parentToolCallId: "parent" });
      f.seed(21, "turn/completed", { status: "completed" });
      const read = (maxSeq: number) => getFirstParentedTimelineBoundarySequence(f.db, { threadId: f.thread.id, sequenceStart: 0, maxSeq });
      expect([read(4), read(5), read(21)]).toEqual([null, 4, 4]);
      f.compact();
      expect(f.db.select().from(completedItemHistories).all()).toHaveLength(1);
      expect([read(4), read(5), read(21)]).toEqual([null, 4, 4]);
    } finally { f.db.$client.close(); }
  });
});
