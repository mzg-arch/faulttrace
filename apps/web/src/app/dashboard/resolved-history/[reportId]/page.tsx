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
      email={access.email}
      workspaceName={access.workspace.name}
      sectionLabel="Resolved history"
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
