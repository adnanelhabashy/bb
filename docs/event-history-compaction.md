# Completed item history

BB compacts settled commands, file changes, assistant messages, and reasoning.
The completion event keeps its original ID, sequence, timestamp, payload, and
retained-output ownership. Required start and delta information moves into one
completion-owned `completed_item_histories` row. Unresolved, ambiguous, malformed,
late, unsupported, or over-budget histories remain ordinary events.

History readers select logical positions before applying page limits, then
reconstruct the selected records. Raw SDK events and `bb thread log --json` keep
event identities, order, times, and payload shapes. Assistant and reasoning text
remaining after existing retention is preserved losslessly.

## Command delta retention

An eligible settled command delta reconstructs with `delta: ""`. Its ID, position,
timestamp, envelope, and other fields remain. Text is discarded only when the
delta precedes a unique matching completion and later turn settlement, the command
status is completed/failed/interrupted, the completion has nonempty string
`aggregatedOutput`, and either a matching start precedes completion or the entire
delta text occurs in that output. Completion output retention is unchanged.

This text removal is irreversible. Raw history, exports, and a fork ending before
the completion cannot recover discarded command delta text. A timing marker never
refers to the retained-output sidecar, so output truncation or expiry cannot alter
its reconstruction. Starts and assistant/reasoning deltas likewise remain
independent of mutable completion output fields.

## Lookup and storage

Random event IDs and arbitrary sequence pages cannot be located through the
completion's existing item/turn indexes alone. The history table explicitly
indexes its start and two possible retained-delta positions. The two delta
positions support reasoning text and summary separately; PR1 keeps the first
delta of each supported type. Histories with additional unpruned deltas remain
ordinary until existing pruning resolves them.

The history table has eight locator indexes plus its completion primary key.
No events index is added or removed. Its rows and indexes count toward storage
cost: compacting a start alone does not reduce total table rows, while combining
a start and delta does. The versioned payload shares only explicitly named equal
fields with the completion. It preserves missing fields, nulls, arrays, and
start-only values without a general recursive patch format.

Item and parent lookups use the existing scoped events indexes to find completion
owners. Sequence and ID lookups use the history indexes. Selected owners are read
in batches, without fetching mutable command output to reconstruct earlier history.

## Mutation and maintenance

Copy/fork reads the logical prefix, including records whose completion falls
outside it, and retains existing new-ID and sequence allocation behavior. Rewind
restores the retained prefix before deleting an owner, in the same transaction.
Late item arrivals first materialize the compacted lifecycle. Existing PR1 delta
pruning can then see the original first-delta evidence. None of these operations
resurrect discarded command text.

The existing pruning worker rotates a completed-items policy alongside PR1's
policies. Active ingestion performs one small scoped advance. Historical work
uses the existing idle maintenance sweep. Candidate/support and payload budgets
limit work; they are not hard synchronous latency guarantees. Compaction and
cursor progress commit together, and committed rewrites invalidate caches and
notify readers. Completion IDs never become sequence allocators or bookmarks.

Attachment ownership remains per thread. Compaction does not release or reacquire
attachment ownership, move search-segment ownership, or duplicate retained output.
History ownership cascades when its completion or thread is deleted. Deletion
makes database pages reusable; it does not imply file shrinkage or run a full
VACUUM.
