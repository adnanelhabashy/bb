import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { z } from "zod";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceSortMenu,
  ResourceToolbar,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  RESOURCE_GRID_PAGE_SIZE,
} from "@bb/shared-ui/resource-pagination";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import { usePluginCatalogSearch } from "@/hooks/queries/plugin-catalog-queries";
import { pluginCategoryFilterOptions } from "./BrowsePluginsTab";
import { CheckPluginUpdatesButton } from "./CheckPluginUpdatesButton";
import { InstalledPluginsTab } from "./InstalledPluginsTab";
import { installedPluginCatalogEntry } from "./installed-plugin-catalog";
import { PluginBrowseCategoryFilter } from "./PluginBrowseControls";
import { PluginShelf, PLUGIN_SHELF_ENTRY_LIMIT } from "./PluginShelf";
import {
  pluginCategoryFilterId,
  pluginCategoryShelves,
} from "./plugin-browse-discovery";
import { pluginCatalogCategoryMutedAccentStyle } from "./plugin-ui";

const installedNavigationSchema = z.object({
  installedReturn: z
    .object({ search: z.string(), scrollTop: z.number().nonnegative() })
    .optional(),
  installedRestoreScroll: z.number().nonnegative().optional(),
});

export function InstalledPluginsCollection({
  actions,
}: {
  actions: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const listQuery = usePluginList({ enabled: true });
  const catalogQuery = usePluginCatalogSearch("", { enabled: true });
  const plugins = useMemo(
    () =>
      (listQuery.data?.plugins ?? []).map((plugin) => {
        const entry = installedPluginCatalogEntry(
          plugin,
          catalogQuery.data?.entries ?? [],
        );
        return {
          ...plugin,
          categoryId: entry?.categoryId ?? plugin.categoryId,
          category: entry?.category ?? plugin.category,
        };
      }),
    [catalogQuery.data?.entries, listQuery.data?.plugins],
  );
  const shelfKey = searchParams.get("shelf");
  const query = searchParams.get("query") ?? "";
  const [searchInput, setSearchInput] = useState(query);
  useEffect(() => setSearchInput(query), [query]);
  const selectedCategories = useMemo(
    () => (shelfKey === null ? searchParams.getAll("category") : []),
    [searchParams, shelfKey],
  );
  const sortDirection =
    searchParams.get("direction") === "desc" ? "desc" : "asc";
  const sorted = searchParams.get("sort") === "alpha";
  const navigation = installedNavigationSchema.safeParse(location.state).data;
  const allShelves = useMemo(() => pluginCategoryShelves(plugins), [plugins]);
  const selectedShelf = allShelves.find((shelf) => shelf.key === shelfKey);
  useResourceRouteLabel(selectedShelf?.label ?? null);
  const scopedPlugins = useMemo(
    () => (shelfKey === null ? plugins : (selectedShelf?.entries ?? [])),
    [plugins, selectedShelf, shelfKey],
  );
  const categoryOptions = useMemo(
    () => pluginCategoryFilterOptions(plugins, selectedCategories),
    [plugins, selectedCategories],
  );
  const normalizedQuery = searchInput.trim().toLowerCase();
  const visiblePlugins = useMemo(
    () =>
      scopedPlugins
        .filter(
          (plugin) =>
            (selectedCategories.length === 0 ||
              selectedCategories.includes(pluginCategoryFilterId(plugin))) &&
            [
              plugin.id,
              plugin.name ?? "",
              plugin.description ?? "",
              plugin.version,
              plugin.sourceDisplay,
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
        )
        .sort((left, right) => {
          const enabledResult = Number(!left.enabled) - Number(!right.enabled);
          if (enabledResult !== 0) return enabledResult;
          if (left.enabled) {
            const publisherResult =
              Number(left.publisherLabel === null) -
              Number(right.publisherLabel === null);
            if (publisherResult !== 0) return publisherResult;
          }
          const result = (left.name ?? left.id).localeCompare(
            right.name ?? right.id,
          );
          if (result !== 0) return sortDirection === "asc" ? result : -result;
          return left.id.localeCompare(right.id);
        }),
    [normalizedQuery, scopedPlugins, selectedCategories, sortDirection],
  );
  const shelves = useMemo(
    () => pluginCategoryShelves(visiblePlugins),
    [visiblePlugins],
  );
  const installedList = useResourceInfiniteItems(visiblePlugins, {
    pageSize: RESOURCE_GRID_PAGE_SIZE,
    resetKey: location.search,
  });
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const ready = !listQuery.isPending && !catalogQuery.isPending;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || !ready) return;
    const positions = scrollPositions.current;
    viewport.scrollTop =
      navigation?.installedRestoreScroll ?? positions.get(location.search) ?? 0;
    return () => {
      positions.set(location.search, viewport.scrollTop);
    };
  }, [
    location.key,
    location.search,
    navigation?.installedRestoreScroll,
    ready,
  ]);

  const changeSearchParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next, {
      replace: true,
      state: { installedReturn: navigation?.installedReturn },
    });
  };
  const returnParams = new URLSearchParams(
    navigation?.installedReturn?.search ?? searchParams,
  );
  returnParams.delete("shelf");

  return (
    <ResourceCollectionViewport
      key={shelfKey ?? "installed"}
      scrollId="plugins-installed-results"
      viewportRef={viewportRef}
      contentClassName="[&>div]:block!"
    >
      <div className={cn("space-y-6 pb-8", TOOLS_PAGE_BAND_CLASSES)}>
        {shelfKey !== null ? (
          <div className="mx-auto w-full max-w-3xl space-y-2">
            <Link
              to={{
                pathname: location.pathname,
                search: returnParams.toString(),
              }}
              state={{
                installedRestoreScroll: navigation?.installedReturn?.scrollTop,
              }}
              className="-ml-1 inline-flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Icon name="ChevronLeft" className="size-3" aria-hidden />
              Installed plugins
            </Link>
            {selectedShelf === undefined ? null : (
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-foreground">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={pluginCatalogCategoryMutedAccentStyle(
                      selectedShelf.categoryId,
                    )}
                    aria-hidden
                  />
                  {selectedShelf.label}
                </span>{" "}
                <span className="rounded-md bg-muted px-2 py-1 text-2xs font-medium tabular-nums text-subtle-foreground">
                  {selectedShelf.entries.length.toLocaleString()}{" "}
                  {selectedShelf.entries.length === 1 ? "plugin" : "plugins"}
                </span>
              </h1>
            )}
          </div>
        ) : null}
        <ResourceToolbar
          searchValue={searchInput}
          searchPlaceholder="Search installed plugins"
          onSearchChange={(value) => {
            setSearchInput(value);
            changeSearchParams((next) => {
              if (value === "") next.delete("query");
              else next.set("query", value);
            });
          }}
          action={actions}
          controls={
            <>
              {shelfKey === null ? (
                <PluginBrowseCategoryFilter
                  value={selectedCategories}
                  options={categoryOptions}
                  onChange={(values) =>
                    changeSearchParams((next) => {
                      next.delete("category");
                      for (const value of values)
                        next.append("category", value);
                    })
                  }
                />
              ) : null}
              <ResourceSortMenu
                value="alpha"
                direction={sortDirection}
                compact
                options={[{ id: "alpha", label: "Plugin name" }]}
                onChange={() =>
                  changeSearchParams((next) => {
                    next.set("sort", "alpha");
                    next.set(
                      "direction",
                      sortDirection === "asc" ? "desc" : "asc",
                    );
                  })
                }
                onClear={
                  sorted
                    ? () =>
                        changeSearchParams((next) => {
                          next.delete("sort");
                          next.delete("direction");
                        })
                    : undefined
                }
              />
              {plugins.length > 0 ? <CheckPluginUpdatesButton /> : null}
            </>
          }
        />
        {listQuery.isError ? (
          <ResourceListState
            state="error"
            message="Couldn't load plugins."
            onRetry={() => void listQuery.refetch()}
          />
        ) : !ready ? (
          <ResourceListState state="loading" message="Loading plugins" />
        ) : shelfKey !== null && selectedShelf === undefined ? (
          <ResourceListState
            state="empty"
            message="No installed plugins in this category."
          />
        ) : plugins.length > 0 && visiblePlugins.length === 0 ? (
          <ResourceListState
            state="empty"
            message={
              normalizedQuery === ""
                ? "No plugins match these filters."
                : `No plugins match "${query}"`
            }
          />
        ) : shelfKey === null && !sorted && plugins.length > 0 ? (
          <div className="space-y-8" data-testid="plugin-installed-shelves">
            {shelves.map((shelf) => {
              const next = new URLSearchParams(searchParams);
              next.set("shelf", shelf.key);
              return (
                <PluginShelf
                  key={shelf.key}
                  shelf={shelf}
                  entryCount={shelf.entries.length}
                  seeAllLink={
                    <Link
                      to={{
                        pathname: location.pathname,
                        search: next.toString(),
                      }}
                      aria-label={`See all ${shelf.label}`}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return;
                        event.preventDefault();
                        navigate(
                          {
                            pathname: location.pathname,
                            search: next.toString(),
                          },
                          {
                            state: {
                              installedReturn: {
                                search: location.search,
                                scrollTop: viewportRef.current?.scrollTop ?? 0,
                              },
                            },
                          },
                        );
                      }}
                    >
                      See all
                    </Link>
                  }
                >
                  <InstalledPluginsTab
                    plugins={shelf.entries.slice(0, PLUGIN_SHELF_ENTRY_LIMIT)}
                    showCategory={false}
                    preview
                  />
                </PluginShelf>
              );
            })}
          </div>
        ) : (
          <div className={cn(shelfKey !== null && "mx-auto w-full max-w-3xl")}>
            <InstalledPluginsTab
              plugins={installedList.items}
              showCategory={shelfKey === null}
            />
            <ResourceInfiniteScrollSentinel
              key={installedList.items.length}
              hasMore={installedList.hasMore}
              onLoadMore={installedList.loadMore}
            />
          </div>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}
