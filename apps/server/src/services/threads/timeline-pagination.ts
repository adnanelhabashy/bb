import { paginateTimelineContents } from "./timeline-content-pagination.js";
import type { TimelineContentCursor } from "./timeline-snapshot.js";
import type {
  TimelinePaginationCursor,
  TimelineRow,
} from "@bb/server-contract";

export type ThreadTimelinePageKind = "latest" | "older";

interface LatestThreadTimelinePageRequest {
  kind: "latest";
  segmentLimit: number;
}

interface OlderThreadTimelinePageRequest {
  beforeCursor: TimelinePaginationCursor;
  kind: "older";
  segmentLimit: number;
}

export type ThreadTimelinePageRequest =
  | LatestThreadTimelinePageRequest
  | OlderThreadTimelinePageRequest;

interface TimelineLogicalSegment {
  rows: TimelineRow[];
  sequenceStart: number;
}

interface PaginatedTimelineRowsResult {
  contentCursor?: TimelineContentCursor;
  contentPage?: {
    anchorSeq: number;
    start: number;
    end: number;
    total: number;
  };
  hasOlderRows: boolean;
  olderCursor: TimelinePaginationCursor | null;
  olderRowsSourceSeqEnd: number | null;
  returnedSegmentCount: number;
  rows: TimelineRow[];
}

export interface PaginateTimelineRowsArgs {
  contentCursor?: TimelineContentCursor;
  maxLeaves: number;
  maxBytes: number;
  ownedSequenceStart: number;
  ownedSequenceEnd: number;
  knownHasOlderSegments: boolean | null;
  page: ThreadTimelinePageRequest;
  rows: readonly TimelineRow[];
  segmentAnchorSequences: readonly number[];
}

function timelineWindowCursor(
  sequenceStart: number,
): TimelinePaginationCursor {
  return {
    anchorSeq: sequenceStart,
    anchorId: `timeline-window:${sequenceStart}`,
  };
}

function buildTimelineLogicalSegments(
  args: PaginateTimelineRowsArgs,
): TimelineLogicalSegment[] {
  const { ownedSequenceStart, ownedSequenceEnd } = args;
  const bounds = [
    ownedSequenceStart,
    ...args.segmentAnchorSequences.filter(
      (sequence) =>
        sequence > ownedSequenceStart && sequence < ownedSequenceEnd,
    ),
  ];
  const segments = bounds.map(
    (sequenceStart): TimelineLogicalSegment => ({ rows: [], sequenceStart }),
  );
  for (const row of args.rows) {
    if (
      row.sourceSeqStart < ownedSequenceStart ||
      row.sourceSeqStart >= ownedSequenceEnd
    ) {
      continue;
    }
    let index = bounds.length - 1;
    while (index > 0 && bounds[index]! > row.sourceSeqStart) index -= 1;
    segments[index]!.rows.push(row);
  }
  return segments.filter((segment) => segment.rows.length > 0);
}

export function paginateTimelineRows(
  args: PaginateTimelineRowsArgs,
): PaginatedTimelineRowsResult {
  const { knownHasOlderSegments, page, rows } = args;
  const segments = buildTimelineLogicalSegments(args);
  const selectedSegments = segments.slice(-page.segmentLimit);
  const returnedRows = new Map<string, TimelineRow>();
  const collectRows = (): TimelineRow[] =>
    rows.flatMap((row) => {
      const returned = returnedRows.get(row.id);
      return returned === undefined ? [] : [returned];
    });
  const olderRowsSourceSeqEnd = (
    omittedContentSourceSeqEnd: number | null,
  ): number | null =>
    rows
      .filter(
        (row) =>
          row.sourceSeqStart < args.ownedSequenceEnd &&
          !returnedRows.has(row.id),
      )
      .reduce<number | null>(
        (sourceSeqEnd, row) => Math.max(sourceSeqEnd ?? 0, row.sourceSeqEnd),
        omittedContentSourceSeqEnd,
      );
  if (selectedSegments.length === 0) {
    const hasOlderRows = knownHasOlderSegments ?? false;
    return {
      hasOlderRows,
      olderCursor: hasOlderRows
        ? timelineWindowCursor(args.ownedSequenceStart)
        : null,
      olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(null),
      returnedSegmentCount: 0,
      rows: [],
    };
  }
  let remainingLeaves = args.maxLeaves;
  let remainingBytes = args.maxBytes;
  let returnedSegmentCount = 0;
  for (let index = selectedSegments.length - 1; index >= 0; index -= 1) {
    const segment = selectedSegments[index]!;
    const contents = paginateTimelineContents(
      segment.rows,
      args.contentCursor?.beforeLeaf,
      remainingLeaves,
      remainingBytes,
    );
    for (const row of contents.rows) returnedRows.set(row.id, row);
    returnedSegmentCount += 1;
    remainingLeaves -= contents.end - contents.start;
    remainingBytes -= Buffer.byteLength(JSON.stringify(contents.rows));
    if (contents.start > 0 || remainingLeaves <= 0 || remainingBytes <= 0) {
      const hasOlderRows =
        contents.start > 0 ||
        index > 0 ||
        (knownHasOlderSegments ?? segments.length > selectedSegments.length);
      return {
        rows: collectRows(),
        returnedSegmentCount,
        hasOlderRows,
        olderCursor: hasOlderRows
          ? timelineWindowCursor(segment.sequenceStart)
          : null,
        olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(
          contents.olderRowsSourceSeqEnd,
        ),
        contentCursor:
          contents.start > 0
            ? {
                beforeLeaf: contents.start,
                beforeSequence:
                  selectedSegments[index + 1]?.sequenceStart ??
                  args.ownedSequenceEnd,
              }
            : undefined,
        contentPage: {
          anchorSeq: segment.sequenceStart,
          start: contents.start,
          end: contents.end,
          total: contents.total,
        },
      };
    }
  }
  const hasOlderRows =
    knownHasOlderSegments ?? segments.length > selectedSegments.length;
  return {
    rows: collectRows(),
    returnedSegmentCount,
    hasOlderRows,
    olderCursor: hasOlderRows
      ? timelineWindowCursor(selectedSegments[0]!.sequenceStart)
      : null,
    olderRowsSourceSeqEnd: olderRowsSourceSeqEnd(null),
  };
}
