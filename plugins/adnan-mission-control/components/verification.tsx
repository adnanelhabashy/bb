// Verification tab (Phase 4): the checklist lives on mission.values.verification
// (Phase 1 field, unchanged shape). This tab adds domain presets, a real
// evidence feed (bb-observed command executions), and a completion summary
// that separates "agent claims passed" from "user attached real evidence" —
// never the other way around.
import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { MissionValues, VerificationEvidence, rpcContract } from "../server";
import { useEvidence, useMission } from "@/lib/data";
import { Chip, EmptyState, SectionCard, relativeTime } from "@/components/common";

const VERIFICATION_PRESETS: Array<{ id: string; label: string; items: string[] }> = [
  { id: "code", label: "Code", items: ["Build", "Tests", "Lint", "Relevant regression test"] },
  { id: "kafka", label: "Kafka", items: ["Ordering behavior", "Retry behavior", "Idempotency", "Duplicate handling"] },
  { id: "web", label: "Web", items: ["Build", "Unit tests", "Browser test", "Console errors", "BFF/API calls"] },
];

type VerificationItem = MissionValues["verification"][number];

function StatusGlyph({ status }: { status: VerificationItem["status"] }) {
  if (status === "passed") return <span className="text-emerald-400">✅</span>;
  if (status === "failed") return <span className="text-red-400">❌</span>;
  if (status === "not-required") return <span className="text-muted-foreground">—</span>;
  return <span className="text-muted-foreground">⬜</span>;
}

function EvidencePicker({
  open,
  onOpenChange,
  evidence,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: VerificationEvidence[];
  onPick: (entry: VerificationEvidence) => void;
}) {
  const navigate = useBbNavigate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Attach evidence</DialogTitle>
        </DialogHeader>
        {evidence.length === 0 ? (
          <EmptyState title="No observed command executions yet.">
            Evidence appears here once a thread actually runs a command.
          </EmptyState>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {evidence.map((entry, index) => (
              <li key={`${entry.threadId}-${index}`}>
                <button
                  type="button"
                  onClick={() => onPick(entry)}
                  className="flex w-full items-start gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <span className={entry.exitCode === 0 ? "text-emerald-400" : "text-red-400"}>
                    {entry.exitCode === null ? "?" : entry.exitCode}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{entry.command}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {entry.threadTitle} · {relativeTime(entry.completedAt)} · {entry.itemStatus}
                    </span>
                  </span>
                  <span
                    role="link"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigate.toThread(entry.threadId);
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Open thread"
                  >
                    <Icon name="ArrowUpRight" className="size-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChecklistRow({
  item,
  evidence,
  onAttach,
  onClearEvidence,
}: {
  item: VerificationItem;
  evidence: VerificationEvidence[];
  onAttach: (label: string) => void;
  onClearEvidence: (label: string) => void;
}) {
  const navigate = useBbNavigate();
  const claimedWithoutEvidence = item.status === "passed" && (item.evidence ?? null) === null;
  return (
    <li className="space-y-1 border-b border-border/60 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className="inline-block w-4 text-center">
          <StatusGlyph status={item.status} />
        </span>
        <span className={item.status === "not-required" ? "text-sm text-muted-foreground line-through" : "text-sm"}>{item.label}</span>
        <span className="text-[10px] uppercase text-muted-foreground/70">{item.status}</span>
        {claimedWithoutEvidence ? (
          <span className="text-[10px] text-amber-400" title="Agent-reported pass with no attached evidence">
            ⚠ unverified
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onAttach(item.label)}>
            {item.evidence != null ? "Change evidence" : "Attach evidence"}
          </Button>
          {item.evidence != null ? (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onClearEvidence(item.label)}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {item.evidence != null ? (
        <button
          type="button"
          onClick={() => navigate.toThread(item.evidence!.threadId)}
          className="ml-6 flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-left text-[11px] hover:bg-accent"
        >
          <span className={item.evidence.exitCode === 0 ? "text-emerald-400" : "text-red-400"}>
            exit {item.evidence.exitCode ?? "?"}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{item.evidence.command}</span>
          <span className="shrink-0 text-muted-foreground/70">{item.evidence.threadTitle}</span>
        </button>
      ) : null}
    </li>
  );
}

export function VerificationPage() {
  const { state, setState } = useMission();
  const { evidence, isLoading: evidenceLoading, refresh: refreshEvidence } = useEvidence();
  const rpc = useRpc<typeof rpcContract>();
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const items = state?.values.verification ?? [];

  async function addPreset(preset: { items: string[] }) {
    const existingLabels = new Set(items.map((item) => item.label));
    const additions = preset.items.filter((label) => !existingLabels.has(label)).map((label) => ({ label, status: "pending" as const }));
    if (additions.length === 0) return;
    await setState({ verification: [...items, ...additions] });
  }

  async function attach(label: string, entry: VerificationEvidence) {
    await rpc.call("verification_attach_evidence", { label, evidence: entry });
    setPickerFor(null);
  }

  async function clearEvidence(label: string) {
    await rpc.call("verification_clear_evidence", { label });
  }

  const verified = items.filter((item) => item.status === "passed" && item.evidence != null);
  const claimedUnverified = items.filter((item) => item.status === "passed" && item.evidence == null);
  const failed = items.filter((item) => item.status === "failed");
  const pending = items.filter((item) => item.status === "pending");
  const risks = state?.values.concerns ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 p-4">
      <SectionCard
        title="Verification summary"
        actions={
          items.length > 0 ? (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {verified.length}/{items.length} verified
            </span>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState title="No verification checklist yet.">Add a preset below, or report one with the report_mission_state tool.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-400/80">Verified (evidence-backed)</p>
              <ul className="space-y-0.5 text-xs">
                {verified.length === 0 ? <li className="text-muted-foreground">—</li> : verified.map((item) => <li key={item.label}>✅ {item.label}</li>)}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-red-400/80">Not verified</p>
              <ul className="space-y-0.5 text-xs">
                {claimedUnverified.length === 0 && failed.length === 0 && pending.length === 0 ? (
                  <li className="text-muted-foreground">—</li>
                ) : (
                  <>
                    {failed.map((item) => (
                      <li key={item.label}>❌ {item.label}</li>
                    ))}
                    {claimedUnverified.map((item) => (
                      <li key={item.label} className="text-amber-400">
                        ⚠ {item.label} (claimed, no evidence)
                      </li>
                    ))}
                    {pending.map((item) => (
                      <li key={item.label}>⬜ {item.label}</li>
                    ))}
                  </>
                )}
              </ul>
            </div>
            {risks.length > 0 ? (
              <div className="sm:col-span-2">
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Known risks (reported concerns)</p>
                <div className="flex flex-wrap gap-1">
                  {risks.map((risk) => (
                    <Chip key={risk}>{risk}</Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground/70">
          "Verified" requires attached evidence from an actual observed command execution — an agent reporting "passed" alone lands in
          "Not verified" until evidence is attached.
        </p>
      </SectionCard>

      <SectionCard
        title="Checklist"
        actions={
          <div className="flex gap-1">
            {VERIFICATION_PRESETS.map((preset) => (
              <Button key={preset.id} variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void addPreset(preset)}>
                + {preset.label}
              </Button>
            ))}
          </div>
        }
      >
        {items.length === 0 ? (
          <EmptyState title="Nothing to check yet." />
        ) : (
          <ul>
            {items.map((item) => (
              <ChecklistRow
                key={item.label}
                item={item}
                evidence={evidence}
                onAttach={(label) => setPickerFor(label)}
                onClearEvidence={(label) => void clearEvidence(label)}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Observed command executions"
        provenance="bb-observed"
        actions={
          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => refreshEvidence()} disabled={evidenceLoading}>
            <Icon name="Repeat" className="mr-1 size-3" />
            Refresh
          </Button>
        }
      >
        {evidence.length === 0 ? (
          <EmptyState title="No observed command executions yet." />
        ) : (
          <ul className="space-y-1 text-xs">
            {evidence.slice(0, 10).map((entry, index) => (
              <li key={`${entry.threadId}-${index}`} className="flex items-center gap-2">
                <span className={entry.exitCode === 0 ? "text-emerald-400" : "text-red-400"}>{entry.exitCode ?? "?"}</span>
                <span className="min-w-0 flex-1 truncate font-mono">{entry.command}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{entry.threadTitle} · {relativeTime(entry.completedAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          Real command-execution events from recently active threads. This is the material available to attach as evidence — nothing here is
          matched to a checklist item automatically.
        </p>
      </SectionCard>

      <EvidencePicker
        open={pickerFor !== null}
        onOpenChange={(open) => !open && setPickerFor(null)}
        evidence={evidence}
        onPick={(entry) => {
          if (pickerFor !== null) void attach(pickerFor, entry);
        }}
      />
    </div>
  );
}
