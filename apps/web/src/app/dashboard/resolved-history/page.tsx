import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { FaultReportShell } from "../fault-reports/fault-report-shell";
import { ResolvedHistory } from "./resolved-history";

export default async function ResolvedHistoryPage() {
  const access = await requireDashboardAccess();

  return (
    <FaultReportShell
      role={access.role}
      email={access.email}
      displayName={access.displayName}
      workspaceName={access.workspace.name}
      sectionLabel="Resolved history"
      sectionHref="/dashboard/resolved-history"
    >
      <PageHeader
        eyebrow="Workspace case record"
        title="Resolved history"
        description="Search completed fault reports and review recorded outcomes, work logs, evidence citations, and saved guidance."
      />
      <ResolvedHistory workspaceId={access.workspace.id} />
    </FaultReportShell>
  );
}
