import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { FaultReportShell } from "../fault-report-shell";
import { FaultIntakeForm } from "./fault-intake-form";

export default async function NewFaultReportPage({
  searchParams,
}: {
  searchParams: Promise<{ equipment?: string }>;
}) {
  const [access, query] = await Promise.all([
    requireDashboardAccess("technician"),
    searchParams,
  ]);

  return (
    <FaultReportShell
      role={access.role}
      email={access.email}
      displayName={access.displayName}
      workspaceName={access.workspace.name}
    >
      <PageHeader
        eyebrow="Technician intake"
        title="Start a fault report"
        description="Record the observed condition and planned work. The report remains Draft until the mandatory Safety Gate is complete."
      />
      <FaultIntakeForm
        workspaceId={access.workspace.id}
        initialEquipmentId={query.equipment}
      />
    </FaultReportShell>
  );
}
