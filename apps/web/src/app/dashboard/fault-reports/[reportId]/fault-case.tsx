"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import {
  SAFETY_ACKNOWLEDGEMENTS,
  formatReportDate,
  type EvidenceRetrievalResponse,
  type FaultReportAttachment,
  type FaultReport,
  type WorkLogEntry,
  type WorkLogEntryType,
} from "../../fault-report-types";
import { DOCUMENT_TYPE_LABELS } from "../../document-types";
import { GuidancePlanSection } from "./guidance-plan-section";

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
        <div key={label} className={index > 1 ? "rounded-lg border border-white/10 bg-[#111315] p-5 sm:col-span-2" : "rounded-lg border border-white/10 bg-[#111315] p-5"}>
          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
          <dd className="mt-2 whitespace-pre-wrap text-sm leading-7 text-zinc-200">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachedPhotosSection({
  report,
  role,
  workspaceId,
}: {
  report: FaultReport;
  role: "admin" | "technician";
  workspaceId: string;
}) {
  const [attachments, setAttachments] = useState<FaultReportAttachment[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const attachmentBaseUrl = useMemo(
    () => `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${report.id}/attachments`,
    [report.id, workspaceId],
  );
  const canUpload = role === "technician" && report.status !== "resolved";

  const requestSignedUrl = useCallback(async (attachmentId: string) => {
    const response = await authenticatedFetch(`${attachmentBaseUrl}/${attachmentId}/access`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "The private photo could not be opened."));
    }
    return (await response.json()) as { url: string; expires_in: number; file_name: string };
  }, [attachmentBaseUrl]);

  const loadAttachments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(attachmentBaseUrl);
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Attached photos could not be loaded."));
      }
      const records = (await response.json()) as FaultReportAttachment[];
      const signedResults = await Promise.allSettled(
        records.map(async (attachment) => ({
          attachmentId: attachment.id,
          access: await requestSignedUrl(attachment.id),
        })),
      );
      const nextUrls: Record<string, string> = {};
      signedResults.forEach((result) => {
        if (result.status === "fulfilled") {
          nextUrls[result.value.attachmentId] = result.value.access.url;
        }
      });
      setAttachments(records);
      setPhotoUrls(nextUrls);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Attached photos could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [attachmentBaseUrl, requestSignedUrl]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAttachments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAttachments]);

  async function uploadPhoto() {
    if (!selectedFile || !canUpload || isUploading) return;
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError("Fault-report photos must be 10 MB or smaller.");
      return;
    }
    setIsUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await authenticatedFetch(attachmentBaseUrl, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The photo could not be uploaded."));
      }
      setSelectedFile(null);
      setFileInputKey((value) => value + 1);
      setSuccess("Photo attached to this fault report.");
      await loadAttachments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The photo could not be uploaded.");
    } finally {
      setIsUploading(false);
    }
  }

  async function openPhoto(attachment: FaultReportAttachment) {
    if (activeAttachmentId) return;
    const photoWindow = window.open("about:blank", "_blank");
    if (photoWindow) photoWindow.opener = null;
    setActiveAttachmentId(attachment.id);
    setError(null);
    try {
      const access = await requestSignedUrl(attachment.id);
      setPhotoUrls((current) => ({ ...current, [attachment.id]: access.url }));
      if (photoWindow) {
        photoWindow.location.replace(access.url);
      } else {
        setError("Allow pop-ups for FaultTrace, then choose Open again.");
      }
    } catch (openError) {
      photoWindow?.close();
      setError(openError instanceof Error ? openError.message : "The private photo could not be opened.");
    } finally {
      setActiveAttachmentId(null);
    }
  }

  async function deletePhoto(attachment: FaultReportAttachment) {
    if (!attachment.can_delete || activeAttachmentId) return;
    if (!window.confirm(`Delete ${attachment.file_name} from this Draft report?`)) return;
    setActiveAttachmentId(attachment.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(`${attachmentBaseUrl}/${attachment.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "The photo could not be deleted."));
      }
      setAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setPhotoUrls((current) => {
        const next = { ...current };
        delete next[attachment.id];
        return next;
      });
      setSuccess("Draft photo deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The photo could not be deleted.");
    } finally {
      setActiveAttachmentId(null);
    }
  }

  return (
    <section className="rounded-lg border border-teal-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="attached-photos-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Private report media</p>
          <h2 id="attached-photos-title" className="mt-2 text-2xl font-semibold text-white">Attached photos</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Photos support reporting only and do not replace approved inspection procedures.</p>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300">JPEG, PNG, WebP · 10 MB max</span>
      </div>

      {role === "admin" && <p className="mt-5 rounded-md border border-teal-300/15 bg-teal-300/5 px-4 py-3 text-sm text-teal-100">Read-only administrator view. Photo upload and deletion remain technician actions.</p>}
      {role === "technician" && report.status === "resolved" && <p className="mt-5 rounded-md border border-emerald-300/15 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">Resolved report photos are read-only and cannot be changed or deleted.</p>}

      {canUpload && (
        <div className="mt-5 flex flex-col gap-4 rounded-lg border border-teal-300/15 bg-[#111315] p-5 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-sm font-medium text-zinc-200">
            Add a report photo
            <input
              key={fileInputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              disabled={isUploading}
              className="mt-2 block w-full rounded-md border border-white/10 bg-[#0d0f10] px-3 py-2.5 text-sm text-zinc-300 file:mr-4 file:rounded-md file:border-0 file:bg-teal-300 file:px-3 file:py-2 file:font-semibold file:text-[#0d0f10]"
            />
          </label>
          <button type="button" onClick={() => void uploadPhoto()} disabled={!selectedFile || isUploading} className="rounded-md bg-teal-300 px-5 py-3 text-sm font-bold text-[#0d0f10] hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-40">{isUploading ? "Uploading photo..." : "Attach photo"}</button>
        </div>
      )}

      {error && <div role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100"><p>{error}</p><button type="button" onClick={() => void loadAttachments()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Reload photos</button></div>}
      {success && <p role="status" className="mt-5 rounded-md border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}
      {isLoading && <p role="status" className="mt-5 rounded-md border border-white/10 p-5 text-sm text-zinc-400">Loading private report photos...</p>}
      {!isLoading && !error && attachments.length === 0 && <div className="mt-5 rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-6 text-center"><p className="font-medium text-zinc-200">No photos are attached to this report.</p><p className="mt-2 text-sm text-zinc-500">{canUpload ? "Attach a clear reporting photo if it supports the case record." : "Technician photos will appear here when available."}</p></div>}
      {!isLoading && attachments.length > 0 && (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#111315]">
              <div className="aspect-[4/3] bg-[#0d0f10]">
                {photoUrls[attachment.id] ? (
                  // Signed private object URLs are intentionally rendered without Next image optimization.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrls[attachment.id]} alt={`Attached fault report photo ${attachment.file_name}`} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center px-5 text-center text-sm text-zinc-500">Preview link unavailable. Use Open to retry.</div>
                )}
              </div>
              <div className="p-4">
                <p className="truncate text-sm font-semibold text-white" title={attachment.file_name}>{attachment.file_name}</p>
                <p className="mt-1 text-xs text-zinc-500">{formatFileSize(attachment.size_bytes)} · {formatReportDate(attachment.created_at)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void openPhoto(attachment)} disabled={activeAttachmentId === attachment.id} className="rounded-md border border-teal-300/25 px-3 py-2 text-xs font-semibold text-teal-100 hover:border-teal-300/60 disabled:opacity-50">{activeAttachmentId === attachment.id ? "Opening..." : "Open"}</button>
                  {attachment.can_delete && <button type="button" onClick={() => void deletePhoto(attachment)} disabled={activeAttachmentId === attachment.id} className="rounded-md border border-red-300/20 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/50 disabled:opacity-50">Delete</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <section className="rounded-lg border border-teal-300/15 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="approved-evidence-title">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Deterministic PDF retrieval</p>
          <h2 id="approved-evidence-title" className="mt-2 text-2xl font-semibold text-white">Approved evidence</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Search readable text from approved workspace PDFs using this report and equipment. Results are verbatim excerpts, not instructions or a diagnosis.</p>
        </div>
        <button type="button" onClick={() => void retrieveEvidence()} disabled={isRetrieving} className="shrink-0 rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] hover:bg-teal-200 disabled:cursor-wait disabled:opacity-60">{isRetrieving ? "Retrieving evidence..." : result ? "Retrieve again" : "Retrieve approved evidence"}</button>
      </div>

      {retrievalError && <div role="alert" className="mt-6 rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100"><p>{retrievalError}</p><button type="button" onClick={() => void retrieveEvidence()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button></div>}
      {isRetrieving && <p role="status" className="mt-6 rounded-md border border-white/10 p-4 text-sm text-zinc-400">Searching indexed approved PDF excerpts...</p>}
      {!isRetrieving && !retrievalError && !result && <div className="mt-6 rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-6 text-center"><p className="font-medium text-zinc-200">Evidence has not been retrieved for this case.</p><p className="mt-2 text-sm leading-6 text-zinc-500">Retrieval returns only matching excerpts from approved PDFs that an administrator has indexed.</p></div>}
      {!isRetrieving && !retrievalError && result && result.evidence.length === 0 && <div className="mt-6 rounded-lg border border-amber-300/20 bg-amber-300/5 p-6"><p className="font-semibold text-amber-100">No approved evidence found</p><p className="mt-2 text-sm leading-6 text-amber-100/75">{result.message}</p></div>}
      {!isRetrieving && !retrievalError && result && result.evidence.length > 0 && (
        <div className="mt-6">
          <p className="rounded-md border border-teal-300/20 bg-teal-300/5 px-4 py-3 text-sm font-semibold text-teal-100">Approved source excerpts - review the original procedure before acting.</p>
          <ul className="mt-4 space-y-4">
            {result.evidence.map((evidence) => (
              <li key={evidence.chunk_id} className="rounded-lg border border-white/10 bg-[#111315] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{evidence.document_title}</h3>
                    <p className="mt-1 text-xs text-zinc-400">Approved excerpt · {DOCUMENT_TYPE_LABELS[evidence.document_type]} · {evidence.source_revision ?? "Revision not provided"} · Page {evidence.page_number}</p>
                  </div>
                  {evidence.equipment_linked && <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200">Linked equipment</span>}
                </div>
                <blockquote className="mt-4 border-l-2 border-teal-300/40 pl-4 text-sm leading-7 text-zinc-200">{evidence.excerpt}</blockquote>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-zinc-600">Verbatim extracted PDF text · temporary source link</span>
                  <a href={`${evidence.source_url}#page=${evidence.page_number}`} target="_blank" rel="noopener noreferrer" className="cursor-pointer rounded-md border border-teal-300/25 px-3 py-2 text-xs font-semibold text-teal-100 hover:border-teal-300/60 hover:bg-teal-300/[0.06]">Open source document</a>
                </div>
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
    <section className="rounded-lg border border-white/10 bg-[#151719]/90 p-6 sm:p-8" aria-labelledby="work-log-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Append-only case record</p>
          <h2 id="work-log-title" className="mt-2 text-2xl font-semibold text-white">Work Log</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Record observations, actions, measurements, and escalations in chronological order. Entries remain part of the case audit history.</p>
        </div>
        <span className={isResolved ? "rounded-md border border-emerald-300/25 bg-emerald-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-emerald-100" : "rounded-md border border-red-300/25 bg-red-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-red-200"}>{isResolved ? "Resolved" : "Active"}</span>
      </div>

      {role === "admin" && <p className="mt-5 rounded-md border border-teal-300/15 bg-teal-300/5 px-4 py-3 text-sm text-teal-100">Read-only administrator view. Work-log entries and resolution controls belong to the report technician.</p>}
      {isResolved && report.resolution_summary && (
        <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-emerald-100">Recorded resolution</h3>
            <span className="text-xs text-emerald-100/60">{report.resolved_at ? formatReportDate(report.resolved_at) : "Resolution time recorded"}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-zinc-200">{report.resolution_summary}</p>
        </div>
      )}

      {isLoading && <p role="status" className="mt-6 rounded-md border border-white/10 p-4 text-sm text-zinc-400">Loading work-log entries...</p>}
      {error && <div role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100"><p>{error}</p><button type="button" onClick={() => void loadEntries()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Reload work log</button></div>}
      {success && <p role="status" className="mt-5 rounded-md border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}

      {!isLoading && entries.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed border-white/15 bg-[#111315]/60 p-6 text-center">
          <p className="font-medium text-zinc-200">No work-log entries yet.</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">{role === "technician" && !isResolved ? "Record the first supported observation, action, measurement, or escalation." : "Technician activity will appear here as it is recorded."}</p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <ol className="relative mt-7 space-y-5 border-l border-white/10 pl-6">
          {entries.map((entry) => (
            <li key={entry.id} className="relative rounded-lg border border-white/10 bg-[#111315] p-5">
              <span aria-hidden="true" className={`absolute -left-[31px] top-6 size-3 rounded-full border-2 border-[#151719] ${entry.entry_type === "resolution" ? "bg-emerald-300" : entry.entry_type === "escalation" ? "bg-amber-300" : "bg-teal-300"}`} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-200">{WORK_LOG_TYPE_LABELS[entry.entry_type]}</span>
                <span className="text-xs text-zinc-500">{formatReportDate(entry.created_at)}</span>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-200">{entry.note}</p>
              <p className="mt-3 text-xs text-zinc-500">Recorded by {entry.author_name || "Technician"}</p>
            </li>
          ))}
        </ol>
      )}

      {role === "technician" && isResolved && (
        <div className="mt-7 rounded-lg border border-emerald-300/15 bg-emerald-300/5 p-5">
          <h3 className="font-semibold text-emerald-100">Fault report closed</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Resolution is recorded. Further work-log entries and another resolution are disabled to preserve this audit history.</p>
          <button type="button" disabled className="mt-4 rounded-md border border-emerald-300/20 px-4 py-3 text-sm font-bold text-emerald-100/50 disabled:cursor-not-allowed">Report resolved</button>
        </div>
      )}

      {role === "technician" && !isResolved && (
        <div className="mt-8 grid gap-6 border-t border-white/10 pt-7 xl:grid-cols-2">
          <div className="rounded-lg border border-teal-300/15 bg-[#111315] p-5">
            <h3 className="text-lg font-semibold text-white">Add log entry</h3>
            <label className="mt-5 block text-sm font-medium text-zinc-200">
              Entry type
              <select value={entryType} onChange={(event) => setEntryType(event.target.value as (typeof MANUAL_WORK_LOG_OPTIONS)[number])} disabled={isAdding || isResolving} className="mt-2 w-full rounded-md border border-white/10 bg-[#0d0f10] px-4 py-3 text-sm text-white outline-none focus:border-teal-300/60">
                {MANUAL_WORK_LOG_OPTIONS.map((option) => <option key={option} value={option}>{WORK_LOG_TYPE_LABELS[option]}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-zinc-200">
              Note <span className="text-amber-200">*</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={5} disabled={isAdding || isResolving} placeholder="Record what was observed, measured, completed, or escalated." className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#0d0f10] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-teal-300/60" />
            </label>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-600">{note.length}/4000</span>
              <button type="button" onClick={() => void addEntry()} disabled={!note.trim() || isAdding || isResolving} className="rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-40">{isAdding ? "Recording..." : "Add log entry"}</button>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.04] p-5">
            <h3 className="text-lg font-semibold text-white">Resolve fault report</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Resolution records the final outcome, creates an immutable resolution entry, and closes this report to further activity.</p>
            <label className="mt-5 block text-sm font-medium text-zinc-200">
              Resolution summary <span className="text-amber-200">*</span>
              <textarea value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} maxLength={4000} rows={5} disabled={isResolving || isAdding} placeholder="Describe the verified outcome and any relevant follow-up." className="mt-2 w-full resize-y rounded-md border border-white/10 bg-[#0d0f10] px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-emerald-300/60" />
            </label>
            <label className="mt-4 flex gap-3 rounded-md border border-emerald-300/15 bg-[#0d0f10]/60 p-4 text-sm leading-6 text-zinc-300">
              <input type="checkbox" checked={resolutionConfirmed} onChange={(event) => setResolutionConfirmed(event.target.checked)} disabled={isResolving || isAdding} className="mt-1 size-4 shrink-0 accent-emerald-300" />
              <span>I confirm this summary records the outcome and resolving will close the report.</span>
            </label>
            <button type="button" onClick={() => void resolveReport()} disabled={!resolutionSummary.trim() || !resolutionConfirmed || isResolving || isAdding} className="mt-4 w-full rounded-md bg-emerald-300 px-4 py-3 text-sm font-bold text-[#0d0f10] hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-40">{isResolving ? "Resolving report..." : "Resolve and close report"}</button>
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
  const [activeTab, setActiveTab] = useState<"overview" | "evidence" | "guidance" | "work-log" | "photos">("overview");
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "evidence", label: "Evidence" },
    { id: "guidance", label: "Guidance" },
    { id: "work-log", label: "Work Log" },
    { id: "photos", label: "Photos" },
  ] as const;
  return (
    <div>
      <section className={`rounded-lg border bg-[#151719] p-5 sm:p-6 ${isResolved ? "border-emerald-300/25" : "border-red-300/25"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isResolved ? "text-emerald-300" : "text-red-300"}`}>{isResolved ? "Resolved fault report" : "Active fault report"}</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{report.equipment_name}</h1>
            <p className="mt-2 text-sm text-zinc-400">Created {formatReportDate(report.created_at)}{report.technician_name ? ` by ${report.technician_name}` : ""}</p>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] ${isResolved ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200" : "border-red-300/30 bg-red-300/10 text-red-200"}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${isResolved ? "bg-emerald-300" : "bg-red-300"}`} />{isResolved ? "Resolved" : "Active"}</span>
        </div>
        <dl className="mt-5 grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 sm:grid-cols-4">
          <div className="bg-[#111315] p-3"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Equipment</dt><dd className="mt-1 truncate text-sm font-medium text-zinc-200">{report.equipment_name}</dd></div>
          <div className="bg-[#111315] p-3"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Fault code</dt><dd className="mt-1 text-sm font-medium text-zinc-200">{report.fault_code || "Not provided"}</dd></div>
          <div className="bg-[#111315] p-3"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Owner</dt><dd className="mt-1 truncate text-sm font-medium text-zinc-200">{report.technician_name || "Technician"}</dd></div>
          <div className="bg-[#111315] p-3"><dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Safety Gate</dt><dd className="mt-1 text-sm font-medium text-amber-200">Completed</dd></div>
        </dl>
        {role === "admin" && <p className="mt-4 rounded-md border border-teal-300/20 bg-teal-300/[0.06] px-4 py-3 text-sm text-teal-100"><strong>Read-only administrator view.</strong> Technician activity and report records cannot be changed here.</p>}
        {isResolved && <p className="mt-4 rounded-md border border-emerald-300/20 bg-emerald-300/[0.06] px-4 py-3 text-sm leading-6 text-emerald-100">This case is closed. Its outcome, work log, citations, and saved guidance are preserved as recorded.</p>}
      </section>

      <div className="mt-5 overflow-x-auto border-b border-white/10" role="tablist" aria-label="Fault report sections">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`case-tab-${tab.id}`} onClick={() => setActiveTab(tab.id)} className={`cursor-pointer border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${activeTab === tab.id ? "border-teal-300 text-teal-100" : "border-transparent text-zinc-500 hover:border-white/20 hover:text-zinc-200"}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div id="case-tab-overview" hidden={activeTab !== "overview"} role="tabpanel" aria-label="Overview" className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <section className="rounded-lg border border-white/10 bg-[#151719] p-5 sm:p-6" aria-labelledby="report-overview-title">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">Case record</p>
        <h2 id="report-overview-title" className="mt-2 text-xl font-semibold text-white">Report overview</h2>
        <div className="mt-5"><ReportDetails report={report} /></div>
      </section>
      <section className="rounded-lg border border-amber-300/20 bg-[#151719] p-5 sm:p-6" aria-labelledby="completed-safety-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Pre-task record</p>
            <h2 id="completed-safety-title" className="mt-2 text-xl font-semibold text-white">Safety Gate completed</h2>
          </div>
          <span className="text-xs text-zinc-500">{report.activated_at ? formatReportDate(report.activated_at) : "Completion recorded"}</span>
        </div>
        <ul className="mt-5 space-y-3">
          {SAFETY_ACKNOWLEDGEMENTS.map((item) => (
            <li key={item.key} className="flex gap-3 rounded-md border border-amber-300/15 bg-amber-300/[0.04] p-3 text-sm leading-6 text-zinc-300">
              <span aria-hidden="true" className="mt-0.5 font-bold text-amber-300">OK</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-6 text-zinc-500">These acknowledgements do not replace current site procedures, permits, formal LOTO or isolation requirements, or professional judgment.</p>
      </section>
      </div>

      <div id="case-tab-photos" hidden={activeTab !== "photos"} role="tabpanel" aria-label="Photos" className="mt-6"><AttachedPhotosSection report={report} role={role} workspaceId={workspaceId} /></div>

      <div id="case-tab-evidence" hidden={activeTab !== "evidence"} role="tabpanel" aria-label="Evidence" className="mt-6">{!isResolved ? <ApprovedEvidence workspaceId={workspaceId} reportId={report.id} /> : <section className="rounded-lg border border-white/10 bg-[#151719] p-6"><h2 className="text-xl font-semibold text-white">Approved evidence</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">This resolved case is read-only. Review saved citations and open each approved source from the Guidance tab.</p></section>}</div>

      <div id="case-tab-guidance" hidden={activeTab !== "guidance"} role="tabpanel" aria-label="Guidance" className="mt-6"><GuidancePlanSection workspaceId={workspaceId} report={report} role={role} canGenerate={role === "technician" && !isResolved} /></div>

      <div id="case-tab-work-log" hidden={activeTab !== "work-log"} role="tabpanel" aria-label="Work Log" className="mt-6"><WorkLogSection report={report} role={role} workspaceId={workspaceId} onReportResolved={onReportResolved} /></div>
    </div>
  );
}

export function FaultCase({
  workspaceId,
  reportId,
  role,
  resolvedHistory = false,
}: {
  workspaceId: string;
  reportId: string;
  role: "admin" | "technician";
  resolvedHistory?: boolean;
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
        resolvedHistory
          ? `${API_ORIGIN}/workspaces/${workspaceId}/resolved-reports/${reportId}`
          : `${API_ORIGIN}/workspaces/${workspaceId}/fault-reports/${reportId}`,
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
  }, [reportId, resolvedHistory, workspaceId]);

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
    return <p role="status" className="rounded-lg border border-white/10 bg-[#151719] p-6 text-sm text-zinc-400">Loading fault report...</p>;
  }

  if (error && !report) {
    return (
      <div role="alert" className="rounded-lg border border-red-300/25 bg-red-300/5 p-6 text-sm text-red-100">
        <p>{error}</p>
        <button type="button" onClick={() => void loadReport()} className="mt-4 font-semibold text-teal-200 hover:text-teal-100">Try again</button>
      </div>
    );
  }

  if (!report) return null;
  if (report.status === "active" || report.status === "resolved") {
    return <CaseWorkspace report={report} role={role} workspaceId={workspaceId} onReportResolved={setReport} />;
  }

  if (role === "admin") {
    return (
      <div className="space-y-8">
        <section className="rounded-lg border border-amber-300/20 bg-[#151719]/95 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Read-only administrator view</p>
              <h1 className="mt-3 text-3xl font-semibold text-white">{report.equipment_name}</h1>
              <p className="mt-2 text-sm font-medium text-amber-100">Safety Gate pending</p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">This technician report remains Draft. Only the technician who created it can complete the mandatory acknowledgements and activate the case.</p>
            </div>
            <span className="rounded-md border border-amber-300/25 bg-amber-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-100">Draft</span>
          </div>
          <div className="mt-7"><ReportDetails report={report} /></div>
        </section>
        <AttachedPhotosSection report={report} role={role} workspaceId={workspaceId} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-amber-300/20 bg-[#151719]/95 p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Mandatory pre-task gate</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">{report.equipment_name}</h1>
            <p className="mt-2 text-sm font-medium text-amber-100">Safety Gate pending</p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">Review the fault intake and personally complete every acknowledgement before beginning the case.</p>
          </div>
          <span className="rounded-md border border-amber-300/25 bg-amber-300/5 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-100">Draft</span>
        </div>

        <div className="mt-7"><ReportDetails report={report} /></div>

        <div className="mt-8 rounded-lg border border-amber-300/25 bg-amber-300/[0.06] p-5">
          <h2 className="font-semibold text-amber-100">Site procedures remain controlling</h2>
          <p className="mt-2 text-sm leading-7 text-amber-100/80">This Safety Gate records your acknowledgement. It is not a replacement for current site procedures, work permits, authorization requirements, formal LOTO or isolation procedures, hazard assessments, PPE requirements, or professional judgment. Historical cases and automated output never override current approved procedures. Stop and escalate whenever conditions are unsafe or uncertain.</p>
        </div>

        <fieldset className="mt-7 space-y-3">
          <legend className="mb-4 text-lg font-semibold text-white">Required acknowledgements</legend>
          {SAFETY_ACKNOWLEDGEMENTS.map((item) => (
            <label key={item.key} className="flex cursor-pointer gap-4 rounded-lg border border-white/10 bg-[#111315] p-5 transition hover:border-teal-300/30">
              <input
                type="checkbox"
                checked={acknowledgements[item.key]}
                onChange={(event) => setAcknowledgements((current) => ({ ...current, [item.key]: event.target.checked }))}
                disabled={isActivating}
                className="mt-1 size-5 shrink-0 accent-teal-300"
              />
              <span className="text-sm leading-7 text-zinc-200">{item.label}</span>
            </label>
          ))}
        </fieldset>

        {error && <p role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm text-red-100">{error}</p>}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
          <p className="text-xs text-zinc-500">All four acknowledgements are required to change this report from Draft to Active.</p>
          <button type="button" onClick={() => void activateCase()} disabled={!allAcknowledged || isActivating} className="rounded-md bg-teal-300 px-5 py-3 text-sm font-bold text-[#0d0f10] hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-40">{isActivating ? "Activating case..." : "Acknowledge and begin case"}</button>
        </div>
      </section>
      <AttachedPhotosSection report={report} role={role} workspaceId={workspaceId} />
    </div>
  );
}
