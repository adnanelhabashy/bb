// Thin wrappers around experimental BB frontend APIs. Everything experimental
// the plugin touches lives here so renames/behavior changes have one call site.
import { experimental_ProviderIcon as BbProviderIcon, experimental_useProviders as useBbProviders } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";

interface ProviderLike {
  id: string;
  pluginId?: string;
  displayName?: string;
  family?: string;
  icon?: unknown;
  logoUrl?: string | null;
  available?: boolean;
}

/** Render a provider's mark with a safe text fallback when the experimental
 * host component is unavailable or the provider record is sparse. */
export function ProviderMark({ providerId, providers, className }: { providerId: string; providers: ProviderLike[]; className?: string }) {
  const provider = providers.find((candidate) => candidate.id === providerId) ?? null;
  if (provider === null) {
    return <span className={className}>{providerId}</span>;
  }
  try {
    return <BbProviderIcon providerKind="agent" provider={provider as never} fallback="Bot" className={className} />;
  } catch {
    return <span className={className}>{provider.displayName ?? providerId}</span>;
  }
}

/** Live provider roster as a map, wrapped so consumers never import the
 * experimental hook directly. */
export function useProvidersMap(): Map<string, ProviderLike> {
  const { providers } = useBbProviders();
  return new Map(providers.map((provider) => [provider.id, provider as unknown as ProviderLike]));
}

/** Same roster as an array for ProviderMark props. */
export function useProvidersList(): ProviderLike[] {
  const { providers } = useBbProviders();
  return providers as unknown as ProviderLike[];
}

export type { ProviderLike };
export type ProviderList = ProviderLike[];
export type ProviderIconComponent = ComponentType<never>;
