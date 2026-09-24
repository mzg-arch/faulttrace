import { requireDashboardAccess } from "@/lib/dashboard-access";
import { FaultCase } from "../../fault-reports/[reportId]/fault-case";
import { FaultReportShell } from "../../fault-reports/fault-report-shell";

export default async function ResolvedReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const [access, route] = await Promise.all([
    requireDashboardAccess(),
    params,
  ]);

  return (
    <FaultReportShell
      role={access.role}
      email={access.email}
      displayName={access.displayName}
      workspaceName={access.workspace.name}
      sectionLabel="Resolved history"
      sectionHref="/dashboard/resolved-history"
    >
      <FaultCase
        workspaceId={access.workspace.id}
        reportId={route.reportId}
        role={access.role}
        resolvedHistory
      />
    </FaultReportShell>
  );
}
