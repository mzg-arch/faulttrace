"use client";

import { useMemo, useState, type FormEvent } from "react";

import { API_ORIGIN, getAccessToken } from "@/lib/faulttrace-api";
import {
  applySharedDocumentMetadata,
  DOCUMENT_FILE_ACCEPT,
  suggestedDocumentTitle,
  uploadDocumentsSequentially,
  uploadDocumentWithProgress,
  validateDocumentFile,
  type SequentialUploadUpdate,
} from "./document-upload-utils";
import {
  DOCUMENT_TYPE_LABELS,
  formatFileSize,
  type DocumentType,
  type EquipmentOption,
  type LibraryDocument,
} from "./document-types";

type BulkUploadStatus = "ready" | "uploading" | "success" | "failed";

type BulkUploadRow = {
  id: string;
  file: File;
  title: string;
  document_type: DocumentType;
  equipment_id: string;
  source_revision: string;
  status: BulkUploadStatus;
  progress: number;
  error: string | null;
};

type BulkSummary = {
  uploaded: number;
  failed: number;
};

const fieldClass =
  "mt-2 w-full cursor-pointer rounded-md border border-white/15 bg-[#0d0f10] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300 disabled:cursor-not-allowed disabled:opacity-60";

function statusStyle(status: BulkUploadStatus) {
  if (status === "success") return "border-emerald-300/20 bg-emerald-300/5 text-emerald-200";
  if (status === "failed") return "border-red-300/20 bg-red-300/5 text-red-100";
  if (status === "uploading") return "border-teal-300/20 bg-teal-300/5 text-teal-100";
  return "border-white/10 bg-white/[0.03] text-zinc-400";
}

function statusLabel(row: BulkUploadRow) {
  if (row.status === "success") return "Uploaded";
  if (row.status === "failed") return "Failed";
  if (row.status === "uploading") return `Uploading ${row.progress}%`;
  return "Ready";
}

export function BulkDocumentUpload({
  workspaceId,
  equipment,
  onComplete,
  onBusyChange,
}: {
  workspaceId: string;
  equipment: EquipmentOption[];
  onComplete: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<BulkUploadRow[]>([]);
  const [sharedEquipmentId, setSharedEquipmentId] = useState("");
  const [defaultRevision, setDefaultRevision] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const remainingCount = useMemo(
    () => rows.filter((row) => row.status !== "success").length,
    [rows],
  );

  function chooseFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    setRows(selected.map((file) => ({
      id: crypto.randomUUID(),
      file,
      title: suggestedDocumentTitle(file.name),
      document_type: "manual",
      equipment_id: sharedEquipmentId,
      source_revision: defaultRevision,
      status: "ready",
      progress: 0,
      error: validateDocumentFile(file),
    })));
    setSummary(null);
    setQueueError(null);
  }

  function updateRow(id: string, changes: Partial<BulkUploadRow>) {
    setRows((current) => current.map((row) => (
      row.id === id
        ? {
            ...row,
            ...changes,
            status: row.status === "failed" ? "ready" : row.status,
            error: row.status === "failed" ? null : row.error,
          }
        : row
    )));
    setSummary(null);
  }

  function applySharedValues() {
    setRows((current) => applySharedDocumentMetadata(
      current.map((row) => (
        row.status === "failed" ? { ...row, status: "ready", error: null } : row
      )),
      sharedEquipmentId,
      defaultRevision,
    ));
    setSummary(null);
  }

  function handleUploadUpdate(update: SequentialUploadUpdate<LibraryDocument>) {
    setRows((current) => current.map((row) => (
      row.id === update.id
        ? {
            ...row,
            status: update.status,
            progress: update.progress,
            error: update.error ?? null,
          }
        : row
    )));
  }

  async function uploadAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploading || remainingCount === 0) return;

    const pendingRows = rows.filter((row) => row.status !== "success");
    const completedBefore = rows.length - pendingRows.length;
    setIsUploading(true);
    onBusyChange(true);
    setSummary(null);
    setQueueError(null);

    try {
      const result = await uploadDocumentsSequentially(
        pendingRows,
        async (row, reportProgress) => {
          const fileError = validateDocumentFile(row.file);
          if (fileError) throw new Error(fileError);
          const title = row.title.trim().replace(/\s+/g, " ");
          if (!title) throw new Error("Enter a document title.");

          const token = await getAccessToken();
          const body = new FormData();
          body.set("title", title);
          body.set("document_type", row.document_type);
          body.set("equipment_id", row.equipment_id);
          body.set("source_revision", row.source_revision.trim());
          body.set("description", "");
          body.set("file", row.file);
          return uploadDocumentWithProgress(
            `${API_ORIGIN}/workspaces/${workspaceId}/documents`,
            token,
            body,
            reportProgress,
          );
        },
        handleUploadUpdate,
      );

      if (result.uploaded > 0) await onComplete();
      setSummary({ uploaded: completedBefore + result.uploaded, failed: result.failed });
    } catch {
      setQueueError("The document library could not be refreshed after upload. Reload the page to verify uploaded files.");
    } finally {
      setIsUploading(false);
      onBusyChange(false);
    }
  }

  function clearQueue() {
    setRows([]);
    setSummary(null);
    setQueueError(null);
    setFileInputKey((current) => current + 1);
  }

  return (
    <form onSubmit={uploadAll} noValidate aria-busy={isUploading} className="mt-7 rounded-lg border border-teal-300/15 bg-[#111315] p-5 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Bulk upload</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Upload multiple approved documents</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Files upload one at a time through the same private, workspace-authorized document flow. A failed file does not stop the remaining queue.</p>
        </div>
        {rows.length > 0 && (
          <button type="button" onClick={clearQueue} disabled={isUploading} className="cursor-pointer rounded-md border border-white/15 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
            Clear queue
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <label className="block text-sm text-zinc-300">
          Linked equipment
          <select className={fieldClass} value={sharedEquipmentId} onChange={(event) => setSharedEquipmentId(event.target.value)} disabled={isUploading}>
            <option value="">General workspace document</option>
            {equipment.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.asset_tag ?? "no asset ID"}){item.status === "archived" ? " — archived" : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm text-zinc-300">
          Default revision
          <input className={fieldClass} value={defaultRevision} onChange={(event) => setDefaultRevision(event.target.value)} disabled={isUploading} maxLength={120} placeholder="Example: Rev. C" />
        </label>
        <button type="button" onClick={applySharedValues} disabled={isUploading || remainingCount === 0} className="h-[46px] cursor-pointer rounded-md border border-teal-300/25 px-4 text-sm font-semibold text-teal-100 transition hover:border-teal-300/60 hover:bg-teal-300/5 disabled:cursor-not-allowed disabled:opacity-50">
          Apply to all
        </button>
      </div>

      <label className="mt-5 block rounded-md border border-dashed border-white/15 bg-[#0d0f10] p-4 text-sm text-zinc-300 transition hover:border-teal-300/35">
        Select documents
        <input
          key={fileInputKey}
          type="file"
          multiple
          accept={DOCUMENT_FILE_ACCEPT}
          onChange={(event) => chooseFiles(event.target.files)}
          disabled={isUploading}
          className="mt-3 block w-full cursor-pointer text-sm text-zinc-400 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-teal-300 file:px-4 file:py-2.5 file:text-xs file:font-bold file:text-[#0d0f10] hover:file:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="mt-2 block text-xs text-zinc-500">PDF, PNG, JPG/JPEG, or WEBP · maximum 10 MB per file</span>
      </label>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-md border border-dashed border-white/10 p-6 text-center">
          <p className="font-medium text-zinc-300">No files selected</p>
          <p className="mt-2 text-sm text-zinc-500">Choose multiple approved source files to prepare the upload queue.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((row, index) => {
            const locked = isUploading || row.status === "success";
            return (
              <fieldset key={row.id} disabled={locked} className="rounded-md border border-white/10 bg-[#151719] p-4 disabled:opacity-75">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">File {index + 1}</p>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-200">{row.file.name}</p>
                    <p className="mt-1 text-xs text-zinc-600">{formatFileSize(row.file.size)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${statusStyle(row.status)}`}>{statusLabel(row)}</span>
                    {row.status !== "success" && (
                      <button type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} disabled={isUploading} className="cursor-pointer rounded-md border border-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-400 hover:border-red-300/30 hover:text-red-100 disabled:cursor-not-allowed">
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block text-xs font-medium text-zinc-400 xl:col-span-2">
                    Title
                    <input className={fieldClass} value={row.title} onChange={(event) => updateRow(row.id, { title: event.target.value })} maxLength={200} />
                  </label>
                  <label className="block text-xs font-medium text-zinc-400">
                    Document type
                    <select className={fieldClass} value={row.document_type} onChange={(event) => updateRow(row.id, { document_type: event.target.value as DocumentType })}>
                      {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-zinc-400">
                    Revision / reference
                    <input className={fieldClass} value={row.source_revision} onChange={(event) => updateRow(row.id, { source_revision: event.target.value })} maxLength={120} />
                  </label>
                  <label className="block text-xs font-medium text-zinc-400 md:col-span-2 xl:col-span-4">
                    Linked equipment
                    <select className={fieldClass} value={row.equipment_id} onChange={(event) => updateRow(row.id, { equipment_id: event.target.value })}>
                      <option value="">General workspace document</option>
                      {equipment.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.asset_tag ?? "no asset ID"}){item.status === "archived" ? " — archived" : ""}</option>)}
                    </select>
                  </label>
                </div>

                {row.status === "uploading" && (
                  <div className="mt-4" role="status" aria-label={`${row.file.name} upload progress`}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-teal-300 transition-all" style={{ width: `${row.progress}%` }} /></div>
                  </div>
                )}
                {row.error && <p role="alert" className="mt-3 rounded-md border border-red-300/20 bg-red-300/5 px-3 py-2 text-xs leading-5 text-red-100">{row.error}</p>}
              </fieldset>
            );
          })}
        </div>
      )}

      {summary && (
        <p role="status" className={`mt-5 rounded-md border px-4 py-3 text-sm font-medium ${summary.failed > 0 ? "border-amber-300/25 bg-amber-300/5 text-amber-100" : "border-emerald-300/25 bg-emerald-300/5 text-emerald-100"}`}>
          {summary.uploaded} uploaded, {summary.failed} failed.
        </p>
      )}
      {queueError && <p role="alert" className="mt-5 rounded-md border border-red-300/25 bg-red-300/5 px-4 py-3 text-sm text-red-100">{queueError}</p>}

      <button type="submit" disabled={isUploading || remainingCount === 0} className="mt-5 w-full cursor-pointer rounded-md bg-teal-300 px-4 py-3 text-sm font-bold text-[#0d0f10] transition hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-not-allowed disabled:opacity-50">
        {isUploading ? "Uploading documents sequentially..." : rows.some((row) => row.status === "failed") ? `Retry ${remainingCount} failed document${remainingCount === 1 ? "" : "s"}` : `Upload ${remainingCount} document${remainingCount === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}
