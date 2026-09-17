// Roles tab: the role router. Each row maps a stable conceptual role
// (PLAN, REVIEW, ...) to a live provider/model/reasoning tuple, edited
// through BB's own ProviderModelPicker so only catalog-valid combinations
// are selectable. Mappings persist in plugin KV; the catalog itself is
// read live from bb.sdk.providers and never hardcoded.
import { useMemo, useState, type ReactNode } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_PermissionModePicker as PermissionModePicker,
  type ExperimentalProviderModelPickerValue,
  type ExperimentalPermissionModePickerProps,
} from "@get-bb/plugin-sdk/app";
import type { RoleCatalog, RoleIssue, RoleMapping } from "../server";
import { useRoles } from "@/lib/data";
import { Chip, EmptyState, relativeTime } from "@/components/common";
import { cn } from "@/lib/utils";

type PickerValue = ExperimentalProviderModelPickerValue;
type PermissionMode = ExperimentalPermissionModePickerProps["value"];
const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** First available provider's default tuple, used to seed an unassigned
 *  role's picker locally. Nothing is persisted until the user picks. */
function seedValue(catalog: RoleCatalog): PickerValue | null {
  const provider = catalog.providers.find((candidate) => candidate.available) ?? catalog.providers[0] ?? null;
  if (provider === null) return null;
  const owned = (model: { routeProviderId: string | null }) =>
    model.routeProviderId === null || model.routeProviderId === provider.id;
  const model =
    catalog.models.find((candidate) => owned(candidate) && candidate.isDefault) ??
    catalog.models.find((candidate) => owned(candidate)) ??
    null;
  if (model === null) return { providerId: provider.id, model: "", reasoningLevel: "none" };
  const reasoning =
    model.defaultReasoningEffort !== null && model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : (model.supportedReasoningEfforts[0] ?? "none");
  return { providerId: provider.id, model: model.id, reasoningLevel: reasoning as PickerValue["reasoningLevel"] };
}

function toPickerValue(role: RoleMapping): PickerValue {
  return {
    providerId: role.providerId ?? "",
    model: role.model ?? "",
    reasoningLevel: (role.reasoningLevel ?? "none") as PickerValue["reasoningLevel"],
    ...(role.serviceTier !== null ? { serviceTier: role.serviceTier as PickerValue["serviceTier"] } : {}),
  };
}

function RoleRow({
  role,
  issues,
  seed,
  onAssign,
  onChange,
  onPermissionChange,
  onRemove,
}: {
  role: RoleMapping;
  issues: RoleIssue[];
  /** Local picker seed for an unassigned role; undefined = show the assign prompt. */
  seed: PickerValue | undefined;
  onAssign: (id: string) => void;
  onChange: (id: string, value: PickerValue) => void;
  onPermissionChange: (id: string, value: PermissionMode) => void;
  onRemove: (id: string) => void;
}) {
  const unassigned = role.providerId === null && seed === undefined;
  // A mapping that no longer resolves must NOT be fed to the live picker:
  // the host reconciles invalid values to catalog defaults and emits
  // onChange, which would silently overwrite the stored mapping on render.
  // Show the raw values + advisory instead; repair is an explicit user act
  // that seeds the picker locally (persisted only on the user's pick).
  const broken = issues.length > 0 && seed === undefined;
  // Memoized on primitives: role objects are rebuilt on every server reload,
  // and a fresh value identity each render makes the host picker re-run its
  // reconciliation and re-emit onChange.
  const pickerValue = useMemo<PickerValue>(
    () => seed ?? toPickerValue(role),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, role.providerId, role.model, role.reasoningLevel, role.serviceTier],
  );

  return (
    <li className="rounded-md border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 truncate font-mono text-xs font-semibold tracking-wide text-foreground">
          {role.label}
        </span>
        <div className="min-w-0 flex-1">
          {unassigned ? (
            <span className="text-xs text-muted-foreground">
              Unassigned —{" "}
              <button
                type="button"
                className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                onClick={() => onAssign(role.id)}
              >
                assign a model
              </button>
            </span>
          ) : broken ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-mono text-muted-foreground">
                {role.providerId ?? "?"} / {role.model ?? "?"} / {role.reasoningLevel ?? "default"}
                {role.serviceTier !== null ? ` / tier:${role.serviceTier}` : ""}
                {role.permissionMode !== null ? ` / perm:${role.permissionMode}` : ""}
              </span>
              <button
                type="button"
                className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
                onClick={() => onAssign(role.id)}
              >
                repair mapping
              </button>
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ProviderModelPicker
                value={pickerValue}
                onChange={(value) => onChange(role.id, value)}
                className="max-w-full"
              />
              <PermissionModePicker
                providerId={pickerValue.providerId}
                value={role.permissionMode ?? DEFAULT_PERMISSION_MODE}
                onChange={(value) => onPermissionChange(role.id, value)}
                align="start"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          title={`Remove role ${role.label}`}
          onClick={() => onRemove(role.id)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>
      {issues.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 pl-28">
          {issues.map((issue) => (
            <li key={issue.kind} className="text-xs text-amber-500">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RolesPage() {
  const { data, isLoading, error, refresh, save } = useRoles();
  const [seeds, setSeeds] = useState<Record<string, PickerValue>>({});
  const [newLabel, setNewLabel] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4">
        <EmptyState title="Role router unavailable">{error}</EmptyState>
      </div>
    );
  }
  if (data === null || isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading role mappings…</div>;
  }

  const { state, catalog, issues } = data;
  const issuesFor = (roleId: string) => issues.filter((issue) => issue.roleId === roleId);

  async function persist(roles: RoleMapping[]): Promise<void> {
    try {
      setSaveError(null);
      await save(roles);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Structural equality between a stored mapping and a picker value, with
   *  null/undefined/empty normalized. The host picker re-emits onChange when
   *  it reconciles a value (e.g. after a reload passes a fresh object
   *  identity); persisting that echo would feed a save→publish→reload loop. */
  function sameMapping(role: RoleMapping, value: PickerValue): boolean {
    return (
      (role.providerId ?? "") === value.providerId &&
      (role.model ?? "") === value.model &&
      (role.reasoningLevel ?? "none") === value.reasoningLevel &&
      (role.serviceTier ?? null) === (value.serviceTier ?? null)
    );
  }

  function handleChange(id: string, value: PickerValue): void {
    const current = state.roles.find((role) => role.id === id);
    if (current === undefined || sameMapping(current, value)) return;
    const roles = state.roles.map((role) =>
      role.id === id
        ? {
            ...role,
            providerId: value.providerId === "" ? null : value.providerId,
            model: value.model === "" ? null : value.model,
            reasoningLevel: value.reasoningLevel,
            serviceTier: value.serviceTier ?? null,
          }
        : role,
    );
    void persist(roles);
  }

  function handlePermissionChange(id: string, value: PermissionMode): void {
    const current = state.roles.find((role) => role.id === id);
    if (current === undefined || (current.permissionMode ?? DEFAULT_PERMISSION_MODE) === value) return;
    const roles = state.roles.map((role) => (role.id === id ? { ...role, permissionMode: value } : role));
    void persist(roles);
  }

  function handleSeed(id: string): void {
    const value = seedValue(catalog);
    if (value === null || value.providerId === "") return;
    setSeeds((current) => ({ ...current, [id]: value }));
  }

  function handleRemove(id: string): void {
    void persist(state.roles.filter((role) => role.id !== id));
  }

  function handleAdd(): void {
    const label = newLabel.trim().toUpperCase();
    const base = slugify(label);
    if (label === "" || base === "") return;
    let id = base;
    let counter = 2;
    while (state.roles.some((role) => role.id === id)) {
      id = `${base}-${counter}`;
      counter += 1;
    }
    void persist([
      ...state.roles,
      { id, label, providerId: null, model: null, reasoningLevel: null, serviceTier: null, permissionMode: null },
    ]);
    setNewLabel("");
  }

  const catalogStatus: ReactNode = catalog.at === null ? "catalog unavailable" : `catalog refreshed ${relativeTime(catalog.at)}`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Role Router</h2>
        <Chip className="text-muted-foreground">
          {catalog.providers.length} providers · {catalog.models.length} models · {catalogStatus}
        </Chip>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Refresh catalog
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Map a stable role to a provider/model/reasoning tuple once; workflows reference the role name instead of
        hardcoding provider and model. Choices come from BB&apos;s live catalog.
      </p>

      {catalog.loadError !== null ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          {/* loadError can mean "one provider's models failed" (rest of the
              catalog above is still live) or "the whole catalog fetch
              failed" (stale/empty) — phrase neutrally rather than implying
              total failure either way. */}
          Catalog warning: {catalog.loadError}
        </div>
      ) : null}
      {saveError !== null ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Save failed: {saveError}
        </div>
      ) : null}

      <ul className="space-y-2">
        {state.roles.map((role) => (
          <RoleRow
            key={role.id}
            role={role}
            issues={issuesFor(role.id)}
            seed={seeds[role.id]}
            onAssign={handleSeed}
            onChange={handleChange}
            onPermissionChange={handlePermissionChange}
            onRemove={handleRemove}
          />
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAdd();
          }}
          placeholder="New role name (e.g. AUDIT)"
          className={cn(
            "w-56 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs",
            "placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={newLabel.trim() === ""}
          className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          Add role
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          updated {relativeTime(state.updatedAt)} by {state.updatedBy}
        </span>
      </div>
    </div>
  );
}
