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
  type WorkLogEntry,
  type WorkLogEntryType,
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

const WORK_LOG_TYPE_LABELS: Record<WorkLogEntryType, string> = {
  observation: "Observation",
  action_taken: "Action taken",
  measurement: "Measurement",
  escalation: "Escalation",
  resolution: "Resolution",
};

const MANUAL_WORK_LOG_OPTIONS = [
  "observation",
  "action_taken",
  "measurement",
  "escalation",
] as const;

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

function WorkLogSection({
  report,
  role,
  workspaceId,
  onReportResolved,
}: {
  report: FaultReport;
  role: "admin" | "technician";
  workspaceId: string;
  onReportResolved: (report: FaultReport) => void;
}) {
  const [entries, setEntries] = useState<WorkLogEntry[]>([]);
  const [entryType, setEntryType] = useState<(typeof MANUAL_WORK_LOG_OPTIONS)[number]>("observation");
  const [note, setNote] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");
  const [resolutionConfirmed, setResolutionConfirmed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/work-logs`,
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The work log could not be loaded."));
      }
      setEntries((await response.json()) as WorkLogEntry[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The work log could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [report.id, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadEntries(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEntries]);

  async function addEntry() {
    const normalizedNote = note.trim();
    if (!normalizedNote || isAdding || report.status !== "active" || role !== "technician") return;
    setIsAdding(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/work-logs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_type: entryType, note: normalizedNote }),
        },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The work-log entry could not be recorded."));
      }
      const createdEntry = (await response.json()) as WorkLogEntry;
      setEntries((current) => [...current, createdEntry]);
      setNote("");
      setSuccess("Work-log entry recorded.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The work-log entry could not be recorded.");
    } finally {
      setIsAdding(false);
    }
  }

  async function resolveReport() {
    const normalizedSummary = resolutionSummary.trim();
    if (!normalizedSummary || !resolutionConfirmed || isResolving || report.status !== "active" || role !== "technician") return;
    setIsResolving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution_summary: normalizedSummary }),
        },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The fault report could not be resolved."));
      }
      const resolvedReport = (await response.json()) as FaultReport;
      onReportResolved(resolvedReport);
      setResolutionSummary("");
      setResolutionConfirmed(false);
      setSuccess("Fault report resolved and the outcome was added to the work log.");
      await loadEntries();
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "The fault report could not be resolved.");
    } finally {
      setIsResolving(false);
    }
  }

  const isResolved = report.status === "resolved";

  return (
    <section className="rounded-3xl border border-white/10 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="work-log-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Append-only case record</p>
          <h2 id="work-log-title" className="mt-2 text-2xl font-semibold text-white">Work Log</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Record observations, actions, measurements, and escalations in chronological order. Entries remain part of the case audit history.</p>
        </div>
        <span className={isResolved ? "rounded-full border border-violet-300/25 bg-violet-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-violet-100" : "rounded-full border border-emerald-300/25 bg-emerald-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-emerald-200"}>{isResolved ? "Resolved" : "Active"}</span>
      </div>

      {role === "admin" && <p className="mt-5 rounded-xl border border-cyan-300/15 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100">Read-only administrator view. Work-log entries and resolution controls belong to the report technician.</p>}
      {isResolved && report.resolution_summary && (
        <div className="mt-5 rounded-2xl border border-violet-300/20 bg-violet-300/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-violet-100">Recorded resolution</h3>
            <span className="text-xs text-violet-100/60">{report.resolved_at ? formatReportDate(report.resolved_at) : "Resolution time recorded"}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">{report.resolution_summary}</p>
        </div>
      )}

      {isLoading && <p role="status" className="mt-6 rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading work-log entries...</p>}
      {error && <div role="alert" className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><p>{error}</p><button type="button" onClick={() => void loadEntries()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Reload work log</button></div>}
      {success && <p role="status" className="mt-5 rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}

      {!isLoading && entries.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-6 text-center">
          <p className="font-medium text-slate-200">No work-log entries yet.</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{role === "technician" && !isResolved ? "Record the first supported observation, action, measurement, or escalation." : "Technician activity will appear here as it is recorded."}</p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <ol className="relative mt-7 space-y-5 border-l border-white/10 pl-6">
          {entries.map((entry) => (
            <li key={entry.id} className="relative rounded-2xl border border-white/10 bg-[#091522] p-5">
              <span aria-hidden="true" className={`absolute -left-[31px] top-6 size-3 rounded-full border-2 border-[#101e2d] ${entry.entry_type === "resolution" ? "bg-violet-300" : entry.entry_type === "escalation" ? "bg-amber-300" : "bg-cyan-300"}`} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200">{WORK_LOG_TYPE_LABELS[entry.entry_type]}</span>
                <span className="text-xs text-slate-500">{formatReportDate(entry.created_at)}</span>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{entry.note}</p>
              <p className="mt-3 text-xs text-slate-500">Recorded by {entry.author_name || "Technician"}</p>
            </li>
          ))}
        </ol>
      )}

      {role === "technician" && isResolved && (
        <div className="mt-7 rounded-2xl border border-violet-300/15 bg-violet-300/5 p-5">
          <h3 className="font-semibold text-violet-100">Fault report closed</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">Resolution is recorded. Further work-log entries and another resolution are disabled to preserve this audit history.</p>
          <button type="button" disabled className="mt-4 rounded-xl border border-violet-300/20 px-4 py-3 text-sm font-bold text-violet-100/50 disabled:cursor-not-allowed">Report resolved</button>
        </div>
      )}

      {role === "technician" && !isResolved && (
        <div className="mt-8 grid gap-6 border-t border-white/10 pt-7 xl:grid-cols-2">
          <div className="rounded-2xl border border-cyan-300/15 bg-[#091522] p-5">
            <h3 className="text-lg font-semibold text-white">Add log entry</h3>
            <label className="mt-5 block text-sm font-medium text-slate-200">
              Entry type
              <select value={entryType} onChange={(event) => setEntryType(event.target.value as (typeof MANUAL_WORK_LOG_OPTIONS)[number])} disabled={isAdding || isResolving} className="mt-2 w-full rounded-xl border border-white/10 bg-[#07111c] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/60">
                {MANUAL_WORK_LOG_OPTIONS.map((option) => <option key={option} value={option}>{WORK_LOG_TYPE_LABELS[option]}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-200">
              Note <span className="text-amber-200">*</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={5} disabled={isAdding || isResolving} placeholder="Record what was observed, measured, completed, or escalated." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#07111c] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/60" />
            </label>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-600">{note.length}/4000</span>
              <button type="button" onClick={() => void addEntry()} disabled={!note.trim() || isAdding || isResolving} className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#07111c] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">{isAdding ? "Recording..." : "Add log entry"}</button>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-300/20 bg-violet-300/5 p-5">
            <h3 className="text-lg font-semibold text-white">Resolve fault report</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">Resolution records the final outcome, creates an immutable resolution entry, and closes this report to further activity.</p>
            <label className="mt-5 block text-sm font-medium text-slate-200">
              Resolution summary <span className="text-amber-200">*</span>
              <textarea value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} maxLength={4000} rows={5} disabled={isResolving || isAdding} placeholder="Describe the verified outcome and any relevant follow-up." className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#07111c] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-slate-600 focus:border-violet-300/60" />
            </label>
            <label className="mt-4 flex gap-3 rounded-xl border border-violet-300/15 bg-[#07111c]/60 p-4 text-sm leading-6 text-slate-300">
              <input type="checkbox" checked={resolutionConfirmed} onChange={(event) => setResolutionConfirmed(event.target.checked)} disabled={isResolving || isAdding} className="mt-1 size-4 shrink-0 accent-violet-300" />
              <span>I confirm this summary records the outcome and resolving will close the report.</span>
            </label>
            <button type="button" onClick={() => void resolveReport()} disabled={!resolutionSummary.trim() || !resolutionConfirmed || isResolving || isAdding} className="mt-4 w-full rounded-xl bg-violet-300 px-4 py-3 text-sm font-bold text-[#07111c] hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40">{isResolving ? "Resolving report..." : "Resolve and close report"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function CaseWorkspace({
  report,
  role,
  workspaceId,
  onReportResolved,
}: {
  report: FaultReport;
  role: "admin" | "technician";
  workspaceId: string;
  onReportResolved: (report: FaultReport) => void;
}) {
  const isResolved = report.status === "resolved";
  return (
    <div className="space-y-8">
      <section className={`rounded-3xl bg-[#101e2d]/95 p-6 sm:p-8 ${isResolved ? "border border-violet-300/20" : "border border-emerald-300/20"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isResolved ? "text-violet-200" : "text-emerald-300"}`}>{isResolved ? "Resolved fault report" : "Active troubleshooting case"}</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">{report.equipment_name}</h1>
            <p className="mt-2 text-sm text-slate-400">Created {formatReportDate(report.created_at)}{report.technician_name ? ` by ${report.technician_name}` : ""}</p>
          </div>
          <span className={isResolved ? "rounded-full border border-violet-300/25 bg-violet-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-violet-100" : "rounded-full border border-emerald-300/25 bg-emerald-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-emerald-200"}>{isResolved ? "Resolved" : "Active"}</span>
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

      {!isResolved && <ApprovedEvidence workspaceId={workspaceId} reportId={report.id} />}

      {!isResolved && <GuidancePlanSection workspaceId={workspaceId} reportId={report.id} role={role} />}

      <WorkLogSection report={report} role={role} workspaceId={workspaceId} onReportResolved={onReportResolved} />
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
  if (report.status === "active" || report.status === "resolved") {
    return <CaseWorkspace report={report} role={role} workspaceId={workspaceId} onReportResolved={setReport} />;
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
