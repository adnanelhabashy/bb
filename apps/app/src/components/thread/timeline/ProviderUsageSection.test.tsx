// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderInfo } from "@bb/domain";
import type { ProviderUsage } from "@bb/host-daemon-contract";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { afterEach, expect, it, vi } from "vitest";
import { ProviderUsagePanel } from "./ProviderUsageSection";

afterEach(cleanup);

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function provider(
  id: string,
  overrides: Partial<ProviderInfo> = {},
): ProviderInfo {
  return makeProviderInfo({
    id,
    displayName: id,
    logoUrl: null,
    maintenance: { health: true, usage: true, installation: false },
    capabilities: { permissionModes: ["full"] },
    ...overrides,
  });
}

function renderPanel(args: {
  provider: ProviderInfo | null | undefined;
  usage?: ProviderUsage;
  queryState?: { isError: boolean; isLoading: boolean };
  isFetching?: boolean;
  onRefresh?: () => void;
  updatedAt?: number;
  modelLabel?: string;
}) {
  return render(
    <ProviderUsagePanel
      provider={args.provider}
      usage={args.usage}
      queryState={args.queryState}
      isFetching={args.isFetching ?? false}
      onRefresh={args.onRefresh ?? (() => undefined)}
      updatedAt={args.updatedAt ?? 0}
      now={NOW}
      modelLabel={args.modelLabel}
    />,
  );
}

it("shows provider, model, plan, account, window percentages, and reset countdown", () => {
  renderPanel({
    provider: provider("claude-code"),
    modelLabel: "Claude Sonnet",
    usage: {
      status: "ok",
      accountEmail: "adnan@example.com",
      planLabel: "Pro",
      windows: [
        {
          label: "5-hour",
          usedPercent: 37,
          resetsAt: "2026-09-17T14:18:00.000Z",
        },
        {
          label: "Weekly",
          usedPercent: 81,
          resetsAt: "2026-09-21T12:00:00.000Z",
        },
      ],
    },
    queryState: { isError: false, isLoading: false },
    updatedAt: NOW - 24_000,
  });
  expect(screen.getByText("claude-code")).toBeTruthy();
  expect(screen.getByText("Pro · adnan@example.com")).toBeTruthy();
  expect(screen.getByText("Model: Claude Sonnet")).toBeTruthy();
  expect(screen.getByText("5-hour")).toBeTruthy();
  expect(screen.getByText("37% used")).toBeTruthy();
  expect(screen.getByText("63% left")).toBeTruthy();
  expect(screen.getByText("resets in 2h 18m")).toBeTruthy();
  expect(screen.getByText("Weekly")).toBeTruthy();
  expect(screen.getByText("resets Sep 21")).toBeTruthy();
  expect(screen.getByText("Updated 24s ago")).toBeTruthy();
});

it("marks low remaining quota with warning and exhausted with error tones", () => {
  renderPanel({
    provider: provider("codex"),
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      windows: [
        {
          label: "Session",
          usedPercent: 58,
          resetsAt: "2026-09-17T13:07:00.000Z",
        },
        {
          label: "Daily",
          usedPercent: 85,
          resetsAt: null,
        },
        {
          label: "Weekly",
          usedPercent: 100,
          resetsAt: null,
        },
      ],
    },
    queryState: { isError: false, isLoading: false },
  });
  const sessionUsed = screen.getByText("58% used");
  expect(sessionUsed.className).toContain("text-warning-text");
  const dailyUsed = screen.getByText("85% used");
  expect(dailyUsed.className).toContain("text-destructive");
  expect(screen.getByText("0% left")).toBeTruthy();
  expect(screen.getAllByText("reset n/a").length).toBe(2);
});

it("shows the provider error message when usage fails to load", () => {
  renderPanel({
    provider: provider("claude-code"),
    usage: {
      status: "error",
      message: "Provider usage could not be loaded.",
      planLabel: null,
      accountEmail: null,
    },
    queryState: { isError: true, isLoading: false },
  });
  expect(
    screen.getByText("Provider usage could not be loaded."),
  ).toBeTruthy();
});

it("marks providers without a usage capability as not exposed", () => {
  renderPanel({
    provider: provider("pi", {
      maintenance: { health: true, usage: false, installation: false },
    }),
  });
  expect(screen.getByText("Not exposed by provider")).toBeTruthy();
});

it("shows unauthenticated and missing usage as distinct states", () => {
  renderPanel({
    provider: provider("acp-cursor"),
    usage: { status: "unauthenticated" },
    queryState: { isError: false, isLoading: false },
  });
  expect(screen.getByText("Not signed in")).toBeTruthy();
  renderPanel({
    provider: provider("codex"),
    queryState: { isError: false, isLoading: false },
  });
  expect(screen.getByText("n/a")).toBeTruthy();
});

it("shows a loading line while usage is being fetched", () => {
  renderPanel({
    provider: provider("codex"),
    queryState: { isError: false, isLoading: true },
  });
  expect(screen.getByText("Loading…")).toBeTruthy();
});

it("shows a loading line while the provider info is resolving", () => {
  renderPanel({ provider: undefined });
  expect(screen.getByText("Loading provider…")).toBeTruthy();
});

it("calls onRefresh when the refresh button is activated", () => {
  const onRefresh = vi.fn();
  renderPanel({ provider: provider("codex"), onRefresh });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh provider usage" }),
  );
  expect(onRefresh).toHaveBeenCalledTimes(1);
});
