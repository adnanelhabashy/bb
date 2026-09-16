# Completed item compaction verification

The implementation starts from PR1 squash `c663ff1911`. Verification used private,
sanitized copies containing 2,082,639 events in 2,326 threads. Current migrations
and the four merged PR1 policies were applied before comparison; PR1 removed no
additional events. No app/server ran against these copies.

## Lookup design gate

A completion-only JSON scan on a 140,404-event thread took 1,224,500 SQLite VM
instructions to recover an arbitrary removed ID. Indexed locators used fewer
than 100 instructions in the same prototype. Arbitrary sequence pages likewise
need keys independent of a completion's later sequence.

On the same 935,721-record opportunity cohort, per-record locators required
935,721 rows and 190,418,944 locator table/index bytes. Per-completion locators
required 731,463 rows and 138,141,696 locator-only bytes; both alternatives also
needed the same 151,680,207 payload bytes. Reference stubs left every events row
and cost 511,057,920 bytes with the existing events indexes. The selected format
puts payload and locators together in one completion-owned auxiliary row.

Final production queries were captured and replayed with `EXPLAIN QUERY PLAN`
and SQLite's VM progress counter. On the largest real thread, the captured page
and identity queries returned at most 20 rows and used at most 1,671 VM
instructions. Scoped queries use existing item/turn/parent indexes. No events
index was added or removed. Scoped-owner joins enforce scope-first lookup; tests
check the emitted turn/item/parent query plans. Nested boundary queries inspect
virtual positions only when their owner completes beyond the window.

## Correctness

- Every logical field of all 2,082,639 events matched, except 119,802 authorized
  command deltas reconstructed with empty text. Original completion payloads,
  identities, timestamps, and every thread highwater matched.
- Every returned full timeline field matched for all 2,326 threads, including
  nested details, todos, active state and context usage (2,223 non-null context
  indicators). The actual paginated server response also matched for every
  thread, including its page metadata and cursors.
- Another 2,640 production page checks and 4,169 typed/identity/cursor checks
  passed on the five largest threads. Migrated adversarial tests cover every
  boundary, both directions, six event types, three limits, nested/reused IDs,
  distant owners and both reasoning delta types.
- All 48 existing tables other than events and pruning cursors matched exactly,
  including retained outputs, search/FTS and attachment ownership tables.
  The source attachment tables were empty; a separate real-upload server test
  checks ownership through compaction, rewind, fork and final reclamation.
- Production output migration and expiry leave compacted history unchanged.
  Fixtures cover guarded command text, late arrivals, rollback, contention,
  copy, prefix materialization and thread deletion.

Fresh dev-app verification exercised expanded command output, edit diffs, history
pagination, a prefix fork, the copied-message editor, and browser reload after a
production suffix-rewind transaction. This proves fixture rendering and storage
behavior. Real provider checkpoint replay remains unverified: the synthetic
session has no disposable real provider checkpoint and provider startup rejects
its synthetic identity.

## Storage

| Measurement                     |        Before |         After |
| ------------------------------- | ------------: | ------------: |
| Physical events                 |     2,082,639 |     1,079,954 |
| Completion histories            |             0 |       794,185 |
| All table rows                  |     2,571,184 |     2,362,686 |
| Allocated SQLite b-tree bytes   | 5,634,543,616 | 4,505,096,192 |
| Auxiliary table and all indexes |             0 |   324,521,984 |
| Reusable free-page bytes        |   364,851,200 | 1,494,298,624 |
| Database file bytes             | 6,006,726,656 | 6,006,726,656 |
| WAL bytes after closing         |             0 |             0 |

The actual worker removes 1,002,685 event rows. Auxiliary histories offset
794,185 of those rows, and its global cursor and migration ledger add two, leaving 208,498 fewer
rows across all tables. Net allocated storage falls by 1,129,447,424 bytes
(20.0%). These are reusable pages, not file shrinkage. No VACUUM was run.

Backfill processed 2,912,588,887 payload bytes across 27,425 advances. Exclusions
are finite and counted: unsettled commands/reasoning/assistant messages,
ambiguous starts/completions, one incompatible assistant envelope, one late
command event, one command support-budget case, and 59 oversized payload cases
(56 file changes and three commands). Unsupported item kinds remain unchanged.
Standalone start-only compaction saves payload/index space but does not reduce
total table rows; starts combined with deltas supply the row-count reduction.

The storage baseline excludes PR2's empty schema and its migration ledger row;
correctness comparisons use the same migrated schema on both copies. Encoded
history metadata totals 164,803,752 bytes, with a maximum row of 3,453 bytes.
All 2,133 retained-output sidecars and their 223,983,888 UTF-8 value bytes are
unchanged. A fully visited live workload also adds the fifth per-thread cursor:
the measured cursor table/index footprint was 1,449,984 bytes for PR1 and
1,855,488 bytes for PR2, including each run's existing delta-probe rows.

Compacted starts cover all four kinds: 355,823 commands, 31,356 file changes,
324,124 reasoning items and 75,911 assistant messages. Starts without a matching
completion remain physical: 313 commands, 385 reasoning items and 75 assistant
messages. Missing-start command guards and failed/interrupted statuses are
covered by migrated fixtures.

## Responsiveness and catch-up

The complete production live wrapper includes policy selection, transaction,
rewrite notification and a queued event-loop heartbeat. Each row below contains
37,216 calls over sixteen passes on identical private inputs. Preparation,
profiling and tests had stopped before the timing run.

| Scenario      | p50 ms | p95 ms | p99 ms | Max ms | Total run ms |
| ------------- | -----: | -----: | -----: | -----: | -----------: |
| Fresh / PR1   |  0.256 |  3.315 |  7.647 | 18.688 |       31,059 |
| Fresh / PR2   |  0.310 |  4.040 |  9.147 | 16.830 |       39,910 |
| Cleaned / PR1 |  0.254 |  0.699 |  1.587 |  7.816 |       14,662 |
| Cleaned / PR2 |  0.284 |  1.057 |  1.822 |  8.339 |       17,578 |

Across 148,864 calls there were zero failures and zero calls above 50 ms. Maximum
heartbeat delay was 18.703 ms for PR1 and 16.845 ms for PR2. Fresh PR2 calls
removed 25,468 events, scanned 338,542 candidate/support rows and decoded
99,348,385 payload bytes; an untimed replay matched every call's policy,
highwater, scans and removals. Fresh PR1 removed zero rows and scanned 206,903.
All cleaned PR2 calls removed zero rows. Lower maximum latency does not mean
lower total work: the extra policy increases total time and some percentiles.

The actual unchanged idle scheduler completed the full backfill in 137,119
advances across 9,203 ticks, including 1,840 deliberately busy skips. Execution
took 431,884 ms. With ten-second waits accelerated and one in five ticks busy,
that trace represents 25.56 scheduled hours. This is a trace-derived simulation,
not a wall-clock overnight run or a row-count/batch-size estimate. The other
policies continue rotating throughout catch-up and their cost is included.
Twenty-four ticks contained an advance above 50 ms; the maximum background
advance was 200.563 ms. Time checks between synchronous SQLite advances are not
hard per-advance latency caps.

A real scoped-reader regression found during integration is covered by emitted
query-plan tests. The final largest-five latest-page builds take 73–298 ms on
compacted data, versus 74–460 ms on uncompacted data using the same final readers.
These are server-build measurements, separate from the complete maintenance
wrapper measurements.

## Final main integration

The final branch rebases onto `b1e83d58f3`, which contains PR1 `c663ff1911`.
Main's intervening provider-identity migration is independent of compaction;
PR2 adds no events index. Its regenerated `0126_round_clea` migration is byte-for-
byte identical to the DDL tested before renumbering. Fresh migrated tests cover
the final migration sequence. Additional private copies apply main's new index
and reconcile only the research copy's PR2 migration timestamp before checking
current provider recovery and timeline responses.

Full paginated comparisons use a shared fixed timestamp because retained-output
availability expires with wall-clock time. A long-running audit crossed eight
sidecar expiration timestamps in four threads; comparing both copies at the
same timestamp removes that unrelated source of difference. Output expiry is
also tested directly against compacted history.
