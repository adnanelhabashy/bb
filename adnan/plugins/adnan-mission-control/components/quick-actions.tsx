// Quick Actions (Phase 5): per-thread controls reachable from the Agents
// tree. Every action here is a real BB mutation (send/stop/spawn), fired
// only by a deliberate click inside this dialog — never automatic, never
// batched into a swarm. Delegate additionally requires the "Delegate"
// category to already be turned on in the Approval Center; the dialog
// enforces nothing itself, it just reflects what the server will refuse.
import { useState } from "react";
import { toast } from "sonner";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { EnrichedThread } from "../server";
import { useApprovals, useRoles, useThreadActions } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CANNED = {
  askWhy: "Before you continue: explain your current plan and why you're taking this approach.",
  requestReview: "Pause and prepare your change for review — summarize what you changed and why, then wait.",
  requestVerification: "Run this task's verification checklist now (build/tests/lint as applicable) and report real evidence — not a claim.",
} as const;

const TEXTAREA_CLASS = cn(
  "w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs",
  "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
);

export function ThreadQuickActions({ thread }: { thread: EnrichedThread }) {
  const [open, setOpen] = useState(false);
  const [steerText, setSteerText] = useState("");
  const [delegateRoleId, setDelegateRoleId] = useState("");
  const [delegatePrompt, setDelegatePrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useBbNavigate();
  const actions = useThreadActions();
  const { data: approvals } = useApprovals();
  const { data: roles } = useRoles();

  const delegateApproved = approvals?.state.approvals.delegate === true;
  const assignedRoles = (roles?.state.roles ?? []).filter((role) => role.providerId !== null);

  async function run(label: string, fn: () => Promise<void>, successMessage: string) {
    setBusy(label);
    try {
      await fn();
      toast.success(successMessage);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        title="Quick actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
      >
        ⋯
      </button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{thread.title}</DialogTitle>
          <DialogDescription>Quick actions act on this thread directly. Nothing here is automatic.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              navigate.toThread(thread.id);
              setOpen(false);
            }}
          >
            Open thread
          </Button>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Steer (interrupts if active)</label>
            <textarea
              value={steerText}
              onChange={(event) => setSteerText(event.target.value)}
              placeholder="Redirect the agent right now…"
              rows={2}
              className={TEXTAREA_CLASS}
            />
            <Button
              size="sm"
              disabled={steerText.trim() === "" || busy !== null}
              onClick={() =>
                run(
                  "steer",
                  async () => {
                    await actions.send(thread.id, steerText.trim(), "steer-if-active");
                    setSteerText("");
                  },
                  "Steered.",
                )
              }
            >
              {busy === "steer" ? "Sending…" : "Send"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => run("askWhy", () => actions.send(thread.id, CANNED.askWhy, "queue-if-active"), "Asked why.")}
            >
              {busy === "askWhy" ? "Asking…" : "Ask why"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run("requestReview", () => actions.send(thread.id, CANNED.requestReview, "queue-if-active"), "Review requested.")
              }
            >
              {busy === "requestReview" ? "Requesting…" : "Request review"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "requestVerification",
                  () => actions.send(thread.id, CANNED.requestVerification, "queue-if-active"),
                  "Verification requested.",
                )
              }
            >
              {busy === "requestVerification" ? "Requesting…" : "Request verification"}
            </Button>
          </div>

          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            disabled={busy !== null}
            onClick={() => run("stop", () => actions.stop(thread.id), "Stopped.")}
          >
            {busy === "stop" ? "Stopping…" : "Stop"}
          </Button>

          <div className="space-y-1.5 border-t border-border pt-3">
            <label className="text-xs font-medium text-muted-foreground">Delegate (spawns a child thread)</label>
            {!delegateApproved ? (
              <p className="text-xs text-amber-500">
                "Delegate" is not approved. Turn it on in the Approvals tab first — nothing spawns without it.
              </p>
            ) : assignedRoles.length === 0 ? (
              <p className="text-xs text-muted-foreground">No roles have a provider/model assigned yet. Configure one in Roles.</p>
            ) : (
              <>
                <select
                  value={delegateRoleId}
                  onChange={(event) => setDelegateRoleId(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                >
                  <option value="">Choose a role…</option>
                  {assignedRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label} — {role.providerId}/{role.model ?? "?"}
                    </option>
                  ))}
                </select>
                <textarea
                  value={delegatePrompt}
                  onChange={(event) => setDelegatePrompt(event.target.value)}
                  placeholder="What should the delegate do?"
                  rows={2}
                  className={TEXTAREA_CLASS}
                />
                <Button
                  size="sm"
                  disabled={delegateRoleId === "" || delegatePrompt.trim() === "" || busy !== null}
                  onClick={() =>
                    run(
                      "delegate",
                      async () => {
                        await actions.delegate(thread.id, delegateRoleId, delegatePrompt.trim());
                        setDelegatePrompt("");
                        setDelegateRoleId("");
                      },
                      "Delegated.",
                    )
                  }
                >
                  {busy === "delegate" ? "Delegating…" : "Delegate"}
                </Button>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
