// Usage & Limits tab: one capacity dashboard over every configured source —
// direct providers (the same bb.sdk.system.usageLimits contract the thread
// popup renders) and Account Pooler accounts (their own honest group).
// Remaining quota leads; nothing is estimated, missing values render as n/a.
import { useEffect, useState, type ReactNode } from "react";
import type { UsageDashboard, UsageEntry, UsageWindow } from "../server";
import { useUsageDashboard } from "@/lib/data";
import { useProvidersList, ProviderMark } from "@/lib/bb";
import { Chip, EmptyState, relativeTime } from "@/components/common";
import { cn } from "@/lib/utils";

export type UsageTone = "ok" | "warn" | "danger" | "na";
type FilledTone = Exclude<UsageTone, "na">;

/** Tone for a window that reports a percentage. Callers with a possibly-null
 *  percentage must branch on null first; n/a windows never reach the tone
 *  maps, so the maps only name real states. */
function filledTone(usedPercent: number): FilledTone {
  const remaining = 100 - usedPercent;
  if (remaining < 20) return "danger";
  if (remaining <= 50) return "warn";
  return "ok";
}

const TONE_TEXT: Record<FilledTone, string> = {
  ok: "text-emerald-400/90",
  warn: "text-amber-400",
  danger: "text-red-400",
};

const TONE_BAR: Record<FilledTone, string> = {
  ok: "bg-emerald-400/80",
  warn: "bg-amber-400",
  danger: "bg-red-400",
};

function stateChip(entry: UsageEntry): { label: string; className: string } | null {
  switch (entry.state.kind) {
    case "ready":
      return null;
    case "loading":
      return { label: "Loading", className: "text-muted-foreground" };
    case "unauthenticated":
      return { label: "Not signed in", className: "text-amber-400" };
    case "not_installed":
      return { label: "Not installed", className: "text-amber-400" };
    case "expired":
      return { label: "Sign-in expired", className: "text-amber-400" };
    case "error":
      return { label: "Error", className: "text-red-400" };
    case "not_exposed":
      return { label: "Not exposed", className: "text-muted-foreground" };
  }
}

function WindowRow({ window, now }: { window: UsageWindow; now: number }) {
  const percent = window.usedPercent;
  const used = percent === null ? null : Math.round(percent);
  const left = used === null ? null : Math.max(0, 100 - used);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px] tabular-nums">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="truncate">{window.label}</span>
          {window.scope !== null ? (
            <span className="shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">
              {window.scope}
            </span>
          ) : null}
          {window.status === "blocked" || window.status === "warning" ? (
            <span className="shrink-0 text-[10px] text-amber-400">{window.status}</span>
          ) : null}
        </span>
        {percent === null || used === null || left === null ? (
          <span className="shrink-0 text-muted-foreground">n/a</span>
        ) : (
          <span className="flex shrink-0 items-baseline gap-2">
            <span className={cn("font-medium", TONE_TEXT[filledTone(percent)])}>{used}% used</span>
            <span className="w-12 text-right text-muted-foreground">{left}% left</span>
          </span>
        )}
      </div>
      {percent !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full", TONE_BAR[filledTone(percent)])}
            style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
          />
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
        <span>{window.resetsAt === null ? "reset n/a" : `resets ${relativeTime(window.resetsAt, now)}`}</span>
        {window.cost !== null ? (
          <span>
            ${(window.cost.usedUsdCents / 100).toFixed(2)} of ${(window.cost.limitUsdCents / 100).toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function bodyFor(entry: UsageEntry, now: number): ReactNode {
  if (entry.state.kind === "ready") {
    if (entry.windows.length === 0) {
      return <span className="text-[11px] text-muted-foreground">No limit windows reported</span>;
    }
    return (
      <div className="flex flex-col gap-2">
        {entry.windows.map((window, index) => (
          <WindowRow key={`${window.label}:${index}`} window={window} now={now} />
        ))}
      </div>
    );
  }
  if (entry.state.kind === "error") {
    return <span className="text-[11px] text-red-400">{entry.state.message}</span>;
  }
  if (entry.state.kind === "not_exposed") {
    return <span className="text-[11px] text-muted-foreground">Not exposed by provider</span>;
  }
  const chip = stateChip(entry);
  return <span className="text-[11px] text-muted-foreground">{chip?.label ?? entry.state.kind}</span>;
}

function UsageCard({ entry, now }: { entry: UsageEntry; now: number }) {
  const providers = useProvidersList();
  const chip = stateChip(entry);
  const worstTone: UsageTone = entry.windows.reduce((worst: UsageTone, window) => {
    if (window.usedPercent === null) return worst;
    const tone = filledTone(window.usedPercent);
    if (tone === "danger") return "danger";
    if (tone === "warn" && worst !== "danger") return "warn";
    if (tone === "ok" && worst === "na") return "ok";
    return worst;
  }, "na");
  const attention = worstTone === "danger" ? "border-red-400/40" : worstTone === "warn" ? "border-amber-400/40" : "border-border";
  const body = bodyFor(entry, now);
  return (
    <article className={cn("flex flex-col gap-2 rounded-lg border bg-card p-3", attention)}>
      <div className="flex min-w-0 items-center gap-2">
        <ProviderMark providerId={entry.providerId} providers={providers} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium">{entry.providerLabel}</span>
        {entry.source === "pool" ? (
          <Chip>
            <span className="size-1 rounded-full bg-amber-400/80" />
            pooled
          </Chip>
        ) : null}
        {chip !== null ? <span className={cn("ml-auto shrink-0 text-[10px]", chip.className)}>{chip.label}</span> : null}
      </div>
      {entry.accountLabel !== null || entry.planLabel !== null || entry.modelLabel !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {entry.planLabel !== null ? <span className="shrink-0">{entry.planLabel}</span> : null}
          {entry.accountLabel !== null ? <span className="truncate">{entry.accountLabel}</span> : null}
          {entry.modelLabel !== null ? <span className="shrink-0">model: {entry.modelLabel}</span> : null}
        </div>
      ) : null}
      <div>{body}</div>
      {entry.state.kind === "ready" && entry.state.updatedAt !== null ? (
        <span className="text-right text-[10px] tabular-nums text-muted-foreground/70">
          updated {relativeTime(entry.state.updatedAt, now)}
        </span>
      ) : null}
    </article>
  );
}

function EntryGroup({ title, entries, now, empty }: { title: string; entries: UsageEntry[]; now: number; empty: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {entries.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry, index) => (
            <UsageCard key={`${entry.source}:${entry.providerId}:${entry.accountLabel ?? index}`} entry={entry} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

export function UsageLimitsPage() {
  const { data, isLoading, isFetching, error, refresh } = useUsageDashboard();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading && data === null) {
    return (
      <div className="p-4">
        <EmptyState title="Loading usage & limits…" />
      </div>
    );
  }
  if (error !== null && data === null) {
    return (
      <div className="p-4">
        <EmptyState title="Usage & Limits could not be loaded.">
          <p className="text-[12px] text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-2 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent/60"
          >
            Retry
          </button>
        </EmptyState>
      </div>
    );
  }
  const dashboard: UsageDashboard | null = data;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Usage & Limits</h2>
          {dashboard !== null ? (
            <p className="text-[11px] tabular-nums text-muted-foreground">
              updated {relativeTime(dashboard.generatedAt, now)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh usage and limits"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={cn("size-3.5", isFetching && "animate-spin")}
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>
      {dashboard !== null ? (
        <>
          <EntryGroup title="Direct Providers" entries={dashboard.direct} now={now} empty="No usage-capable providers configured." />
          {dashboard.poolAvailable ? (
            <EntryGroup title="Pooled Accounts" entries={dashboard.pool} now={now} empty="Account Pooler has no accounts yet." />
          ) : (
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pooled Accounts</h3>
              <EmptyState title="Account Pooler is not available.">
                <p className="text-[12px] text-muted-foreground">
                  Enable the account-pool plugin to see pooled subscription accounts here.
                </p>
              </EmptyState>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
