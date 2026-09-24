import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { AppShell } from "../app-shell";
import { TeamAccess } from "../team-access";

export default async function TeamPage() {
  const access = await requireDashboardAccess("admin");
  return (
    <AppShell role={access.role} workspaceName={access.workspace.name} displayName={access.displayName} email={access.email}>
      <PageHeader
        eyebrow="Workspace"
        title="Team and access"
        description="Invite approved technicians and review current workspace membership. Public self-sign-up remains disabled."
      />
      <TeamAccess workspaceId={access.workspace.id} />
    </AppShell>
  );
}
