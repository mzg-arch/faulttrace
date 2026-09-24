import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { requireDashboardAccess } from "@/lib/dashboard-access";
import { AppShell } from "../app-shell";
import { EquipmentManagement } from "../equipment-management";
import { TechnicianEquipment } from "../technician-equipment";

export default async function EquipmentPage() {
  const access = await requireDashboardAccess();
  const isAdmin = access.role === "admin";
  return (
    <AppShell role={access.role} workspaceName={access.workspace.name} displayName={access.displayName} email={access.email}>
      <PageHeader
        eyebrow="Workspace"
        title="Equipment"
        description={isAdmin ? "Maintain workspace equipment records and archive assets that are no longer in service." : "Find active equipment and start a fault report for the asset you are working on."}
        action={!isAdmin ? <Link href="/dashboard/fault-reports/new" className="ft-button-primary">Start fault report</Link> : undefined}
      />
      {isAdmin ? <EquipmentManagement workspaceId={access.workspace.id} /> : <TechnicianEquipment workspaceId={access.workspace.id} />}
    </AppShell>
  );
}
