import { expect, it } from "vitest";
import {
  compactHistoryPayload,
  decodeHistory,
  encodeHistory,
  parseHistoryPayload,
  restoreHistoryPayload,
} from "../../src/completed-item-history.js";

it("preserves missing fields, nulls, arrays and start-only fields independently of retained output", () => {
  const owner = parseHistoryPayload(
    JSON.stringify({
      providerThreadId: "session",
      metadata: [null, false],
      item: {
        id: "item",
        type: "fileChange",
        changes: [{ path: "file", diff: "x".repeat(8192) }],
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "mutable output",
        truncation: { originalChars: 50000 },
      },
    }),
  );
  if (
    owner.item === null ||
    typeof owner.item !== "object" ||
    Array.isArray(owner.item)
  )
    throw new Error("Missing fixture item");
  for (const optional of [
    {},
    { optional: null },
    { optional: [] },
    { optional: false },
    { optional: { nested: [null, 1, ""] } },
  ]) {
    const before = {
      ...owner,
      ...optional,
      item: {
        ...owner.item,
        status: "pending",
        approvalStatus: null,
        startOnly: [],
        aggregatedOutput: "original start output",
        truncation: null,
      },
    };
    const record = {
      id: "evt-start",
      sequence: 1,
      createdAt: 123,
      type: "item/started" as const,
      itemKind: "fileChange" as const,
      ...compactHistoryPayload(
        parseHistoryPayload(JSON.stringify(before)),
        owner,
      ),
    };
    const restoredRecord = decodeHistory(encodeHistory([record]))[0]!;
    expect(JSON.parse(restoreHistoryPayload(restoredRecord, owner))).toEqual(
      before,
    );
    const expired = parseHistoryPayload(JSON.stringify(owner));
    if (
      expired.item === null ||
      typeof expired.item !== "object" ||
      Array.isArray(expired.item)
    )
      throw new Error("Missing fixture item");
    delete expired.item.aggregatedOutput;
    delete expired.item.truncation;
    expect(JSON.parse(restoreHistoryPayload(restoredRecord, expired))).toEqual(
      before,
    );
  }
});

it("preserves assistant and both reasoning delta texts, while command markers have no output reference", () => {
  const owner = parseHistoryPayload(
    '{"providerThreadId":"session","item":{"id":"item","aggregatedOutput":"output"}}',
  );
  const types = [
    "item/agentMessage/delta",
    "item/reasoning/textDelta",
    "item/reasoning/summaryTextDelta",
    "item/commandExecution/outputDelta",
  ] as const;
  for (const type of types) {
    const data = {
      providerThreadId: "session",
      itemId: "item",
      delta:
        type === "item/commandExecution/outputDelta" ? "" : "original text 🐈",
      metadata: [null, { index: 7 }],
    };
    const record = {
      id: "evt-delta",
      sequence: 2,
      createdAt: 125,
      type,
      itemKind: null,
      ...compactHistoryPayload(data, owner),
    };
    const restored = decodeHistory(encodeHistory([record]))[0]!;
    expect(
      JSON.parse(
        restoreHistoryPayload(restored, { ...owner, item: { id: "item" } }),
      ),
    ).toEqual(data);
  }
});

it("rejects corrupt versions, record shapes, and references to mutable output", () => {
  for (const data of [
    "null",
    "{}",
    "[2,[]]",
    "[1,[]]",
    '[1,[["id",1,1,"item/started","fileChange",[{},[],["aggregatedOutput"]]]]]',
    '[1,[["id",1,1,"item/started","fileChange",[{},["item"],[]]]]]',
  ]) {
    expect(() => decodeHistory(data)).toThrow();
  }
});
