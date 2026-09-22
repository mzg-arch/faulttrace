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
    <FaultReportShell email={access.email} workspaceName={access.workspace.name}>
      <section className="pb-8 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Technician fault intake</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Start a fault report</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">Record the observed condition and planned work. This intake does not provide safety advice and remains Draft until the mandatory Safety Gate is complete.</p>
      </section>
      <FaultIntakeForm
        workspaceId={access.workspace.id}
        initialEquipmentId={query.equipment}
      />
    </FaultReportShell>
  );
}
