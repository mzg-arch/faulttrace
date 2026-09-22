"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { API_ORIGIN, apiErrorMessage, getAccessToken } from "@/lib/faulttrace-api";
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
      const token = await getAccessToken();
      const response = await fetch(`${API_ORIGIN}/workspaces/${workspaceId}/fault-reports`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    <section className="my-10 rounded-3xl border border-cyan-300/15 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby={`${role}-fault-reports-title`}>
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{isAdmin ? "Read-only workspace visibility" : "Your current work"}</p>
          <h2 id={`${role}-fault-reports-title`} className="mt-2 text-2xl font-semibold text-white">{isAdmin ? "Active fault reports" : "Fault reports"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{isAdmin ? "Review Draft and Active technician reports in this workspace. Case controls remain with the assigned technician." : "Resume a Draft Safety Gate or return to one of your Active troubleshooting cases."}</p>
        </div>
        {!isAdmin && <Link href="/dashboard/fault-reports/new" className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-center text-sm font-bold text-[#07111c] hover:bg-cyan-200">Start fault report</Link>}
      </div>

      <div className="pt-7">
        {isLoading && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading fault reports...</p>}
        {loadError && <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><p>{loadError}</p><button type="button" onClick={() => void loadReports()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button></div>}
        {!isLoading && !loadError && reports.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-7 text-center">
            <p className="font-medium text-slate-200">{isAdmin ? "No Draft or Active fault reports are available." : "You have not started a fault report."}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{isAdmin ? "Technician reports from this workspace will appear here." : "Select active equipment or start a new report when a fault needs investigation."}</p>
          </div>
        )}
        {!isLoading && !loadError && reports.length > 0 && (
          <ul className="grid gap-4 lg:grid-cols-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded-2xl border border-white/10 bg-[#091522] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{report.equipment_name}</h3>
                    <p className="mt-1 font-mono text-xs text-cyan-200">{report.equipment_asset_tag ?? "Asset ID not assigned"}</p>
                  </div>
                  <span className={report.status === "active" ? "rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200" : "rounded-full border border-amber-300/20 bg-amber-300/5 px-2.5 py-1 text-xs font-semibold text-amber-100"}>{report.status}</span>
                </div>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">{report.symptom}</p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>{report.fault_code ? `Fault ${report.fault_code}` : "No fault code"}</span>
                  <span>{formatReportDate(report.created_at)}</span>
                  {isAdmin && <span>{report.technician_name || "Technician"}</span>}
                </div>
                <Link href={`/dashboard/fault-reports/${report.id}`} className="mt-5 inline-flex rounded-xl border border-cyan-300/25 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-300/5">{report.status === "draft" && !isAdmin ? "Complete Safety Gate" : "View report"}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
