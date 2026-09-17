import { useEffect, useState, type ReactNode } from "react";
import type { ProviderInfo } from "@bb/domain";
import type {
  ProviderUsage,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useSystemProviderInfo,
  useSystemProviderUsageLimits,
  type ProviderUsageQueryState,
} from "@/hooks/queries/system-queries";
import {
  getProviderIconInfo,
  getProviderIconTintStyle,
} from "@/lib/provider-icon";

interface ProviderUsageSectionProps {
  active: boolean;
  providerId: string | undefined;
  modelLabel?: string;
}

export function ProviderUsageSection({
  active,
  providerId,
  modelLabel,
}: ProviderUsageSectionProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [active]);
  const enabled = active && providerId !== undefined;
  const providerInfo = useSystemProviderInfo({
    providerId,
    enabled,
  });
  const usageQuery = useSystemProviderUsageLimits({
    providerIds: providerId === undefined ? [] : [providerId],
    enabled,
  });
  if (!enabled) return null;
  return (
    <ProviderUsagePanel
      provider={providerInfo}
      usage={providerId === undefined ? undefined : usageQuery.usage[providerId]}
      queryState={
        providerId === undefined
          ? undefined
          : usageQuery.providerStates[providerId]
      }
      isFetching={usageQuery.isFetching}
      onRefresh={() => {
        void usageQuery.refetch();
      }}
      updatedAt={usageQuery.updatedAt}
      now={now}
      modelLabel={modelLabel}
    />
  );
}

export interface ProviderUsagePanelProps {
  provider: ProviderInfo | null | undefined;
  usage: ProviderUsage | undefined;
  queryState: ProviderUsageQueryState | undefined;
  isFetching: boolean;
  onRefresh: () => void;
  updatedAt: number;
  now: number;
  modelLabel?: string;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatReset(resetsAt: string | null, now: number): string {
  if (resetsAt === null) return "reset n/a";
  const resetsAtMs = Date.parse(resetsAt);
  if (Number.isNaN(resetsAtMs)) return "reset n/a";
  const deltaMinutes = Math.floor((resetsAtMs - now) / 60_000);
  if (deltaMinutes < 1) return "reset due";
  if (deltaMinutes < 60) return `resets in ${deltaMinutes}m`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 48) return `resets in ${hours}h ${deltaMinutes % 60}m`;
  const date = new Date(resetsAtMs);
  return `resets ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function formatUpdatedAgo(updatedAt: number, now: number): string | null {
  if (updatedAt === 0) return null;
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.floor(minutes / 60)}h ago`;
}

function remainingToneClass(usedPercent: number): string {
  const remaining = 100 - usedPercent;
  if (remaining < 20) return "text-destructive";
  if (remaining <= 50) return "text-warning-text";
  return "text-muted-foreground";
}

function usageAccountLine(usage: ProviderUsage): string | null {
  const planLabel = "planLabel" in usage ? usage.planLabel : null;
  const accountEmail = "accountEmail" in usage ? usage.accountEmail : null;
  const parts = [planLabel, accountEmail].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function usageStatusLine(
  usage: ProviderUsage | undefined,
  queryState: ProviderUsageQueryState | undefined,
): string | null {
  if (queryState?.isLoading) return "Loading…";
  if (usage === undefined) return "n/a";
  switch (usage.status) {
    case "ok":
      return null;
    case "unauthenticated":
      return "Not signed in";
    case "not_installed":
      return "Not installed";
    case "expired":
      return "Sign-in expired";
    case "error":
      return usage.message;
  }
}

function UsageWindowRow({
  window,
  now,
}: {
  window: ProviderUsageWindow;
  now: number;
}) {
  const usedPercent = Math.round(window.usedPercent);
  const leftPercent = Math.max(0, 100 - usedPercent);
  const toneClass = remainingToneClass(usedPercent);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className="shrink-0 truncate text-muted-foreground">
          {window.label}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className={cn("font-medium", toneClass)}>
            {usedPercent}% used
          </span>
          <span className="w-12 text-right text-muted-foreground">
            {leftPercent}% left
          </span>
        </span>
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full bg-current", toneClass)}
          style={{ width: `${Math.min(Math.max(usedPercent, 0), 100)}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
        <span>{formatReset(window.resetsAt, now)}</span>
        {window.cost ? (
          <span>
            ${(window.cost.usedUsdCents / 100).toFixed(2)} of $
            {(window.cost.limitUsdCents / 100).toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ProviderUsagePanel({
  provider,
  usage,
  queryState,
  isFetching,
  onRefresh,
  updatedAt,
  now,
  modelLabel,
}: ProviderUsagePanelProps) {
  const updatedLabel = formatUpdatedAgo(updatedAt, now);
  const accountLine = usage === undefined ? null : usageAccountLine(usage);
  const statusLine =
    provider !== null && provider !== undefined && !provider.maintenance.usage
      ? "Not exposed by provider"
      : usageStatusLine(usage, queryState);
  const body: ReactNode =
    usage?.status === "ok" ? (
      usage.windows.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {usage.windows.map((window) => (
            <UsageWindowRow
              key={window.label}
              window={window}
              now={now}
            />
          ))}
        </div>
      ) : (
        <span className="text-2xs text-muted-foreground">
          No limit windows reported
        </span>
      )
    ) : (
      <span className="text-2xs text-muted-foreground">{statusLine}</span>
    );
  const ProviderGlyph =
    provider !== null && provider !== undefined
      ? getProviderIconInfo("agent", provider.id, provider).icon
      : null;
  const tintStyle = getProviderIconTintStyle(provider ?? undefined);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          Provider Usage
        </span>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh provider usage"
          className="-m-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon
            name="RotateCcw"
            className={cn("size-3", isFetching && "animate-spin")}
          />
        </button>
      </div>
      {provider === undefined ? (
        <span className="text-2xs text-muted-foreground">
          Loading provider…
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            {ProviderGlyph ? (
              <span
                className="flex size-4 shrink-0 items-center justify-center"
                style={tintStyle}
              >
                <ProviderGlyph className="size-3.5" />
              </span>
            ) : null}
            <span className="truncate font-medium">
              {provider?.displayName ?? "Provider"}
            </span>
            {accountLine ? (
              <span className="min-w-0 truncate text-2xs text-muted-foreground">
                {accountLine}
              </span>
            ) : null}
          </div>
          {modelLabel ? (
            <span className="truncate pl-5 text-2xs text-muted-foreground">
              Model: {modelLabel}
            </span>
          ) : null}
          <div className="pl-5">{body}</div>
        </div>
      )}
      {updatedLabel ? (
        <span className="text-right text-2xs tabular-nums text-muted-foreground">
          {updatedLabel}
        </span>
      ) : null}
    </div>
  );
}
