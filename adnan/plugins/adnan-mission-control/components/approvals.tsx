// Approvals tab (Phase 3): the fixed permission taxonomy for the current
// phase. Toggling a category here IS the approval — nothing is granted
// automatically, and this is separate from the freeform approvalScope
// allowed/blocked text an agent reports on the Overview tab.
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, SectionCard, relativeTime } from "@/components/common";
import { useApprovals, useMission } from "@/lib/data";

export function ApprovalsPage() {
  const { data, isLoading, error, setApproved } = useApprovals();
  const { state: mission } = useMission();

  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4">
        <EmptyState title="Approval Center unavailable">{error}</EmptyState>
      </div>
    );
  }
  if (data === null || isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading approvals…</div>;
  }

  const phase = mission?.values.approvalScope?.phase ?? mission?.values.phase ?? null;
  const approvedCount = data.categories.filter((category) => data.state.approvals[category.id] === true).length;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
      <SectionCard
        title="Approval Center"
        actions={
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {approvedCount}/{data.categories.length} approved
          </span>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {phase !== null ? (
            <>
              Current phase: <span className="font-medium text-foreground">{phase}</span>.{" "}
            </>
          ) : null}
          Nothing here is granted automatically. Turn a category on only when you mean to allow it right now.
        </p>
        <ul className="divide-y divide-border/60">
          {data.categories.map((category) => {
            const approved = data.state.approvals[category.id] === true;
            return (
              <li key={category.id} className="flex items-center justify-between gap-3 py-2">
                <label htmlFor={`approval-${category.id}`} className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className={approved ? "text-emerald-400" : "text-muted-foreground"}>
                    {approved ? "✓" : "✗"}
                  </span>
                  {category.label}
                </label>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-wide ${approved ? "text-emerald-400" : "text-muted-foreground"}`}
                  >
                    {approved ? "Approved" : "Not approved"}
                  </span>
                  <Checkbox
                    id={`approval-${category.id}`}
                    checked={approved}
                    onCheckedChange={(checked) => void setApproved(category.id, checked === true)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[10px] text-muted-foreground/70">
          Updated {data.state.updatedAt === 0 ? "never" : relativeTime(data.state.updatedAt)} by {data.state.updatedBy}.
          New categories added later default to not approved.
        </p>
      </SectionCard>
    </div>
  );
}
