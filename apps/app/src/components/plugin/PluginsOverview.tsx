import { useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ResourceCollectionPage } from "@bb/shared-ui/resource-list";
import { CreateWithTemplatesButton } from "@/components/create-via-prompt-examples";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  AddPluginDialog,
  type AddPluginInitial,
} from "@/components/plugin/management/AddPluginDialog";
import { BrowsePluginsTab } from "@/components/plugin/management/BrowsePluginsTab";
import { InstalledPluginsCollection } from "@/components/plugin/management/InstalledPluginsCollection";
import { PluginAuthorPage } from "@/components/plugin/management/PluginAuthorPage";
import { PLUGINS_INSTALLED_DESCRIPTION } from "@/components/plugin/plugins-collection-copy";
import {
  getPluginDetailRoutePath,
  getRootComposeRoutePath,
} from "@/lib/route-paths";

export function PluginsOverview({
  onOpenPlugin,
  mode,
}: {
  mode?: "installed" | "browse";
  onOpenPlugin?: (pluginId: string, trigger: HTMLButtonElement) => void;
} = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeMode =
    mode ?? (searchParams.get("view") === "installed" ? "installed" : "browse");
  const authorKey = searchParams.get("author");
  const [addDialog, setAddDialog] = useState<{
    open: boolean;
    initial: AddPluginInitial | null;
  }>({ open: false, initial: null });

  const startCreatePlugin = (prompt?: string) => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: prompt ?? CREATE_PLUGIN_PROMPT,
        replaceInitialPrompt: prompt !== undefined,
      },
    });
  };

  const installedActions = (
    <>
      <CreateWithTemplatesButton
        kind="plugin"
        label="New plugin"
        menuActions={[
          {
            label: "Install from source",
            icon: "Download",
            onSelect: () => setAddDialog({ open: true, initial: null }),
          },
        ]}
        onCreate={startCreatePlugin}
      />
    </>
  );

  let content: ReactNode;
  if (activeMode === "browse") {
    const openPlugin =
      onOpenPlugin ??
      ((pluginId: string) => navigate(getPluginDetailRoutePath({ pluginId })));
    content =
      authorKey === null ? (
        <BrowsePluginsTab
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onOpenPlugin={openPlugin}
          onInstallFromSource={() =>
            setAddDialog({ open: true, initial: null })
          }
        />
      ) : (
        <PluginAuthorPage
          authorKey={authorKey}
          onInstall={(initial) => setAddDialog({ open: true, initial })}
          onOpenPlugin={openPlugin}
        />
      );
  } else {
    content = <InstalledPluginsCollection actions={installedActions} />;
  }

  return (
    <>
      {activeMode === "browse" ? (
        <div className="flex h-full min-h-0 flex-col">{content}</div>
      ) : (
        <ResourceCollectionPage
          id="plugins-collection"
          description={PLUGINS_INSTALLED_DESCRIPTION}
          bandClassName={TOOLS_PAGE_BAND_CLASSES}
        >
          {content}
        </ResourceCollectionPage>
      )}
      <AddPluginDialog
        open={addDialog.open}
        initial={addDialog.initial}
        onOpenChange={(open) =>
          setAddDialog((current) => ({ ...current, open }))
        }
        onInstalled={(plugin) =>
          navigate(
            getPluginDetailRoutePath({
              pluginId: plugin.id,
              view: "installed",
            }),
          )
        }
      />
    </>
  );
}
