import { requireDashboardAccess } from "@/lib/dashboard-access";
import { FaultReportShell } from "../fault-reports/fault-report-shell";
import { ResolvedHistory } from "./resolved-history";

export default async function ResolvedHistoryPage() {
  const access = await requireDashboardAccess();

  return (
    <FaultReportShell
      email={access.email}
      workspaceName={access.workspace.name}
      sectionLabel="Resolved history"
    >
      <section className="pb-8 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-200">Workspace case record</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Resolved history</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">Search completed fault reports from this workspace and review their recorded outcome, work log, saved evidence citations, and guidance plan.</p>
      </section>
      <ResolvedHistory workspaceId={access.workspace.id} />
    </FaultReportShell>
  );
}
