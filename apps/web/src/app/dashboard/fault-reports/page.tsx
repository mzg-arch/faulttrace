import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { AppShell } from "../app-shell";
import { FaultReportsOverview } from "../fault-reports-overview";

export default async function FaultReportsPage() {
  const access = await requireDashboardAccess();
  const isTechnician = access.role === "technician";
  return (
    <AppShell role={access.role} workspaceName={access.workspace.name} displayName={access.displayName} email={access.email}>
      <PageHeader
        eyebrow="Work"
        title="Fault reports"
        description={isTechnician ? "Resume your Draft and Active cases or review completed work." : "Review technician fault reports across this workspace. Case actions remain read-only for administrators."}
        action={isTechnician ? <Link href="/dashboard/fault-reports/new" className="ft-button-primary">Start fault report</Link> : undefined}
      />
      <FaultReportsOverview workspaceId={access.workspace.id} role={access.role} />
    </AppShell>
  );
}
