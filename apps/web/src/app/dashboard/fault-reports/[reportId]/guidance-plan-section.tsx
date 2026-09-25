"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import { DOCUMENT_TYPE_LABELS } from "../../document-types";
import {
  formatReportDate,
  type CitedStatement,
  type FaultReport,
  type GuidanceCheck,
  type GuidanceEvidence,
  type GuidancePlan,
} from "../../fault-report-types";
import {
  distinctDocumentTitles,
  evidenceForCitations,
  readableSourceLabel,
  sourceNumber,
} from "./guidance-presentation";

type PlanOrigin = "saved" | "generated" | null;
type GuidanceError = { message: string; action: "load" | "generate" };

function SourceEvidence({
  citationIds,
  plan,
}: {
  citationIds: number[];
  plan: GuidancePlan;
}) {
  const sources = evidenceForCitations(plan.evidence, citationIds);
  if (sources.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Supporting evidence
      </p>
      {sources.map((source) => (
        <details
          key={source.chunk_id}
          className="group overflow-hidden rounded-md border border-white/10 bg-[#0d0f10] open:border-teal-300/25"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.03] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300">
            <span className="min-w-0 truncate">{readableSourceLabel(plan.evidence, source)}</span>
            <span className="shrink-0 text-xs text-teal-200 group-open:hidden">View excerpt</span>
            <span className="hidden shrink-0 text-xs text-zinc-500 group-open:inline">Hide excerpt</span>
          </summary>
          <div className="border-t border-white/10 px-4 py-4">
            <p className="text-xs leading-5 text-zinc-500">
              {DOCUMENT_TYPE_LABELS[source.document_type]} · {source.source_revision ?? "Revision not provided"} · Page {source.page_number} · {source.equipment_linked ? "Linked to this equipment" : "General workspace document"}
            </p>
            <blockquote className="mt-3 border-l-2 border-teal-300/40 pl-4 text-sm leading-7 text-zinc-200">
              {source.excerpt}
            </blockquote>
            <div className="mt-4 flex justify-end">
              {source.source_available && source.source_url ? (
                <a
                  href={`${source.source_url}#page=${source.page_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cursor-pointer rounded-md border border-teal-300/25 px-3 py-2 text-xs font-semibold text-teal-100 transition-colors hover:border-teal-300/60 hover:bg-teal-300/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
                >
                  Open approved document
                </a>
              ) : (
                <span className="text-xs text-amber-200">Current source access is unavailable</span>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function StepShell({
  number,
  phase,
  title,
  tone = "normal",
  children,
}: {
  number: number;
  phase: string;
  title: string;
  tone?: "normal" | "warning" | "urgent";
  children: ReactNode;
}) {
  const toneClasses = {
    normal: "border-white/10 before:bg-teal-300 text-teal-200",
    warning: "border-amber-300/20 before:bg-amber-300 text-amber-200",
    urgent: "border-red-300/25 before:bg-red-300 text-red-200",
  }[tone];

  return (
    <li className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 pb-5 last:pb-0 sm:grid-cols-[3.25rem_minmax(0,1fr)] sm:gap-5">
      <div className="relative z-10 flex size-11 items-center justify-center rounded-md border border-teal-300/25 bg-[#111315] text-lg font-bold text-teal-200 shadow-[0_0_0_5px_#111315] sm:size-13">
        {number}
      </div>
      <article className={`relative overflow-hidden rounded-md border bg-[#151719] p-5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 sm:p-6 ${toneClasses}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-current">{phase}</p>
            <h4 className="mt-1.5 text-lg font-semibold text-white">{title}</h4>
          </div>
          {tone === "warning" && <span className="rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 text-xs font-semibold text-amber-100">Safety attention</span>}
          {tone === "urgent" && <span className="rounded-md border border-red-300/25 bg-red-300/[0.07] px-2.5 py-1 text-xs font-semibold text-red-100">Escalation point</span>}
        </div>
        <div className="mt-4 text-sm leading-7 text-zinc-200">{children}</div>
      </article>
    </li>
  );
}

function CitedStatements({
  items,
  plan,
}: {
  items: CitedStatement[];
  plan: GuidancePlan;
}) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={`${item.text}-${index}`} className={index === 0 ? "" : "border-t border-white/10 pt-4"}>
          <p>{item.text}</p>
          <SourceEvidence citationIds={item.citation_ids} plan={plan} />
        </div>
      ))}
    </div>
  );
}

function GuidedResponsePath({ plan }: { plan: GuidancePlan }) {
  const decisionCitationIds = useMemo(
    () => [...new Set(plan.guided_checks.flatMap((check) => check.citation_ids))],
    [plan.guided_checks],
  );
  let stepNumber = 1;

  return (
    <section aria-labelledby="guided-response-path-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Grounded workflow</p>
          <h3 id="guided-response-path-title" className="mt-2 text-2xl font-semibold text-white">Guided Response Path</h3>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-zinc-500">Open any named source to compare the step with the exact approved excerpt.</p>
      </div>

      <ol className="relative mt-6 before:absolute before:bottom-8 before:left-[1.34rem] before:top-6 before:w-px before:bg-white/15 sm:before:left-[1.59rem]">
        <StepShell number={stepNumber++} phase="Assess" title="Confirm the reported condition">
          <p>{plan.case_summary.text}</p>
          <SourceEvidence citationIds={plan.case_summary.citation_ids} plan={plan} />
          {plan.safety_brief_items.length > 0 && (
            <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/[0.04] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">Safety brief</p>
              <div className="mt-3"><CitedStatements items={plan.safety_brief_items} plan={plan} /></div>
            </div>
          )}
        </StepShell>

        {plan.guided_checks.map((check: GuidanceCheck, index) => (
          <StepShell key={`${check.title}-${index}`} number={stepNumber++} phase="Inspect" title={check.title}>
            <p>{check.supported_action}</p>
            <SourceEvidence citationIds={check.citation_ids} plan={plan} />
          </StepShell>
        ))}

        <StepShell number={stepNumber++} phase="Record / decide" title="Capture findings before continuing">
          <p>Record observations and measurements in the Work Log. Use the approved excerpts supporting the checks above when deciding whether the recorded findings support further work or escalation.</p>
          <SourceEvidence citationIds={decisionCitationIds} plan={plan} />
        </StepShell>

        <StepShell number={stepNumber} phase="Escalate" title="Stop when an escalation criterion is met" tone="urgent">
          <CitedStatements items={plan.escalation_criteria} plan={plan} />
        </StepShell>
      </ol>
    </section>
  );
}

function EvidenceSnapshot({
  plan,
  report,
}: {
  plan: GuidancePlan;
  report: FaultReport;
}) {
  const documentTitles = distinctDocumentTitles(plan.evidence);

  return (
    <details className="group overflow-hidden rounded-md border border-white/10 bg-[#111315]">
      <summary className="cursor-pointer list-none p-5 transition-colors hover:bg-white/[0.025] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Historical · read only</p>
            <h3 className="mt-2 text-lg font-semibold text-white">Approved evidence used for this saved plan</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">This snapshot preserves the exact approved evidence available when the plan was generated.</p>
          </div>
          <span className="rounded-md border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300">{plan.evidence.length} {plan.evidence.length === 1 ? "excerpt" : "excerpts"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          {documentTitles.map((title) => <span key={title} className="rounded-md bg-white/[0.04] px-2.5 py-1">{title}</span>)}
          <span className="ml-auto text-teal-200 group-open:hidden">Show saved evidence</span>
          <span className="ml-auto hidden text-zinc-500 group-open:inline">Hide saved evidence</span>
        </div>
      </summary>

      <div className="border-t border-white/10 p-5 sm:p-6">
        <p className="rounded-md border border-amber-300/15 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/80">The excerpts below remain part of this saved plan even if the live source document is revised, archived, or replaced later.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {plan.evidence.map((source: GuidanceEvidence) => (
            <article id={`guidance-evidence-${source.chunk_id}`} key={source.chunk_id} className="scroll-mt-6 rounded-md border border-white/10 bg-[#0d0f10] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-300">Source {sourceNumber(plan.evidence, source.chunk_id)}</p>
                  <h4 className="mt-1.5 font-semibold text-white">{source.document_title}</h4>
                </div>
                <span className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">{DOCUMENT_TYPE_LABELS[source.document_type]}</span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div><dt className="text-zinc-600">Revision / reference</dt><dd className="mt-1 text-zinc-300">{source.source_revision ?? "Not provided"}</dd></div>
                <div><dt className="text-zinc-600">Document scope</dt><dd className="mt-1 text-zinc-300">{source.equipment_linked ? `${report.equipment_name}${report.equipment_asset_tag ? ` (${report.equipment_asset_tag})` : ""}` : "General workspace document"}</dd></div>
              </dl>
              <blockquote className="mt-4 border-l-2 border-teal-300/35 pl-4 text-sm leading-7 text-zinc-200">{source.excerpt}</blockquote>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                <span className="text-[11px] text-zinc-600">Page {source.page_number} · Snapshot reference {source.chunk_id}</span>
                {source.source_available && source.source_url ? (
                  <a href={`${source.source_url}#page=${source.page_number}`} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-xs font-semibold text-teal-100 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300">Open current approved document</a>
                ) : (
                  <span className="text-xs text-amber-200">Current document access unavailable</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

export function GuidancePlanSection({
  workspaceId,
  report,
  role,
  canGenerate,
}: {
  workspaceId: string;
  report: FaultReport;
  role: "admin" | "technician";
  canGenerate: boolean;
}) {
  const [plan, setPlan] = useState<GuidancePlan | null>(null);
  const [planOrigin, setPlanOrigin] = useState<PlanOrigin>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<GuidanceError | null>(null);

  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/guidance-plan`,
      );
      if (response.status === 404) {
        setPlan(null);
        setPlanOrigin(null);
        return;
      }
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Saved guidance could not be loaded."));
      setPlan((await response.json()) as GuidancePlan);
      setPlanOrigin("saved");
    } catch (loadError) {
      setError({
        message: loadError instanceof Error ? loadError.message : "Saved guidance could not be loaded.",
        action: "load",
      });
    } finally {
      setIsLoading(false);
    }
  }, [report.id, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPlan(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPlan]);

  async function generatePlan() {
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/guidance-plan/generate`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Evidence-grounded guidance could not be generated."));
      setPlan((await response.json()) as GuidancePlan);
      setPlanOrigin("generated");
    } catch (generationError) {
      setError({
        message: generationError instanceof Error ? generationError.message : "Evidence-grounded guidance could not be generated.",
        action: "generate",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  const reportTitle = `${report.equipment_name} · ${report.fault_code || "Reported fault"}`;
  const providerBusy = error?.action === "generate" && /temporarily busy|timed out|try again shortly/i.test(error.message);

  return (
    <section className="overflow-hidden rounded-md border border-teal-300/15 bg-[#111315]" aria-labelledby="guidance-plan-title">
      <header className="border-b border-white/10 bg-[#151719] p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Evidence-grounded plan</p>
            <h2 id="guidance-plan-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{reportTitle}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{report.symptom}</p>
          </div>
          {canGenerate && (
            <button type="button" onClick={() => void generatePlan()} disabled={isGenerating || isLoading} className="cursor-pointer rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] transition-colors hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200 disabled:cursor-wait disabled:opacity-60">
              {isGenerating ? "Generating and validating…" : plan ? "Generate updated plan" : "Generate grounded plan"}
            </button>
          )}
        </div>

        <dl className="mt-6 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
          <div className="bg-[#111315] p-4"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Equipment</dt><dd className="mt-1.5 text-sm font-medium text-zinc-200">{report.equipment_name}{report.equipment_asset_tag ? ` · ${report.equipment_asset_tag}` : ""}</dd></div>
          <div className="bg-[#111315] p-4"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Fault severity</dt><dd className="mt-1.5 text-sm font-medium text-zinc-300">Not classified</dd></div>
          <div className="bg-[#111315] p-4"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Safety gate</dt><dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-amber-100"><span aria-hidden="true" className="flex size-4 items-center justify-center rounded-sm border border-amber-300/30 text-[10px]">✓</span>Completed</dd></div>
          <div className="bg-[#111315] p-4"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Plan state</dt><dd className="mt-1.5 text-sm font-medium text-zinc-200">{planOrigin === "generated" ? "Newly generated" : planOrigin === "saved" ? "Saved plan" : "No saved plan"}</dd>{plan && <p className="mt-1 text-[11px] text-zinc-600">{formatReportDate(plan.created_at)}</p>}</div>
        </dl>

        <div className="mt-4 flex gap-3 rounded-md border border-amber-300/15 bg-amber-300/[0.035] px-4 py-3 text-xs leading-5 text-amber-100/80">
          <span aria-hidden="true" className="font-bold text-amber-300">!</span>
          <p>Follow current site procedures, formal LOTO or isolation requirements, authorization, required PPE, emergency escalation, and qualified technician judgment. Stop when conditions are unsafe or uncertain.</p>
        </div>
        {!canGenerate && <p className="mt-3 text-xs text-zinc-500">Read-only {role === "admin" ? "administrator" : "resolved-case"} view. This saved plan cannot be changed here.</p>}
      </header>

      <div className="p-5 sm:p-7">
        {isLoading && (
          <div role="status" aria-label="Loading saved guidance plan" className="space-y-4">
            <div className="h-5 w-52 animate-pulse rounded bg-white/10" />
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-md border border-white/5 bg-white/[0.025]" />)}
          </div>
        )}

        {isGenerating && <div role="status" className="mb-6 flex items-center gap-3 rounded-md border border-teal-300/20 bg-teal-300/[0.04] px-4 py-3 text-sm text-teal-100"><span className="size-2 animate-pulse rounded-full bg-teal-300" />Retrieving approved evidence, generating a structured plan, and validating every citation…</div>}

        {error && (
          <div role="alert" className={`mb-6 rounded-md border p-5 ${providerBusy ? "border-amber-300/25 bg-amber-300/[0.05]" : "border-red-300/25 bg-red-300/[0.05]"}`}>
            <p className={`text-xs font-bold uppercase tracking-[0.16em] ${providerBusy ? "text-amber-200" : "text-red-200"}`}>{providerBusy ? "AI service temporarily busy" : error.action === "load" ? "Saved plan unavailable" : "Plan generation failed"}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-200">{error.message}</p>
            {plan && error.action === "generate" && <p className="mt-2 text-xs text-zinc-500">The previously saved and validated plan remains available below.</p>}
            <button type="button" onClick={() => error.action === "generate" ? void generatePlan() : void loadPlan()} disabled={isGenerating || isLoading} className="mt-4 cursor-pointer rounded-md border border-teal-300/30 px-3 py-2 text-xs font-semibold text-teal-100 transition-colors hover:border-teal-300/60 hover:bg-teal-300/[0.06] disabled:cursor-wait disabled:opacity-50">{error.action === "generate" ? "Try generation again" : "Retry loading saved plan"}</button>
          </div>
        )}

        {!isLoading && !plan && !error && (
          <div className="rounded-md border border-dashed border-white/15 bg-[#151719] p-8 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-white/10 text-lg text-zinc-500">↳</div>
            <h3 className="mt-4 font-semibold text-white">No saved guidance plan yet</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500">{canGenerate ? "Generate a plan after approved PDF evidence has been indexed for this report." : role === "admin" ? "The report technician has not saved a grounded plan for this case." : "No guidance plan was saved before this report was resolved."}</p>
          </div>
        )}

        {!isLoading && plan?.status === "insufficient_evidence" && (
          <div className="rounded-md border border-amber-300/25 bg-amber-300/[0.045] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-200">Insufficient approved evidence</p>
            <h3 className="mt-2 text-lg font-semibold text-white">No maintenance guidance was generated</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-200">{plan.case_summary.text}</p>
            <p className="mt-3 text-xs leading-5 text-amber-100/65">FaultTrace did not fill missing evidence with general knowledge. Add or index an applicable approved PDF before trying again.</p>
          </div>
        )}

        {!isLoading && plan?.status === "grounded" && (
          <div className="space-y-8">
            <GuidedResponsePath plan={plan} />
            {plan.evidence.length > 0 && <EvidenceSnapshot plan={plan} report={report} />}
          </div>
        )}
      </div>
    </section>
  );
}
