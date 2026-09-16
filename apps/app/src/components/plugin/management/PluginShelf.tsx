import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceShelfAction,
  ResourceSourceShelf,
} from "@bb/shared-ui/resource-list";
import bbLogoUrl from "../../../../../../assets/bb-logo.svg";
import type { PluginBrowseShelf } from "./plugin-browse-discovery";
import { pluginCatalogCategoryMutedAccentStyle } from "./plugin-ui";

export const PLUGIN_SHELF_ENTRY_LIMIT = 6;

export function PluginShelf({
  shelf,
  entryCount,
  seeAllLink,
  children,
}: {
  shelf: Pick<
    PluginBrowseShelf,
    "key" | "label" | "description" | "categoryId"
  >;
  entryCount: number;
  seeAllLink: ReactNode;
  children: ReactNode;
}) {
  return (
    <ResourceSourceShelf
      label={shelf.label}
      description={shelf.description}
      hideDescriptionOnMobile
      leading={
        shelf.key === "collection:bb-official" ? (
          <span
            className="size-4 shrink-0 bg-current text-foreground"
            style={{ mask: `url(${bbLogoUrl}) center / contain no-repeat` }}
            aria-hidden
          />
        ) : shelf.key === "collection:new-and-notable" ? (
          <Icon name="News01" className="size-4 text-foreground" aria-hidden />
        ) : (
          <span
            className="size-2 rounded-full"
            style={pluginCatalogCategoryMutedAccentStyle(shelf.categoryId)}
            aria-hidden
          />
        )
      }
      browseAction={
        entryCount > 2 ? (
          <ResourceShelfAction
            asChild
            className={cn(
              "underline underline-offset-4",
              entryCount <= PLUGIN_SHELF_ENTRY_LIMIT && "sm:hidden",
            )}
          >
            {seeAllLink}
          </ResourceShelfAction>
        ) : undefined
      }
    >
      {children}
    </ResourceSourceShelf>
  );
}

export function PluginShelfGrid({ children }: { children: ReactNode }) {
  return (
    <div data-plugin-shelf>
      <div
        data-plugin-shelf-grid
        className="grid gap-2 max-sm:[&>*:nth-child(n+3)]:hidden"
      >
        {children}
      </div>
    </div>
  );
}
