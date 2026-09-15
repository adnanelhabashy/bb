// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { OpenPluginGuideButton } from "./OpenPluginGuideButton";

const GUIDE: InstalledPlugin = {
  id: "plugin-api-docs",
  source: "builtin:plugin-api-docs",
  rootDir: "/plugins/plugin-api-docs",
  version: "1.0.0",
  provenance: "builtin",
  publisherLabel: "BB Official",
  isOrphanedBuiltin: false,
  sourceDisplay: "Included with BB",
  updateState: {},
  enabled: false,
  description: "Explore the plugin API",
  name: "Plugin Guide",
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "disabled",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderGuide() {
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={["/plugins"]}>
      <OpenPluginGuideButton />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
  return screen.getByRole("button", { name: "Plugin Guide" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenPluginGuideButton", () => {
  it("enables a disabled Guide before navigating and prevents duplicate requests", async () => {
    const enabled = { ...GUIDE, enabled: true, status: "running" };
    let finishEnable: (response: Response) => void = () => undefined;
    const enableResponse = new Promise<Response>((resolve) => {
      finishEnable = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/enable")
        ? enableResponse
        : Promise.resolve(jsonResponse({ plugins: [GUIDE] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const button = renderGuide();
    fireEvent.click(button);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/plugins/plugin-api-docs/enable",
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finishEnable(jsonResponse({ ok: true, plugin: enabled }));
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
  });

  it("opens an enabled Guide without enabling or reloading it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        plugins: [{ ...GUIDE, enabled: true, status: "running" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide());
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays on Browse after an enable failure and allows retry", async () => {
    const toast = vi.spyOn(appToast, "error").mockReturnValue("toast");
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).endsWith("/enable")) {
          return jsonResponse({ plugins: [GUIDE] });
        }
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: "Service unavailable" }, 503)
          : jsonResponse({
              ok: true,
              plugin: { ...GUIDE, enabled: true, status: "running" },
            });
      }),
    );
    const button = renderGuide();
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith("Could not open Plugin Guide", {
        description: "Service unavailable",
      }),
    );
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
    await vi.waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs/plugin-api",
      ),
    );
    expect(attempts).toBe(2);
  });

  it("opens the listing when Guide is absent without attempting to enable it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ plugins: [] }));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(renderGuide());
    await vi.waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/plugins/plugin-api-docs",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
