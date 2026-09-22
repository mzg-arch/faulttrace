"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, getAccessToken } from "@/lib/faulttrace-api";
import {
  SAFETY_ACKNOWLEDGEMENTS,
  formatReportDate,
  type FaultReport,
} from "../../fault-report-types";

type SafetyKey = (typeof SAFETY_ACKNOWLEDGEMENTS)[number]["key"];
type SafetyState = Record<SafetyKey, boolean>;

const EMPTY_ACKNOWLEDGEMENTS: SafetyState = {
  ack_authorized_qualified: false,
  ack_loto_isolation: false,
  ack_ppe_stored_energy: false,
  ack_stop_escalate: false,
};

function ReportDetails({ report }: { report: FaultReport }) {
  const details = [
    ["Equipment", `${report.equipment_name}${report.equipment_asset_tag ? ` (${report.equipment_asset_tag})` : ""}`],
    ["Fault code", report.fault_code ?? "Not provided"],
    ["Symptom / issue", report.symptom],
    ["Planned task", report.planned_task ?? "Not provided"],
    ["Operating context", report.operating_context ?? "Not provided"],
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {details.map(([label, value], index) => (
        <div key={label} className={index > 1 ? "rounded-2xl border border-white/10 bg-[#091522] p-5 sm:col-span-2" : "rounded-2xl border border-white/10 bg-[#091522] p-5"}>
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
          <dd className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-200">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActiveCase({ report, role }: { report: FaultReport; role: "admin" | "technician" }) {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-emerald-300/20 bg-[#101e2d]/95 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Active troubleshooting case</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">{report.equipment_name}</h1>
            <p className="mt-2 text-sm text-slate-400">Created {formatReportDate(report.created_at)}{report.technician_name ? ` by ${report.technician_name}` : ""}</p>
          </div>
          <span className="rounded-full border border-emerald-300/25 bg-emerald-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-emerald-200">Active</span>
        </div>
        {role === "admin" && <p className="mt-5 rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100">Read-only administrator view for this workspace report.</p>}
        <div className="mt-7"><ReportDetails report={report} /></div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="completed-safety-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Pre-task record</p>
            <h2 id="completed-safety-title" className="mt-2 text-2xl font-semibold text-white">Safety Gate completed</h2>
          </div>
          <span className="text-xs text-slate-500">{report.activated_at ? formatReportDate(report.activated_at) : "Completion recorded"}</span>
        </div>
        <ul className="mt-6 grid gap-3 md:grid-cols-2">
          {SAFETY_ACKNOWLEDGEMENTS.map((item) => (
            <li key={item.key} className="flex gap-3 rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-4 text-sm leading-6 text-slate-200">
              <span aria-hidden="true" className="mt-0.5 text-emerald-300">✓</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-xs leading-6 text-slate-500">These acknowledgements record the pre-task gate. They do not replace current site procedures, permits, formal LOTO or isolation requirements, or professional judgment. Historical cases and automated output never override current approved procedures.</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="Case workspace placeholders">
        {[
          ["Approved evidence", "Approved workspace sources will be connected to this case in a later milestone."],
          ["Guided checks", "Evidence-supported troubleshooting steps have not been generated for this case."],
          ["Work log", "Findings, measurements, actions, and handoff notes will be recorded here later."],
        ].map(([title, description]) => (
          <article key={title} className="rounded-2xl border border-white/10 bg-[#101e2d]/85 p-6">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Placeholder</span>
            <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

export function FaultCase({
  workspaceId,
  reportId,
  role,
}: {
  workspaceId: string;
  reportId: string;
  role: "admin" | "technician";
}) {
  const [report, setReport] = useState<FaultReport | null>(null);
  const [acknowledgements, setAcknowledgements] = useState<SafetyState>(EMPTY_ACKNOWLEDGEMENTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Fault report could not be loaded."));
      }
      setReport((await response.json()) as FaultReport);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Fault report could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [reportId, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  const allAcknowledged = useMemo(
    () => Object.values(acknowledgements).every(Boolean),
    [acknowledgements],
  );

  async function activateCase() {
    if (!allAcknowledged || isActivating) return;
    setIsActivating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}/activate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(acknowledgements),
        },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Safety Gate could not be completed."));
      }
      setReport((await response.json()) as FaultReport);
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Safety Gate could not be completed.");
    } finally {
      setIsActivating(false);
    }
  }

  if (isLoading) {
    return <p role="status" className="rounded-2xl border border-white/10 bg-[#101e2d] p-6 text-sm text-slate-400">Loading fault report...</p>;
  }

  if (error && !report) {
    return (
      <div role="alert" className="rounded-2xl border border-amber-300/25 bg-amber-300/5 p-6 text-sm text-amber-100">
        <p>{error}</p>
        <button type="button" onClick={() => void loadReport()} className="mt-4 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button>
      </div>
    );
  }

  if (!report) return null;
  if (report.status === "active") return <ActiveCase report={report} role={role} />;

  if (role === "admin") {
    return (
      <section className="rounded-3xl border border-amber-300/20 bg-[#101e2d]/95 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Read-only administrator view</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">Safety Gate pending</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">This technician report remains Draft. Only the technician who created it can complete the mandatory acknowledgements and activate the case.</p>
          </div>
          <span className="rounded-full border border-amber-300/25 bg-amber-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-100">Draft</span>
        </div>
        <div className="mt-7"><ReportDetails report={report} /></div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-amber-300/20 bg-[#101e2d]/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Mandatory pre-task gate</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Safety Gate</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">Review the fault intake and personally complete every acknowledgement before beginning the case.</p>
        </div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-100">Draft</span>
      </div>

      <div className="mt-7"><ReportDetails report={report} /></div>

      <div className="mt-8 rounded-2xl border border-red-300/20 bg-red-300/5 p-5">
        <h2 className="font-semibold text-red-100">Site procedures remain controlling</h2>
        <p className="mt-2 text-sm leading-7 text-red-100/80">This Safety Gate records your acknowledgement. It is not a replacement for current site procedures, work permits, authorization requirements, formal LOTO or isolation procedures, hazard assessments, PPE requirements, or professional judgment. Historical cases and automated output never override current approved procedures. Stop and escalate whenever conditions are unsafe or uncertain.</p>
      </div>

      <fieldset className="mt-7 space-y-3">
        <legend className="mb-4 text-lg font-semibold text-white">Required acknowledgements</legend>
        {SAFETY_ACKNOWLEDGEMENTS.map((item) => (
          <label key={item.key} className="flex cursor-pointer gap-4 rounded-2xl border border-white/10 bg-[#091522] p-5 transition hover:border-cyan-300/30">
            <input
              type="checkbox"
              checked={acknowledgements[item.key]}
              onChange={(event) => setAcknowledgements((current) => ({ ...current, [item.key]: event.target.checked }))}
              disabled={isActivating}
              className="mt-1 size-5 shrink-0 accent-cyan-300"
            />
            <span className="text-sm leading-7 text-slate-200">{item.label}</span>
          </label>
        ))}
      </fieldset>

      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{error}</p>}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
        <p className="text-xs text-slate-500">All four acknowledgements are required to change this report from Draft to Active.</p>
        <button type="button" onClick={() => void activateCase()} disabled={!allAcknowledged || isActivating} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{isActivating ? "Activating case..." : "Acknowledge and begin case"}</button>
      </div>
    </section>
  );
}
