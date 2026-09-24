import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { AppShell } from "../app-shell";
import { DocumentManagement } from "../document-management";
import { TechnicianDocuments } from "../technician-documents";

export default async function DocumentsPage() {
  const access = await requireDashboardAccess();
  const isAdmin = access.role === "admin";
  return (
    <AppShell role={access.role} workspaceName={access.workspace.name} displayName={access.displayName} email={access.email}>
      <PageHeader
        eyebrow="Workspace"
        title="Approved documents"
        description={isAdmin ? "Manage the private manuals, diagrams, bulletins, and fault-code sheets approved for this workspace." : "Open current approved maintenance sources available to your workspace."}
      />
      {isAdmin ? <DocumentManagement workspaceId={access.workspace.id} /> : <TechnicianDocuments workspaceId={access.workspace.id} />}
    </AppShell>
  );
}
