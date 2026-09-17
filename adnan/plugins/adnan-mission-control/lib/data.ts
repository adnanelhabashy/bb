// Shared data hooks: typed RPC + realtime invalidation + reconnect reconcile.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { ApprovalsState, EnrichedThread, MissionState, MissionValues, Probe, RoleCatalog, RoleIssue, RoleMapping, RoleMappingsState, UsageDashboard, VerificationEvidence, rpcContract } from "../server";

export type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

const CHANNEL = "mc-changed";

export interface TreeData {
  counters: {
    total: number;
    active: number;
    idle: number;
    other: number;
    pendingInteractions: number;
    providersInUse: string[];
    generatedAt: number;
  };
  threads: EnrichedThread[];
  probe: Probe;
}

/** Fetches `tree_get` and refetches on every mc-changed signal and on
 * reconnect after a dropped socket (signals are ephemeral, never replayed). */
export function useTree(): { data: TreeData | null; isLoading: boolean; error: string | null; refresh: () => void } {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<TreeData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const connection = useRealtimeConnectionState();
  const everConnected = useRef(false);

  const load = useCallback(() => {
    let cancelled = false;
    rpc
      .call("tree_get", { includeArchived: false })
      .then((next: TreeData) => {
        if (cancelled) return;
        setData(next);
        setError(null);
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (connection === "connected" && everConnected.current) load();
    if (connection === "connected") everConnected.current = true;
  }, [connection, load]);

  useRealtime(CHANNEL, () => {
    load();
  });

  return { data, isLoading, error, refresh: load };
}

export function useMission(): {
  state: MissionState | null;
  isLoading: boolean;
  setState: (values: Partial<MissionValues>) => Promise<void>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setStateData] = useState<MissionState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    rpc
      .call("mission_get", null)
      .then((result) => {
        if (cancelled) return;
        setStateData(result.state);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => load(), [load]);
  useRealtime(CHANNEL, () => {
    load();
  });

  const setState = useCallback(
    async (values: Partial<MissionValues>) => {
      const result = await rpc.call("mission_set", { values });
      setStateData(result.state);
    },
    [rpc],
  );

  return { state, isLoading, setState };
}

export interface RolesData {
  state: RoleMappingsState;
  catalog: RoleCatalog;
  issues: RoleIssue[];
}

export function useRoles(): {
  data: RolesData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  save: (roles: RoleMapping[]) => Promise<RoleIssue[]>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<RolesData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (refresh = false) => {
      let cancelled = false;
      rpc
        .call("roles_get", { refresh })
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(null);
          setIsLoading(false);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
          setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [rpc],
  );

  useEffect(() => load(), [load]);
  useRealtime(CHANNEL, () => {
    load();
  });

  const save = useCallback(
    async (roles: RoleMapping[]) => {
      // Optimistic update: the host provider/model picker is a controlled
      // component fed `value` straight from this state. Without this, the
      // stale pre-change value is what re-renders for the length of the RPC
      // round-trip — the host reads being fed that old value back as an
      // external revert and reconciles to it, visible as "pick a non-Codex
      // model, picker snaps back to Codex and re-picks a default".
      setData((current) => (current === null ? current : { ...current, state: { ...current.state, roles } }));
      try {
        const result = await rpc.call("roles_save", { roles });
        setData((current) => (current === null ? current : { ...current, state: result.state, issues: result.issues }));
        return result.issues;
      } catch (error) {
        load();
        throw error;
      }
    },
    [rpc, load],
  );

  return { data, isLoading, error, refresh: () => load(true), save };
}

export interface ApprovalsData {
  categories: Array<{ id: string; label: string }>;
  state: ApprovalsState;
}

/** Approval Center (Phase 3): toggling here is the approval — there is no
 *  agent write path, so unlike useMission/useRoles there is nothing to
 *  reconcile beyond realtime refetch. */
export function useApprovals(): {
  data: ApprovalsData | null;
  isLoading: boolean;
  error: string | null;
  setApproved: (id: string, approved: boolean) => Promise<void>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ApprovalsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    rpc
      .call("approvals_get", null)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => load(), [load]);
  useRealtime(CHANNEL, () => {
    load();
  });

  const setApproved = useCallback(
    async (id: string, approved: boolean) => {
      const result = await rpc.call("approvals_set", { approvals: { [id]: approved } });
      setData((current) => (current === null ? current : { ...current, state: result.state }));
    },
    [rpc],
  );

  return { data, isLoading, error, setApproved };
}

/** Verification Guardian (Phase 4): real observed command executions, the
 *  material a user can attach as evidence — never inferred pass/fail. */
export function useEvidence(): {
  evidence: VerificationEvidence[];
  at: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [evidence, setEvidence] = useState<VerificationEvidence[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    rpc
      .call("evidence_get", null)
      .then((result) => {
        if (cancelled) return;
        setEvidence(result.evidence);
        setAt(result.at);
        setError(null);
        setIsLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => load(), [load]);
  useRealtime(CHANNEL, () => {
    load();
  });

  return { evidence, at, isLoading, error, refresh: load };
}

/** Usage & Limits (Phase 6): one aggregated snapshot of direct provider usage
 *  and pooled accounts. Fetched on demand (tab open / Refresh click) — usage
 *  data is expensive to collect, so there is no polling and no realtime
 *  signal; the page adds its own slow tick for countdown rendering. */
export function useUsageDashboard(): {
  data: UsageDashboard | null;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refresh: () => void;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setIsFetching(true);
    rpc
      .call("usage_dashboard_get", null)
      .then((result: UsageDashboard) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setIsLoading(false);
        setIsFetching(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIsLoading(false);
        setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => load(), [load]);

  return { data, isLoading, isFetching, error, refresh: load };
}

/** Quick Actions (Phase 5): every call here is a real BB mutation fired by a
 *  deliberate button click in the panel — never automatic, never on a timer. */
export function useThreadActions(): {
  send: (threadId: string, text: string, mode: "queue-if-active" | "steer-if-active") => Promise<void>;
  stop: (threadId: string) => Promise<void>;
  delegate: (threadId: string, roleId: string, prompt: string) => Promise<{ childThreadId: string }>;
} {
  const rpc = useRpc<typeof rpcContract>();
  return {
    send: async (threadId, text, mode) => {
      await rpc.call("thread_send", { threadId, text, mode });
    },
    stop: async (threadId) => {
      await rpc.call("thread_stop", { threadId });
    },
    delegate: async (threadId, roleId, prompt) => rpc.call("thread_delegate", { threadId, roleId, prompt }),
  };
}
