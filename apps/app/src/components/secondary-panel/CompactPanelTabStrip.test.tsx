// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompactPanelTabStrip } from "./CompactPanelTabStrip";
import type { SecondaryPanelFixedTab } from "./ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";

afterEach(cleanup);

function NavigationFixture() {
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(true);
  const fixedTabs: SecondaryPanelFixedTab[] = [
    {
      tab: { id: "thread-info", kind: "thread-info" },
      label: "Info",
      ariaLabel: "Info",
      title: "Thread info",
      leadingVisual: null,
      onSelect: () => setActiveTabId("thread-info"),
    },
  ];
  const tabs: SecondaryPanelRenderableTab[] = [
    {
      tab: { id: "hidden", kind: "new-tab" },
      label: "Hidden tab",
      leadingVisual: null,
      statusLabel: null,
      isHidden: true,
      onSelect: () => setActiveTabId("hidden"),
      onClose: () => {},
      renderContent: () => null,
    },
    ...(fileOpen
      ? [
          {
            tab: {
              id: "file",
              kind: "new-tab",
            } satisfies SecondaryPanelRenderableTab["tab"],
            label: "README.md",
            leadingVisual: null,
            statusLabel: null,
            onSelect: () => setActiveTabId("file"),
            onClose: () => {
              setFileOpen(false);
              setActiveTabId("thread-info");
            },
            renderContent: () => null,
          },
        ]
      : []),
  ];
  return (
    <>
      <CompactPanelTabStrip
        activeTabId={activeTabId}
        fixedTabs={fixedTabs}
        tabs={tabs}
        mainTab={{ label: "Chat", onSelect: () => setActiveTabId(null) }}
      />
      <output>{activeTabId ?? "chat"}</output>
    </>
  );
}

describe("compact page navigation", () => {
  it("selects adjacent pages in visible order, including Chat, and stops at both ends", () => {
    render(<NavigationFixture />);
    const previous = screen.getByRole("button", { name: "Previous tab" });
    const next = screen.getByRole("button", { name: "Next tab" });
    expect(previous.hasAttribute("disabled")).toBe(true);
    fireEvent.click(next);
    expect(screen.getByRole("status").textContent).toBe("thread-info");
    expect(
      screen.getByRole("button", { name: "Info" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(next);
    expect(screen.getByRole("status").textContent).toBe("file");
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Hidden tab")).toBeNull();
    fireEvent.click(previous);
    fireEvent.click(previous);
    expect(screen.getByRole("status").textContent).toBe("chat");
    expect(previous.hasAttribute("disabled")).toBe(true);
  });

  it("keeps direct selection and closing separate and recalculates the last tab", () => {
    render(<NavigationFixture />);
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(screen.getByRole("status").textContent).toBe("file");
    fireEvent.click(screen.getByRole("button", { name: "Close README.md" }));
    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("thread-info");
    expect(
      screen.getByRole("button", { name: "Next tab" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Close Info" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("status").textContent).toBe("chat");
  });
});
