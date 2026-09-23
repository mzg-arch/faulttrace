"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import {
  SAFETY_ACKNOWLEDGEMENTS,
  formatReportDate,
  type CitedStatement,
  type EvidenceRetrievalResponse,
  type FaultReport,
  type GuidancePlan,
} from "../../fault-report-types";
import { DOCUMENT_TYPE_LABELS } from "../../document-types";

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

function ApprovedEvidence({
  workspaceId,
  reportId,
}: {
  workspaceId: string;
  reportId: string;
}) {
  const [result, setResult] = useState<EvidenceRetrievalResponse | null>(null);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);

  async function retrieveEvidence() {
    if (isRetrieving) return;
    setIsRetrieving(true);
    setRetrievalError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}/evidence/retrieve`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Approved evidence could not be retrieved."));
      }
      setResult((await response.json()) as EvidenceRetrievalResponse);
    } catch (error) {
      setRetrievalError(error instanceof Error ? error.message : "Approved evidence could not be retrieved.");
    } finally {
      setIsRetrieving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-cyan-300/15 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="approved-evidence-title">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Deterministic PDF retrieval</p>
          <h2 id="approved-evidence-title" className="mt-2 text-2xl font-semibold text-white">Approved evidence</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Search readable text from approved workspace PDFs using this report and equipment. Results are verbatim excerpts, not instructions or a diagnosis.</p>
        </div>
        <button type="button" onClick={() => void retrieveEvidence()} disabled={isRetrieving} className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">{isRetrieving ? "Retrieving evidence..." : result ? "Retrieve again" : "Retrieve approved evidence"}</button>
      </div>

      {retrievalError && <div role="alert" className="mt-6 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><p>{retrievalError}</p><button type="button" onClick={() => void retrieveEvidence()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button></div>}
      {isRetrieving && <p role="status" className="mt-6 rounded-xl border border-white/10 p-4 text-sm text-slate-400">Searching indexed approved PDF excerpts...</p>}
      {!isRetrieving && !retrievalError && !result && <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-6 text-center"><p className="font-medium text-slate-200">Evidence has not been retrieved for this case.</p><p className="mt-2 text-sm leading-6 text-slate-500">Retrieval returns only matching excerpts from approved PDFs that an administrator has indexed.</p></div>}
      {!isRetrieving && !retrievalError && result && result.evidence.length === 0 && <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-6"><p className="font-semibold text-amber-100">No approved evidence found</p><p className="mt-2 text-sm leading-6 text-amber-100/75">{result.message}</p></div>}
      {!isRetrieving && !retrievalError && result && result.evidence.length > 0 && (
        <div className="mt-6">
          <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-4 py-3 text-sm font-semibold text-cyan-100">Approved source excerpts - review the original procedure before acting.</p>
          <ul className="mt-4 space-y-4">
            {result.evidence.map((evidence) => (
              <li key={evidence.chunk_id} className="rounded-2xl border border-white/10 bg-[#091522] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{evidence.document_title}</h3>
                    <p className="mt-1 text-xs text-slate-400">C{evidence.chunk_id} · {DOCUMENT_TYPE_LABELS[evidence.document_type]} · {evidence.source_revision ?? "Revision not provided"} · Page {evidence.page_number}</p>
                  </div>
                  {evidence.equipment_linked && <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200">Linked equipment</span>}
                </div>
                <blockquote className="mt-4 border-l-2 border-cyan-300/40 pl-4 text-sm leading-7 text-slate-200">{evidence.excerpt}</blockquote>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-600">Verbatim extracted PDF text · temporary source link</span>
                  <a href={`${evidence.source_url}#page=${evidence.page_number}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60">Open source document</a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function CitationChips({
  citationIds,
  plan,
}: {
  citationIds: number[];
  plan: GuidancePlan;
}) {
  const availableIds = new Set(plan.evidence.map((item) => item.chunk_id));
  return (
    <span className="inline-flex flex-wrap gap-1.5" aria-label="Supporting citations">
      {citationIds.map((citationId) => (
        availableIds.has(citationId) ? (
          <a key={citationId} href={`#guidance-evidence-${citationId}`} className="rounded-md border border-cyan-300/25 bg-cyan-300/5 px-2 py-1 text-[11px] font-bold text-cyan-100 hover:border-cyan-300/60">C{citationId}</a>
        ) : (
          <span key={citationId} className="rounded-md border border-amber-300/25 px-2 py-1 text-[11px] font-bold text-amber-100">C{citationId}</span>
        )
      ))}
    </span>
  );
}

function CitedList({
  items,
  plan,
}: {
  items: CitedStatement[];
  plan: GuidancePlan;
}) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((item, index) => (
        <li key={`${item.text}-${index}`} className="rounded-xl border border-white/10 bg-[#091522] p-4 text-sm leading-7 text-slate-200">
          <p>{item.text}</p>
          <div className="mt-3"><CitationChips citationIds={item.citation_ids} plan={plan} /></div>
        </li>
      ))}
    </ul>
  );
}

function GuidancePlanSection({
  workspaceId,
  reportId,
  role,
}: {
  workspaceId: string;
  reportId: string;
  role: "admin" | "technician";
}) {
  const [plan, setPlan] = useState<GuidancePlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}/guidance-plan`,
      );
      if (response.status === 404) {
        setPlan(null);
        return;
      }
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Saved guidance could not be loaded."));
      }
      setPlan((await response.json()) as GuidancePlan);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Saved guidance could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [reportId, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPlan(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPlan]);

  async function generatePlan() {
    if (role !== "technician" || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}/guidance-plan/generate`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Evidence-grounded guidance could not be generated."));
      }
      setPlan((await response.json()) as GuidancePlan);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Evidence-grounded guidance could not be generated.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="rounded-3xl border border-violet-300/15 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="guidance-plan-title">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Evidence-grounded plan</p>
          <h2 id="guidance-plan-title" className="mt-2 text-2xl font-semibold text-white">Safety brief and guided checks</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Generated only from the active report and server-retrieved approved PDF excerpts. Every grounded statement links to its exact evidence chunk.</p>
        </div>
        {role === "technician" && (
          <button type="button" onClick={() => void generatePlan()} disabled={isGenerating || isLoading} className="shrink-0 rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-[#07111c] hover:bg-violet-200 disabled:cursor-wait disabled:opacity-60">{isGenerating ? "Validating grounded guidance..." : plan ? "Generate updated guidance" : "Generate evidence-grounded guidance"}</button>
        )}
      </div>

      <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-xs leading-6 text-amber-100/85">FaultTrace does not replace current site procedures, formal LOTO or isolation requirements, authorization, required PPE, emergency escalation, or qualified technician judgment. Stop and escalate whenever conditions are unsafe or uncertain.</p>
      {role === "admin" && <p className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100">Read-only administrator view. Only the technician who owns this report can generate a plan.</p>}
      {isLoading && <p role="status" className="mt-6 rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading the latest saved guidance plan...</p>}
      {error && <div role="alert" className="mt-6 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><p>{error}</p><button type="button" onClick={() => void loadPlan()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Retry loading saved plan</button></div>}
      {!isLoading && !error && !plan && <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-6 text-center"><p className="font-medium text-slate-200">No saved guidance plan exists for this case.</p><p className="mt-2 text-sm leading-6 text-slate-500">{role === "technician" ? "Generate a plan after approved PDF evidence has been indexed." : "The report technician has not generated a plan yet."}</p></div>}

      {!isLoading && plan?.status === "insufficient_evidence" && (
        <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">Insufficient approved evidence</p>
          <p className="mt-3 text-sm leading-7 text-amber-50">{plan.case_summary.text}</p>
          <p className="mt-3 text-xs leading-6 text-amber-100/70">No safety brief, guided checks, or maintenance recommendations were produced.</p>
        </div>
      )}

      {!isLoading && plan?.status === "grounded" && (
        <div className="mt-6 space-y-7">
          <div className="rounded-2xl border border-violet-300/15 bg-violet-300/5 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-200">Case summary</p>
            <p className="mt-3 text-sm leading-7 text-slate-100">{plan.case_summary.text}</p>
            <div className="mt-3"><CitationChips citationIds={plan.case_summary.citation_ids} plan={plan} /></div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Safety Brief</h3>
            <CitedList items={plan.safety_brief_items} plan={plan} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Guided Checks</h3>
            <ol className="mt-4 space-y-4">
              {plan.guided_checks.map((check, index) => (
                <li key={`${check.title}-${index}`} className="rounded-2xl border border-white/10 bg-[#091522] p-5">
                  <div className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-300/10 text-xs font-bold text-violet-200">{index + 1}</span><div><h4 className="font-semibold text-white">{check.title}</h4><p className="mt-2 text-sm leading-7 text-slate-200">{check.supported_action}</p><div className="mt-3"><CitationChips citationIds={check.citation_ids} plan={plan} /></div></div></div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Escalation criteria</h3>
            <CitedList items={plan.escalation_criteria} plan={plan} />
          </div>
        </div>
      )}

      {!isLoading && plan && plan.evidence.length > 0 && (
        <div className="mt-8 border-t border-white/10 pt-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold text-white">Saved evidence snapshot</h3><span className="text-xs text-slate-500">Generated {formatReportDate(plan.created_at)}</span></div>
          <p className="mt-2 text-xs leading-6 text-slate-500">These exact excerpts were considered when this saved plan was generated. Confirm the source is still approved before acting.</p>
          <ul className="mt-4 space-y-3">
            {plan.evidence.map((evidence) => (
              <li id={`guidance-evidence-${evidence.chunk_id}`} key={evidence.chunk_id} className="scroll-mt-6 rounded-2xl border border-white/10 bg-[#091522] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">C{evidence.chunk_id} · {evidence.document_title}</p><p className="mt-1 text-xs text-slate-400">{DOCUMENT_TYPE_LABELS[evidence.document_type]} · {evidence.source_revision ?? "Revision not provided"} · Page {evidence.page_number}</p></div>{evidence.equipment_linked && <span className="rounded-full border border-emerald-300/20 px-2.5 py-1 text-xs font-semibold text-emerald-200">Linked equipment</span>}</div>
                <blockquote className="mt-4 border-l-2 border-violet-300/40 pl-4 text-sm leading-7 text-slate-200">{evidence.excerpt}</blockquote>
                <div className="mt-4 text-right">{evidence.source_available && evidence.source_url ? <a href={`${evidence.source_url}#page=${evidence.page_number}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-cyan-100 hover:text-cyan-200">Open approved source</a> : <span className="text-xs text-amber-200">Source is no longer currently approved for opening</span>}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ActiveCase({
  report,
  role,
  workspaceId,
}: {
  report: FaultReport;
  role: "admin" | "technician";
  workspaceId: string;
}) {
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

      <ApprovedEvidence workspaceId={workspaceId} reportId={report.id} />

      <GuidancePlanSection workspaceId={workspaceId} reportId={report.id} role={role} />

      <section className="rounded-2xl border border-white/10 bg-[#101e2d]/85 p-6" aria-label="Work log placeholder">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Placeholder</span>
        <h2 className="mt-4 text-lg font-semibold text-white">Work log</h2>
        <p className="mt-3 text-sm leading-7 text-slate-400">Findings, measurements, actions, and handoff notes will be recorded here later.</p>
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
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}`,
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
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}/activate`,
        {
          method: "POST",
          headers: {
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
  if (report.status === "active") {
    return <ActiveCase report={report} role={role} workspaceId={workspaceId} />;
  }

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
