import { requireDashboardAccess } from "@/lib/dashboard-access";
import { FaultReportShell } from "../fault-report-shell";
import { FaultCase } from "./fault-case";

export default async function FaultReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const [access, route] = await Promise.all([
    requireDashboardAccess(),
    params,
  ]);

  return (
    <FaultReportShell email={access.email} workspaceName={access.workspace.name}>
      <FaultCase
        workspaceId={access.workspace.id}
        reportId={route.reportId}
        role={access.role}
      />
    </FaultReportShell>
  );
}
