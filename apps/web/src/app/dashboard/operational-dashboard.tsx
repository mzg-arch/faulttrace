"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import {
  formatReportDate,
  type DashboardActivity,
  type DashboardReportSummary,
  type DashboardSummary,
  type FaultReportStatus,
  type WorkLogEntryType,
} from "./fault-report-types";


const ACTIVITY_LABELS: Record<WorkLogEntryType, string> = {
  observation: "Observation",
  action_taken: "Action taken",
  measurement: "Measurement",
  escalation: "Escalation",
  resolution: "Resolution",
};

const STATUS_CLASSES: Record<FaultReportStatus, string> = {
  active: "border-red-300/25 bg-red-300/5 text-red-200",
  draft: "border-amber-300/25 bg-amber-300/5 text-amber-100",
  resolved: "border-emerald-300/25 bg-emerald-300/5 text-emerald-100",
};

function reportHref(report: DashboardReportSummary) {
  return report.status === "resolved"
    ? `/dashboard/resolved-history/${report.id}`
    : `/dashboard/fault-reports/${report.id}`;
}

function activityHref(activity: DashboardActivity) {
  return activity.report_status === "resolved"
    ? `/dashboard/resolved-history/${activity.fault_report_id}`
    : `/dashboard/fault-reports/${activity.fault_report_id}`;
}

function ReportCard({
  report,
  showOwner,
}: {
  report: DashboardReportSummary;
  showOwner: boolean;
}) {
  const date = report.status === "resolved" && report.resolved_at
    ? report.resolved_at
    : report.updated_at;
  const description = report.status === "resolved" && report.resolution_summary
    ? report.resolution_summary
    : report.symptom;

  return (
    <li className="rounded-lg border border-white/10 bg-[#111315] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{report.equipment_name}</h3>
          <p className="mt-1 font-mono text-xs text-teal-200">{report.equipment_asset_tag ?? "Asset ID not assigned"}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_CLASSES[report.status]}`}>{report.status}</span>
      </div>
      <p className="mt-4 line-clamp-2 text-sm leading-6 text-zinc-300">{description}</p>
      <dl className="mt-4 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
        <div><dt className="sr-only">Fault code</dt><dd>{report.fault_code ? `Fault ${report.fault_code}` : "No fault code"}</dd></div>
        <div><dt className="sr-only">Last activity</dt><dd>{formatReportDate(date)}</dd></div>
        {showOwner && <div className="sm:col-span-2"><dt className="inline">Owner: </dt><dd className="inline text-zinc-400">{report.owner_name || "Technician"}</dd></div>}
      </dl>
      <Link href={reportHref(report)} className="mt-5 inline-flex cursor-pointer rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-teal-300/45 hover:bg-teal-300/[0.06] hover:text-teal-100">Open report</Link>
    </li>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-7 text-center">
      <p className="font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-500">{message}</p>
    </div>
  );
}

function ActivityList({ activity }: { activity: DashboardActivity[] }) {
  if (activity.length === 0) {
    return <EmptyPanel title="No recent case activity" message="Work-log entries and recorded resolutions will appear here." />;
  }
  return (
    <ol className="space-y-3">
      {activity.map((item) => (
        <li key={item.id} className="rounded-lg border border-white/10 bg-[#111315] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-200">{ACTIVITY_LABELS[item.entry_type]}</span>
            <span className="text-xs text-zinc-500">{formatReportDate(item.created_at)}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-white">{item.equipment_name}</p>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-300">{item.note}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <span>{item.author_name || "Technician"} · {item.equipment_asset_tag ?? "No asset ID"}</span>
            <Link href={activityHref(item)} className="font-semibold text-teal-200 hover:text-teal-100">Open</Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

function QuickLinks({ role }: { role: "admin" | "technician" }) {
  const links = role === "admin"
    ? [
        ["Team", "/dashboard/team"],
        ["Equipment", "/dashboard/equipment"],
        ["Documents", "/dashboard/documents"],
        ["Resolved history", "/dashboard/resolved-history"],
      ]
    : [
        ["Start fault report", "/dashboard/fault-reports/new"],
        ["Approved documents", "/dashboard/documents"],
        ["Equipment", "/dashboard/equipment"],
        ["Resolved history", "/dashboard/resolved-history"],
      ];
  return (
    <nav aria-label={`${role} dashboard quick links`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {links.map(([label, href]) => (
        <Link key={label} href={href} className="cursor-pointer rounded-lg border border-white/10 bg-[#151719] px-5 py-4 text-sm font-semibold text-zinc-200 transition-colors hover:border-teal-300/35 hover:bg-teal-300/[0.04] hover:text-teal-100">{label}<span aria-hidden="true" className="float-right text-teal-300">→</span></Link>
      ))}
    </nav>
  );
}

function TechnicianDashboard({ summary }: { summary: DashboardSummary }) {
  const myWork = useMemo(
    () => [...summary.recent_draft_reports, ...summary.recent_active_reports]
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)),
    [summary.recent_active_reports, summary.recent_draft_reports],
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-lg border border-teal-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="my-active-work-title">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-5">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Technician queue</p><h2 id="my-active-work-title" className="mt-2 text-2xl font-semibold text-white">My active work</h2></div>
            <Link href="/dashboard/fault-reports/new" className="rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] hover:bg-teal-200">Start fault report</Link>
          </div>
          <div className="pt-5">
            {myWork.length === 0 ? <EmptyPanel title="No open fault reports" message="Start a report when equipment needs investigation. Draft reports will return here for Safety Gate completion." /> : <ul className="grid gap-4 lg:grid-cols-2">{myWork.map((report) => <ReportCard key={report.id} report={report} showOwner={false} />)}</ul>}
          </div>
        </section>

        <section className="rounded-lg border border-emerald-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="technician-resolved-title">
          <div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Workspace memory</p><h2 id="technician-resolved-title" className="mt-2 text-2xl font-semibold text-white">Recent resolved cases</h2></div>
          <div className="pt-5">
            {summary.recent_resolved_reports.length === 0 ? <EmptyPanel title="No resolved cases yet" message="Completed reports will become shared, read-only workspace history." /> : <ul className="space-y-4">{summary.recent_resolved_reports.slice(0, 3).map((report) => <ReportCard key={report.id} report={report} showOwner />)}</ul>}
          </div>
        </section>
      </div>
      <section className="rounded-lg border border-white/10 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="technician-activity-title"><div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Latest records</p><h2 id="technician-activity-title" className="mt-2 text-xl font-semibold text-white">Recent case activity</h2></div><div className="pt-5"><ActivityList activity={summary.recent_activity} /></div></section>
    </div>
  );
}

function AdminDashboard({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-teal-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="workspace-active-title">
          <div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Read-only oversight</p><h2 id="workspace-active-title" className="mt-2 text-2xl font-semibold text-white">Workspace active faults</h2></div>
          <div className="pt-5">{summary.recent_active_reports.length === 0 ? <EmptyPanel title="No active workspace faults" message="Active technician reports will appear here after the Safety Gate is completed." /> : <ul className="grid gap-4">{summary.recent_active_reports.map((report) => <ReportCard key={report.id} report={report} showOwner />)}</ul>}</div>
        </section>
        <section className="rounded-lg border border-emerald-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="recent-resolutions-title">
          <div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Completed work</p><h2 id="recent-resolutions-title" className="mt-2 text-2xl font-semibold text-white">Recent resolutions</h2></div>
          <div className="pt-5">{summary.recent_resolved_reports.length === 0 ? <EmptyPanel title="No resolutions recorded" message="Technician resolution summaries will appear here as read-only records." /> : <ul className="grid gap-4">{summary.recent_resolved_reports.map((report) => <ReportCard key={report.id} report={report} showOwner />)}</ul>}</div>
        </section>
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-lg border border-red-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="affected-equipment-title">
          <div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-200">Current impact</p><h2 id="affected-equipment-title" className="mt-2 text-xl font-semibold text-white">Equipment currently affected</h2></div>
          <div className="pt-5">{summary.equipment_with_active_reports.length === 0 ? <EmptyPanel title="No affected equipment" message="Equipment with Active reports will be listed here." /> : <ul className="space-y-3">{summary.equipment_with_active_reports.map((equipment) => <li key={equipment.id} className="rounded-lg border border-white/10 bg-[#111315] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{equipment.name}</p><p className="mt-1 font-mono text-xs text-teal-200">{equipment.asset_tag ?? "No asset ID"}</p>{equipment.location && <p className="mt-2 text-xs text-zinc-500">{equipment.location}</p>}</div><span className="rounded-md border border-red-300/20 bg-red-300/5 px-2.5 py-1 text-xs font-semibold text-red-100">{equipment.active_report_count} active</span></div></li>)}</ul>}</div>
        </section>
        <section className="rounded-lg border border-white/10 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="admin-activity-title"><div className="border-b border-white/10 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Technician records</p><h2 id="admin-activity-title" className="mt-2 text-xl font-semibold text-white">Recent activity</h2></div><div className="pt-5"><ActivityList activity={summary.recent_activity} /></div></section>
      </div>
    </div>
  );
}

export function OperationalDashboard({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: "admin" | "technician";
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/dashboard-summary`);
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Operational dashboard could not be loaded."));
      const payload = (await response.json()) as DashboardSummary;
      if (payload.role !== role) throw new Error("Workspace role could not be verified for this dashboard.");
      setSummary(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Operational dashboard could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [role, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  return (
    <section id="operations" className="space-y-6 pb-4" aria-label="Operational dashboard">
      <div className="flex justify-end">
        <button type="button" onClick={() => void loadSummary()} disabled={isLoading} className="ft-button-secondary cursor-pointer">{isLoading ? "Refreshing..." : "Refresh dashboard"}</button>
      </div>

      <QuickLinks role={role} />

      {isLoading && !summary && <p role="status" className="rounded-lg border border-white/10 bg-[#151719]/90 p-6 text-sm text-zinc-400">Loading authorized dashboard activity...</p>}
      {error && <div role="alert" className="rounded-lg border border-red-300/25 bg-red-300/5 p-5 text-sm text-red-100"><p>{error}</p><button type="button" onClick={() => void loadSummary()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button></div>}
      {summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-red-300/15 bg-[#151719] p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-200">Active reports</p><p className="mt-3 text-4xl font-semibold text-white">{summary.active_report_count}</p><p className="mt-2 text-sm text-zinc-400">{role === "admin" ? "Across this workspace" : "Owned by you"}</p></div>
            <div className="rounded-lg border border-amber-300/15 bg-amber-300/5 p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-100">Draft reports</p><p className="mt-3 text-4xl font-semibold text-white">{summary.draft_report_count}</p><p className="mt-2 text-sm text-zinc-400">{role === "admin" ? "Awaiting technician activation" : "Awaiting your Safety Gate"}</p></div>
            <div className="rounded-lg border border-emerald-300/15 bg-[#151719] p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">Resolved reports</p><p className="mt-3 text-4xl font-semibold text-white">{summary.resolved_report_count}</p><p className="mt-2 text-sm text-zinc-400">Shared workspace history</p></div>
          </div>
          {role === "admin" ? <AdminDashboard summary={summary} /> : <TechnicianDashboard summary={summary} />}
        </>
      )}
    </section>
  );
}
