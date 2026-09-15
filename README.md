# PR #3702 fork Save draft evidence

Reviewed real source-Chromium QA captures for the same supported journey: Fork into new thread, enter the shown prompt, then choose Save draft.

- `before-fork-save-draft-result.jpg`: baseline endpoint `054de3ae9c4d9551c845ada6549da5490af78988`; the fork incorrectly accepted the prompt, started Codex, and executed tool work.
- `after-fork-save-draft-queued.jpg`: repair `065b5bf3ed3799efe2c2531a031878a6e78cdd74`; the inactive fork holds exactly one queued Drafts message and has no accepted new provider turn.

The images are preserved on this evidence-only root commit. PR #3702's code head remains separate.
