Adnan Mission Control — a personal engineering cockpit for BB.

## What you get (Phase 5)

- A **Mission Control** panel in the sidebar with five views:
  - **Overview** — workflow state (task, intent, domains, concerns, risk,
    phase, active skills, approval scope, verification expectations), each
    field labeled with its provenance: BB-observed, Agent-reported, or
    User-confirmed; plus live BB-observed counters and a per-provider
    capability probe.
  - **Agents** — the live thread hierarchy (parents and children) with
    status, provider, model/reasoning, token usage, context-window pressure,
    environment branch, pending approvals, and last meaningful action.
    Clicking a row opens the thread in BB's own UI.
  - **Roles** — the role router: map stable conceptual roles (PLAN, TASK,
    ADVISOR, ARCHITECT, DESIGNER, REVIEW, COMMIT, SLOW, SMOL, plus custom
    roles) to provider/model/reasoning tuples, edited through BB's own
    provider/model picker against the live catalog from `bb.sdk.providers`.
    Mappings that no longer resolve (unavailable provider, withdrawn model)
    render with a warning instead of failing.
  - **Approvals** — the fixed permission taxonomy (read, edit, execute,
    delegate, commit, push, merge, deploy, database write) for the current
    phase. Toggling a category is the only way it becomes approved; nothing
    is ever granted automatically, and new categories default to off.
  - **Verification** — the Verification Guardian: the checklist from
    mission state, one-click domain presets (Code / Kafka / Web), and a
    real bb-observed feed of command executions from recently active
    threads. An item only counts as verified once a user attaches one of
    those real executions as evidence; an agent reporting "passed" renders
    as "not verified" until then.
  - **Agents → Quick actions** — a per-thread action menu (the "⋯" on each
    row): open the thread in BB's own UI, steer it (interrupts an active
    turn), ask why / request review / request verification (queued
    messages), stop, or delegate to a configured role. Every action is a
    real BB call fired by that click alone; delegate additionally refuses
    to spawn anything until "Delegate" is turned on in Approvals.
- A `report_mission_state` agent tool and a `bb mission-control` CLI so
  agents can report workflow state after classifying a task. Reports are
  labeled agent-reported and never grant permissions.
- A read-only `resolve_mission_role` agent tool: resolve a role name to its
  configured provider/model/reasoning/service-tier so workflows can say
  "Delegate → REVIEW" without hardcoding provider and model. Resolving
  grants nothing and starts no threads.

## How it works

The plugin is mostly read-only observability over BB's public SDK plus
plugin-owned state stores (mission state, role mappings, approvals). The one
exception is Quick Actions: three calls (send/stop/spawn) that mutate a BB
thread, and only when a click in the panel fires them directly — no agent
tool reaches them, and delegate refuses to spawn until Approvals says so.
Role resolution itself stays lookup-only.

## For agents

The bundled `mission-control` skill tells agents when and how to report
state with the `report_mission_state` tool, and to never report verification
as passed — evidence comes from real runs, not reports. When an execution
target is needed for a conceptual role, call `resolve_mission_role` instead
of hardcoding provider/model pairs.
