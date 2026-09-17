import { useLayoutEffect, useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { SecondaryPanelFixedTab } from "./ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";

export interface CompactPanelMainTab {
  label: string;
  onSelect: () => void;
}

interface CompactPanelTabStripProps {
  activeTabId: string | null;
  fixedTabs: readonly SecondaryPanelFixedTab[];
  tabs: readonly SecondaryPanelRenderableTab[];
  mainTab?: CompactPanelMainTab;
  onOpenNewTab?: () => void;
}

interface CompactTab {
  id: string | null;
  label: string;
  ariaLabel: string;
  onSelect: () => void;
  onClose: (() => void) | null;
}

const NAVIGATION_BUTTON_CLASS = cn(
  "shrink-0",
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
);

export function CompactPanelTabStrip({
  activeTabId,
  fixedTabs,
  tabs,
  mainTab,
  onOpenNewTab,
}: CompactPanelTabStripProps) {
  const activeTabRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const items: CompactTab[] = [
    ...(mainTab
      ? [{ id: null, ...mainTab, ariaLabel: mainTab.label, onClose: null }]
      : []),
    ...fixedTabs.map((tab) => ({
      id: tab.tab.id,
      label: tab.label,
      ariaLabel: tab.ariaLabel,
      onSelect: tab.onSelect,
      onClose: null,
    })),
    ...tabs
      .filter((tab) => tab.isHidden !== true)
      .map((tab) => ({
        id: tab.tab.id,
        label: tab.label,
        ariaLabel: tab.label,
        onSelect: tab.onSelect,
        onClose: tab.isPinned ? null : tab.onClose,
      })),
  ];
  const activeIndex = items.findIndex((tab) => tab.id === activeTabId);
  const previousTab = activeIndex > 0 ? items[activeIndex - 1] : undefined;
  const nextTab = activeIndex >= 0 ? items[activeIndex + 1] : undefined;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const activeTab = activeTabRef.current;
    if (!viewport || !activeTab) return;
    const revealActiveTab = () => {
      const viewportBounds = viewport.getBoundingClientRect();
      const tabBounds = activeTab.getBoundingClientRect();
      if (tabBounds.left < viewportBounds.left) {
        viewport.scrollLeft += tabBounds.left - viewportBounds.left;
      } else if (tabBounds.right > viewportBounds.right) {
        viewport.scrollLeft += tabBounds.right - viewportBounds.right;
      }
    };
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(viewport);
    observer.observe(activeTab);
    return () => observer.disconnect();
  }, [activeTabId, items.length]);

  return (
    <div
      className="flex min-w-0 flex-1 items-center"
      role="toolbar"
      aria-label="Page tabs"
      data-no-secondary-panel-swipe
    >
      <Button
        variant="ghost"
        size="icon"
        className={NAVIGATION_BUTTON_CLASS}
        aria-label="Previous tab"
        disabled={!previousTab}
        onClick={previousTab?.onSelect}
      >
        <Icon name="ChevronLeft" />
      </Button>
      <div
        ref={viewportRef}
        className="@container no-scrollbar min-w-0 flex-1 touch-pan-x overflow-x-auto overscroll-x-contain"
      >
        <div className="flex w-max items-center gap-1">
          {items.map((tab) => (
            <div
              key={tab.id ?? "main"}
              ref={tab.id === activeTabId ? activeTabRef : undefined}
              className={cn(
                "flex max-w-[100cqw] shrink-0 items-center rounded-md",
                tab.id === activeTabId && "bg-state-active",
              )}
            >
              <Button
                variant="ghost"
                className="h-11 min-w-11 max-w-40 px-3 text-sm"
                aria-label={tab.ariaLabel}
                aria-pressed={tab.id === activeTabId}
                onClick={tab.onSelect}
              >
                <span className="truncate" title={tab.label}>
                  {tab.label}
                </span>
              </Button>
              {tab.onClose ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className={NAVIGATION_BUTTON_CLASS}
                  aria-label={`Close ${tab.label}`}
                  onClick={tab.onClose}
                >
                  <Icon name="X" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={NAVIGATION_BUTTON_CLASS}
        aria-label="Next tab"
        disabled={!nextTab}
        onClick={nextTab?.onSelect}
      >
        <Icon name="ChevronRight" />
      </Button>
      {onOpenNewTab ? (
        <Button
          variant="ghost"
          size="icon"
          className={NAVIGATION_BUTTON_CLASS}
          aria-label="Open new tab"
          onClick={onOpenNewTab}
        >
          <Icon name="Plus" />
        </Button>
      ) : null}
    </div>
  );
}
