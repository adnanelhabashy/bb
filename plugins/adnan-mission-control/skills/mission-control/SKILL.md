---
name: mission-control
description: "Report workflow state to the Adnan Mission Control dashboard. Use when the using-adnan-workflow classification, phase, approval scope, or verification expectations change — or when Adnan asks to update the mission state."
---

# Mission Control state reporting

The Mission Control plugin visualizes workflow state on its dashboard. It does
not read your mind: state only appears when reported. Report it with the
`report_mission_state` tool (preferred — structured, validated) or the
`bb mission-control set` CLI.

## When to report

- After classifying a task (intent / domain / concerns / risk).
- When the workflow phase changes (e.g. Investigation → Implementation).
- When the approval scope changes (what is allowed vs blocked this phase).
- When verification expectations change (which checks matter for this task).

Do NOT use reporting to claim verification passed. Verification evidence comes
from real runs, never from reports. Report expectations as `pending`.

## Verification evidence (Phase 4)

The Verification tab shows a checklist and a real evidence feed of observed
command executions across recent threads. Reporting a verification item as
`passed` only marks it "agent-reported" — it renders as **not verified**
until Adnan attaches an actual command-execution result as evidence from the
dashboard. Do not ask Adnan to "just mark it passed"; run the actual check
so it shows up as evidence he can attach.

## Tool fields (all optional — report only what you know)

- `task` — one-line description of the current task.
- `intent` — LEARN | INVESTIGATE | FIX | BUILD | DESIGN | REVIEW | VERIFY | OPERATE | RESEARCH | META.
- `domains` — e.g. ["Kafka", "PostgreSQL"]; `concerns` — e.g. ["ordering", "idempotency"].
- `risk` — "low" | "normal" | "high".
- `phase` — free text, e.g. "Investigation", "Implementation", "Verification".
- `activeSkills` — skill names relevant to the current work.
- `approvalScope` — `{ phase, allowed: [...], blocked: [...] }` for the current phase.
- `verification` — `[{ label, status: "pending" | "passed" | "failed" | "not-required" }]`.

## Provenance

Everything you report is labeled **agent-reported** in the UI, per field.
Adnan can override any field in the UI (**user-confirmed**). Treat the
reported scope as a visible contract with Adnan — if you exceed it, the
dashboard will show the divergence.

## Role resolution (Phase 2)

When you need an execution target for a conceptual role — choosing which
provider/model should handle PLAN, TASK, REVIEW, etc. — call
`resolve_mission_role` with the role name instead of hardcoding
provider/model pairs. It returns the configured `{ providerId, model,
reasoningLevel, serviceTier }` plus any catalog-issues for that mapping.
The lookup is read-only: it grants nothing and starts no threads. Actual
delegation still requires Adnan's approval.
