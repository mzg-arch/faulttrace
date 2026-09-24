"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import { formatReportDate, type FaultReport } from "./fault-report-types";

export function FaultReportsOverview({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: "admin" | "technician";
}) {
  const [reports, setReports] = useState<FaultReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/fault-reports`);
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Fault reports could not be loaded."));
      }
      setReports((await response.json()) as FaultReport[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Fault reports could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReports(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReports]);

  const isAdmin = role === "admin";

  return (
    <section className="rounded-lg border border-white/10 bg-[#151719] p-5 sm:p-6" aria-labelledby={`${role}-fault-reports-title`}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">{isAdmin ? "Read-only workspace visibility" : "Your current work"}</p>
          <h2 id={`${role}-fault-reports-title`} className="mt-2 text-xl font-semibold text-white">Report register</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{isAdmin ? "Review Draft, Active, and Resolved technician reports in this workspace. Case controls remain with the assigned technician." : "Resume a Draft Safety Gate, return to an Active case, or review a Resolved report."}</p>
        </div>
      </div>

      <div className="pt-7">
        {isLoading && <p role="status" className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">Loading fault reports...</p>}
        {loadError && <div role="alert" className="rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100"><p>{loadError}</p><button type="button" onClick={() => void loadReports()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button></div>}
        {!isLoading && !loadError && reports.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-7 text-center">
            <p className="font-medium text-zinc-200">{isAdmin ? "No fault reports are available." : "You have not started a fault report."}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">{isAdmin ? "Technician reports from this workspace will appear here." : "Select active equipment or start a new report when a fault needs investigation."}</p>
          </div>
        )}
        {!isLoading && !loadError && reports.length > 0 && (
          <ul className="grid gap-4 lg:grid-cols-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded-lg border border-white/10 bg-[#111315] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{report.equipment_name}</h3>
                    <p className="mt-1 font-mono text-xs text-teal-200">{report.equipment_asset_tag ?? "Asset ID not assigned"}</p>
                  </div>
                  <span className={report.status === "active" ? "rounded-md border border-red-300/25 bg-red-300/5 px-2.5 py-1 text-xs font-semibold capitalize text-red-200" : report.status === "resolved" ? "rounded-md border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold capitalize text-emerald-100" : "rounded-md border border-amber-300/20 bg-amber-300/5 px-2.5 py-1 text-xs font-semibold capitalize text-amber-100"}>{report.status}</span>
                </div>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-zinc-300">{report.symptom}</p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>{report.fault_code ? `Fault ${report.fault_code}` : "No fault code"}</span>
                  <span>{formatReportDate(report.created_at)}</span>
                  {isAdmin && <span>{report.technician_name || "Technician"}</span>}
                </div>
                <Link href={`/dashboard/fault-reports/${report.id}`} className="mt-5 inline-flex cursor-pointer rounded-md border border-white/15 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:border-teal-300/45 hover:bg-teal-300/[0.06] hover:text-teal-100">{report.status === "draft" && !isAdmin ? "Complete Safety Gate" : "Open report"}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
