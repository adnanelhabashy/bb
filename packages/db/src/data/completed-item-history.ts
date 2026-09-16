import {
  and,
  getTableColumns,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { ThreadEventScopeKind, ThreadEventType } from "@bb/domain";
import { completedItemHistories, events } from "../schema.js";
import type { DbQueryConnection } from "../connection.js";
import {
  COMPACTED_HISTORY_TYPES,
  decodeHistory,
  parseHistoryPayload,
  restoreHistoryPayload,
} from "../completed-item-history.js";
import type { StoredEventRow } from "./events.js";

interface HistorySelection {
  threadId: string;
  afterSequence?: number;
  beforeSequence?: number;
  types?: readonly ThreadEventType[];
  order?: "asc" | "desc";
  limit?: number;
  parentToolCallIds?: readonly string[];
  items?: readonly {
    itemId: string;
    scopeKind: ThreadEventScopeKind;
    turnId: string | null;
  }[];
  turnIds?: readonly string[];
  parentedOnly?: boolean;
}
interface HistoryReference {
  completionId: string;
  id: string;
  sequence: number;
  type: ThreadEventType;
}

export function mergeHistoryRows<T extends { sequence: number }>(
  physical: readonly T[],
  compacted: readonly T[],
  order: "asc" | "desc" = "asc",
  limit = Number.MAX_SAFE_INTEGER,
): T[] {
  return [...physical, ...compacted]
    .sort((a, b) =>
      order === "asc" ? a.sequence - b.sequence : b.sequence - a.sequence,
    )
    .slice(0, limit);
}

export function listCompactedEventReferences(
  db: DbQueryConnection,
  args: HistorySelection,
): HistoryReference[] {
  if (
    args.types !== undefined &&
    !args.types.some((type) => COMPACTED_HISTORY_TYPES.includes(type))
  )
    return [];
  if (
    args.types?.length === 0 ||
    args.parentToolCallIds?.length === 0 ||
    args.items?.length === 0 ||
    args.turnIds?.length === 0
  )
    return [];
  if (args.types !== undefined && args.types.length > 1)
    return mergeHistoryRows(
      [],
      [...new Set(args.types)].flatMap((type) =>
        listCompactedEventReferences(db, { ...args, types: [type] }),
      ),
      args.order,
      args.limit,
    );
  const slots = [
    {
      id: completedItemHistories.startId,
      sequence: completedItemHistories.startSequence,
      type: sql<ThreadEventType>`'item/started'`,
    },
    {
      id: completedItemHistories.deltaId,
      sequence: completedItemHistories.deltaSequence,
      type: completedItemHistories.deltaType,
    },
    {
      id: completedItemHistories.secondDeltaId,
      sequence: completedItemHistories.secondDeltaSequence,
      type: completedItemHistories.secondDeltaType,
    },
  ];
  const references: HistoryReference[] = [];
  const scoped =
    args.parentToolCallIds !== undefined ||
    args.items !== undefined ||
    args.turnIds !== undefined;
  for (const slot of slots) {
    if (
      slot.id === completedItemHistories.startId &&
      args.types !== undefined &&
      !args.types.includes("item/started")
    )
      continue;
    const conditions: (SQL | undefined)[] = [
      eq(completedItemHistories.threadId, args.threadId),
      isNotNull(slot.id),
      args.afterSequence === undefined
        ? undefined
        : gt(slot.sequence, args.afterSequence),
      args.beforeSequence === undefined
        ? undefined
        : lt(slot.sequence, args.beforeSequence),
      args.types?.[0] === undefined
        ? undefined
        : sql`${slot.type} = ${args.types[0]}`,
    ];
    let source = sql`${completedItemHistories}`;
    if (scoped) {
      const index =
        args.parentToolCallIds !== undefined
          ? sql`events_parent_tool_call_thread_parent_sequence_idx`
          : args.items !== undefined
            ? sql`events_item_lifecycle_thread_item_sequence_idx`
            : sql`events_thread_turn_type_item_sequence_idx`;
      source = sql`${events} INDEXED BY ${index} CROSS JOIN ${completedItemHistories} ON ${completedItemHistories.completionId} = ${events.id}`;
      conditions.push(
        eq(events.threadId, args.threadId),
        eq(events.type, "item/completed"),
      );
      if (args.parentToolCallIds !== undefined)
        conditions.push(
          isNotNull(events.parentToolCallId),
          inArray(events.parentToolCallId, [...args.parentToolCallIds]),
        );
      if (args.turnIds !== undefined)
        conditions.push(inArray(events.turnId, [...args.turnIds]));
      if (args.items !== undefined) {
        conditions.push(
          sql`${events.type} IN ('item/started', 'item/completed', 'item/backgroundTask/completed')`,
        );
        conditions.push(
          or(
            ...args.items.map((item) =>
              and(
                eq(events.itemId, item.itemId),
                eq(events.scopeKind, item.scopeKind),
                item.turnId === null
                  ? isNull(events.turnId)
                  : eq(events.turnId, item.turnId),
              ),
            ),
          ),
        );
      }
    }
    if (args.parentedOnly && !scoped) {
      source = sql`${completedItemHistories} INNER JOIN ${events} ON ${events.id} = ${completedItemHistories.completionId}`;
      conditions.push(isNotNull(events.parentToolCallId));
    }
    references.push(
      ...db.all<HistoryReference>(sql`
      SELECT ${completedItemHistories.completionId} AS completionId, ${slot.id} AS id,
        ${slot.sequence} AS sequence, ${slot.type} AS type
      FROM ${source} WHERE ${and(...conditions)}
      ORDER BY ${slot.sequence} ${args.order === "desc" ? sql`DESC` : sql`ASC`}
      LIMIT ${args.limit ?? Number.MAX_SAFE_INTEGER}
    `),
    );
  }
  return mergeHistoryRows([], references, args.order, args.limit);
}

function truncateHistoryOutput(data: string, limit: number | null): string {
  if (limit === null) return data;
  const payload = parseHistoryPayload(data);
  if (
    payload.item === null ||
    typeof payload.item !== "object" ||
    Array.isArray(payload.item)
  )
    return data;
  let changed = false;
  for (const key of ["aggregatedOutput", "result", "resultText"]) {
    const value = payload.item[key];
    if (typeof value !== "string") continue;
    const characters = Array.from(value);
    if (characters.length <= limit) continue;
    payload.item[key] =
      `${characters.slice(0, limit).join("")}\n…[${(characters.length - limit).toLocaleString("en-US")} more characters truncated]`;
    changed = true;
  }
  return changed ? JSON.stringify(payload) : data;
}

export function hydrateCompactedEventReferences(
  db: DbQueryConnection,
  refs: readonly HistoryReference[],
  maxInlineOutputChars: number | null = null,
): (typeof events.$inferSelect)[] {
  const selectedIds = [...new Set(refs.map((ref) => ref.completionId))];
  const owners = new Map<
    string,
    {
      owner: typeof events.$inferSelect;
      records: ReturnType<typeof decodeHistory>;
      payload: ReturnType<typeof parseHistoryPayload>;
    }
  >();
  for (let offset = 0; offset < selectedIds.length; offset += 250) {
    const rows = db
      .select({
        owner: {
          ...getTableColumns(events),
          data: sql<string>`json_remove(${events.data}, '$.item.aggregatedOutput', '$.item.result', '$.item.resultText', '$.item.truncation')`,
        },
        history: completedItemHistories,
      })
      .from(events)
      .innerJoin(
        completedItemHistories,
        eq(completedItemHistories.completionId, events.id),
      )
      .where(inArray(events.id, selectedIds.slice(offset, offset + 250)))
      .all();
    for (const row of rows) {
      if (
        row.owner.type !== "item/completed" ||
        row.history.threadId !== row.owner.threadId
      )
        throw new Error("Invalid completed item history ownership");
      const records = decodeHistory(row.history.data);
      const positions = [
        {
          id: row.history.startId,
          sequence: row.history.startSequence,
          type: "item/started",
        },
        {
          id: row.history.deltaId,
          sequence: row.history.deltaSequence,
          type: row.history.deltaType,
        },
        {
          id: row.history.secondDeltaId,
          sequence: row.history.secondDeltaSequence,
          type: row.history.secondDeltaType,
        },
      ].filter((position) => position.id !== null);
      if (
        positions.length !== records.length ||
        positions.some(
          (position) =>
            !records.some(
              (record) =>
                record.id === position.id &&
                record.sequence === position.sequence &&
                record.type === position.type,
            ),
        )
      )
        throw new Error("Invalid completed item history positions");
      owners.set(row.owner.id, {
        owner: row.owner,
        records,
        payload: parseHistoryPayload(row.owner.data),
      });
    }
  }
  return refs.map((ref) => {
    const cached = owners.get(ref.completionId);
    if (cached === undefined)
      throw new Error("Missing completed item history owner");
    const record = cached.records.find((entry) => entry.id === ref.id);
    if (
      record === undefined ||
      record.sequence !== ref.sequence ||
      record.type !== ref.type ||
      record.sequence >= cached.owner.sequence
    )
      throw new Error("Completed item history locator mismatch");
    return {
      ...cached.owner,
      id: record.id,
      sequence: record.sequence,
      createdAt: record.createdAt,
      type: record.type,
      itemKind: record.itemKind,
      data: truncateHistoryOutput(
        restoreHistoryPayload(record, cached.payload),
        maxInlineOutputChars,
      ),
    };
  });
}

export function listCompactedStoredRows(
  db: DbQueryConnection,
  args: HistorySelection,
  maxInlineOutputChars: number | null = null,
): StoredEventRow[] {
  return hydrateCompactedEventReferences(
    db,
    listCompactedEventReferences(db, args),
    maxInlineOutputChars,
  ).map(({ environmentId: _environmentId, ...row }) => row);
}

export function findCompactedEventById(
  db: DbQueryConnection,
  id: string,
): typeof events.$inferSelect | null {
  const row = db
    .select()
    .from(completedItemHistories)
    .where(
      or(
        eq(completedItemHistories.startId, id),
        eq(completedItemHistories.deltaId, id),
        eq(completedItemHistories.secondDeltaId, id),
      ),
    )
    .get();
  if (row === undefined) return null;
  const record = decodeHistory(row.data).find((entry) => entry.id === id);
  if (record === undefined)
    throw new Error("Completed item history identity mismatch");
  return (
    hydrateCompactedEventReferences(db, [
      {
        completionId: row.completionId,
        id,
        sequence: record.sequence,
        type: record.type,
      },
    ])[0] ?? null
  );
}

export function materializeCompactedHistory(
  db: DbQueryConnection,
  completionIds: readonly string[],
  beforeSequence = Number.MAX_SAFE_INTEGER,
): number {
  let suffixRows = 0;
  for (const completionId of completionIds) {
    const history = db
      .select()
      .from(completedItemHistories)
      .where(eq(completedItemHistories.completionId, completionId))
      .get();
    if (history === undefined) continue;
    const records = decodeHistory(history.data);
    const prefix = records.filter((record) => record.sequence < beforeSequence);
    const rows = hydrateCompactedEventReferences(
      db,
      prefix.map((record) => ({
        completionId,
        id: record.id,
        sequence: record.sequence,
        type: record.type,
      })),
    );
    for (const row of rows) db.insert(events).values(row).run();
    db.delete(completedItemHistories)
      .where(eq(completedItemHistories.completionId, completionId))
      .run();
    suffixRows += records.length - prefix.length;
  }
  return suffixRows;
}

export function restoreCompactedHistoryForLateItem(
  db: DbQueryConnection,
  args: {
    threadId: string;
    turnId: string | null;
    itemId: string | null;
    parentToolCallId: string | null;
    type: ThreadEventType;
  },
): void {
  if (
    args.itemId === null ||
    args.turnId === null ||
    ![
      "item/started",
      "item/completed",
      "item/agentMessage/delta",
      "item/commandExecution/outputDelta",
      "item/reasoning/textDelta",
      "item/reasoning/summaryTextDelta",
      "item/fileChange/outputDelta",
    ].includes(args.type)
  )
    return;
  const rows = db.all<{ completionId: string }>(sql`
    SELECT ${completedItemHistories.completionId} AS completionId
    FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
    INNER JOIN ${completedItemHistories} ON ${completedItemHistories.completionId} = ${events.id}
    WHERE ${events.threadId} = ${args.threadId} AND ${events.itemId} = ${args.itemId}
      AND ${events.turnId} = ${args.turnId} AND ${events.parentToolCallId} IS ${args.parentToolCallId}
      AND ${events.type} IN ('item/started', 'item/completed', 'item/backgroundTask/completed')
      AND ${events.type} = 'item/completed'
  `);
  materializeCompactedHistory(
    db,
    rows.map((row) => row.completionId),
  );
}
