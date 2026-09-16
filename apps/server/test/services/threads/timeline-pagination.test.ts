import { describe, expect, it } from "vitest";
import type {
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  paginateTimelineRows,
  type PaginateTimelineRowsArgs,
} from "../../../src/services/threads/timeline-pagination.js";

function userRow(args: {
  id: string;
  seq: number;
  text: string;
}): TimelineUserConversationRow {
  return {
    id: args.id,
    kind: "conversation",
    role: "user",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.seq,
    sourceSeqEnd: args.seq,
    startedAt: args.seq,
    createdAt: args.seq,
    text: args.text,
    mentions: [],
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function steerRow(args: {
  id: string;
  seq: number;
  text: string;
}): TimelineUserConversationRow {
  return {
    ...userRow(args),
    turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
  };
}

function assistantRow(seq: number): TimelineRow {
  return {
    id: `thread-1:assistant:${seq}`,
    kind: "conversation",
    role: "assistant",
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    text: `assistant ${seq}`,
    attachments: null,
    turnRequest: null,
  };
}

describe("paginateTimelineRows", () => {
  it("keeps grouped user rows from one request in the same segment", () => {
    const rows: TimelineRow[] = [
      userRow({
        id: "thread-1:user-seed:1",
        seq: 1,
        text: "older",
      }),
      userRow({
        id: "thread-1:user-seed:2",
        seq: 2,
        text: "group first",
      }),
      userRow({
        id: "thread-1:user-seed:2-1",
        seq: 2,
        text: "group second",
      }),
      userRow({
        id: "thread-1:user-seed:3",
        seq: 3,
        text: "newer",
      }),
    ];

    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 4,
      page: { kind: "latest", segmentLimit: 2 },
      segmentAnchorSequences: new Set([1, 2, 3]),
      rows,
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:user-seed:2",
      "thread-1:user-seed:2-1",
      "thread-1:user-seed:3",
    ]);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:user-seed:2",
      anchorSeq: 2,
    });
  });

  it("anchors a group at its message when rows recorded after the request display before it", () => {
    const providerEnvironment: TimelineRow = {
      id: "thread-1:op:provider-environment:15",
      kind: "system",
      threadId: "thread-1",
      turnId: null,
      sourceSeqStart: 15,
      sourceSeqEnd: 15,
      startedAt: 15,
      createdAt: 15,
      systemKind: "operation",
      operationKind: "generic",
      title: "Provider environment resolved",
      detail: null,
      status: "completed",
      completedAt: 15,
    };
    const rows: TimelineRow[] = [
      providerEnvironment,
      userRow({ id: "thread-1:user-seed:13", seq: 13, text: "follow-up" }),
      userRow({ id: "thread-1:user-seed:20", seq: 20, text: "newer" }),
    ];

    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 13,
      ownedSequenceEnd: 21,
      page: { kind: "latest", segmentLimit: 20 },
      segmentAnchorSequences: new Set([13, 20]),
      rows,
    });

    expect(page.rows.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(page.olderRowsSourceSeqEnd).toBeNull();
    expect(page.returnedSegmentCount).toBe(2);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:user-seed:13",
      anchorSeq: 13,
    });
  });

  it("reports the newest source sequence among context-only older groups", () => {
    const olderUser = userRow({
      id: "thread-1:user-seed:1",
      seq: 1,
      text: "older",
    });
    const lateOlderRow: TimelineRow = {
      ...userRow({ id: "thread-1:late-older-row", seq: 2, text: "late" }),
      sourceSeqEnd: 31,
      turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
    };
    const latestUser = userRow({
      id: "thread-1:user-seed:20",
      seq: 20,
      text: "latest",
    });

    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 20,
      ownedSequenceEnd: 32,
      page: { kind: "latest", segmentLimit: 20 },
      segmentAnchorSequences: new Set([1, 20]),
      rows: [olderUser, lateOlderRow, latestUser],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:20"]);
    expect(page.olderRowsSourceSeqEnd).toBe(31);
  });

  it("reports rows a content cut omitted from the oldest returned group", () => {
    const steer = (
      id: string,
      seq: number,
      sourceSeqEnd: number,
    ): TimelineRow => ({
      ...userRow({ id, seq, text: id }),
      sourceSeqEnd,
      turnRequest: { isGrouped: false, kind: "steer", status: "accepted" },
    });

    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: null,
      maxLeaves: 2,
      maxBytes: 1_000_000,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 31,
      page: { kind: "latest", segmentLimit: 20 },
      segmentAnchorSequences: new Set([1]),
      rows: [
        userRow({ id: "thread-1:user-seed:1", seq: 1, text: "prompt" }),
        steer("thread-1:running-item", 2, 30),
        steer("thread-1:item-3", 3, 3),
        steer("thread-1:item-4", 4, 4),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:item-3",
      "thread-1:item-4",
    ]);
    expect(page.contentPage).toMatchObject({ start: 2, total: 4 });
    expect(page.olderRowsSourceSeqEnd).toBe(30);
  });

  it("reports owned groups a budget cut left out of the page", () => {
    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: null,
      maxLeaves: 1,
      maxBytes: 1_000_000,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 21,
      page: { kind: "latest", segmentLimit: 20 },
      segmentAnchorSequences: new Set([1, 20]),
      rows: [
        {
          ...userRow({ id: "thread-1:user-seed:1", seq: 1, text: "older" }),
          sourceSeqEnd: 25,
        },
        userRow({ id: "thread-1:user-seed:20", seq: 20, text: "latest" }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:20"]);
    expect(page.olderRowsSourceSeqEnd).toBe(25);
  });

  it("keeps rows recorded before the first message as their own group", () => {
    const provisioning: TimelineRow = {
      id: "thread-1:op:thread-provisioning:1",
      kind: "system",
      threadId: "thread-1",
      turnId: null,
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      startedAt: 1,
      createdAt: 1,
      systemKind: "operation",
      operationKind: "generic",
      title: "Provisioned thread",
      detail: null,
      status: "completed",
      completedAt: 1,
    };

    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 0,
      ownedSequenceEnd: 4,
      page: { kind: "latest", segmentLimit: 1 },
      segmentAnchorSequences: new Set([3]),
      rows: [
        provisioning,
        userRow({ id: "thread-1:user-seed:3", seq: 3, text: "first" }),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual(["thread-1:user-seed:3"]);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:user-seed:3",
      anchorSeq: 3,
    });
  });
  it("renders a window whose only user rows steered into a running turn", () => {
    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: true,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 15,
      ownedSequenceEnd: 30,
      page: { kind: "latest", segmentLimit: 8 },
      segmentAnchorSequences: new Set(),
      rows: [
        assistantRow(10),
        steerRow({ id: "thread-1:user-seed:20", seq: 20, text: "steer" }),
        assistantRow(21),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:assistant:10",
      "thread-1:user-seed:20",
      "thread-1:assistant:21",
    ]);
    expect(page.returnedSegmentCount).toBe(1);
    expect(page.olderCursor).not.toBeNull();
  });

  it("anchors a segment on a sequence the window selection chose, whatever row shape it projects to", () => {
    const page = paginateTimelineRows({
      contextBoundarySeq: null,
      knownHasOlderSegments: null,
      maxLeaves: 1_000,
      maxBytes: 1_000_000,
      ownedSequenceStart: 1,
      ownedSequenceEnd: 30,
      page: { kind: "latest", segmentLimit: 1 },
      segmentAnchorSequences: new Set([20]),
      rows: [
        userRow({ id: "thread-1:user-seed:1", seq: 1, text: "first" }),
        assistantRow(20),
        assistantRow(21),
      ],
    });

    expect(page.rows.map((row) => row.id)).toEqual([
      "thread-1:assistant:20",
      "thread-1:assistant:21",
    ]);
    expect(page.olderCursor).toEqual({
      anchorId: "thread-1:assistant:20",
      anchorSeq: 20,
    });
  });

  it("never advertises older rows without a cursor to request them", () => {
    const cases: PaginateTimelineRowsArgs[] = [
      {
        contextBoundarySeq: null,
        knownHasOlderSegments: true,
        maxLeaves: 1_000,
        maxBytes: 1_000_000,
        ownedSequenceStart: 15,
        ownedSequenceEnd: 30,
        page: { kind: "latest", segmentLimit: 8 },
        segmentAnchorSequences: new Set(),
        rows: [
          assistantRow(10),
          steerRow({ id: "thread-1:user-seed:20", seq: 20, text: "steer" }),
        ],
      },
      {
        contextBoundarySeq: null,
        knownHasOlderSegments: true,
        maxLeaves: 1_000,
        maxBytes: 1_000_000,
        ownedSequenceStart: 100,
        ownedSequenceEnd: 200,
        page: { kind: "latest", segmentLimit: 8 },
        segmentAnchorSequences: new Set([5]),
        rows: [userRow({ id: "thread-1:user-seed:5", seq: 5, text: "old" })],
      },
      {
        contextBoundarySeq: null,
        knownHasOlderSegments: true,
        maxLeaves: 1_000,
        maxBytes: 1_000_000,
        ownedSequenceStart: 15,
        ownedSequenceEnd: 30,
        page: { kind: "latest", segmentLimit: 8 },
        segmentAnchorSequences: new Set([20]),
        rows: [],
      },
    ];

    for (const args of cases) {
      const page = paginateTimelineRows(args);
      expect(page.hasOlderRows).toBe(page.olderCursor !== null);
    }
  });
});
