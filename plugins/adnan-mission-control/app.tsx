// bb-plugin-adnan-mission-control — frontend entry (Phase 1).
//
// One nav panel, mounted exactly once. Overview, Agents, and Roles are
// reached through sub-path routing (`/plugins/adnan-mission-control/agents`),
// not fixed tabs — fixed tabs stay reserved for future contextual views
// (worker details, verification output).
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { OverviewPage } from "@/components/overview";
import { AgentsPage } from "@/components/agents";
import { RolesPage } from "@/components/roles";
import { ApprovalsPage } from "@/components/approvals";
import { VerificationPage } from "@/components/verification";

const TABS = [
  { id: "overview", title: "Overview", subPath: "" },
  { id: "agents", title: "Agents", subPath: "agents" },
  { id: "roles", title: "Roles", subPath: "roles" },
  { id: "approvals", title: "Approvals", subPath: "approvals" },
  { id: "verification", title: "Verification", subPath: "verification" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function activeTab(subPath: string): TabId {
  if (subPath === "agents") return "agents";
  if (subPath === "roles") return "roles";
  if (subPath === "approvals") return "approvals";
  if (subPath === "verification") return "verification";
  return "overview";
}

function MissionControlShell({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const active = activeTab(subPath);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-4 pt-2" aria-label="Mission Control sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => navigate.toPluginPanel("mission-control", { subPath: tab.subPath })}
            aria-current={active === tab.id ? "page" : undefined}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium",
              active === tab.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.title}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === "agents" ? (
          <AgentsPage />
        ) : active === "roles" ? (
          <RolesPage />
        ) : active === "approvals" ? (
          <ApprovalsPage />
        ) : active === "verification" ? (
          <VerificationPage />
        ) : (
          <OverviewPage />
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "mission-control",
    title: "Mission Control",
    icon: "Gauge",
    path: "mission-control",
    component: MissionControlShell,
  });
});
