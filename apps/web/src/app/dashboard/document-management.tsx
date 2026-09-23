"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch, getAccessToken } from "@/lib/faulttrace-api";
import {
  DOCUMENT_TYPE_LABELS,
  documentIndexLabel,
  formatFileSize,
  type DocumentType,
  type EquipmentOption,
  type LibraryDocument,
} from "./document-types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

type DocumentForm = {
  title: string;
  document_type: DocumentType;
  equipment_id: string;
  source_revision: string;
  description: string;
};

const EMPTY_FORM: DocumentForm = {
  title: "",
  document_type: "manual",
  equipment_id: "",
  source_revision: "",
  description: "",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#07111c] px-3.5 py-3 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 disabled:opacity-60";

function sortDocuments(documents: LibraryDocument[]) {
  return [...documents].sort((left, right) => left.title.localeCompare(right.title));
}

function validateFile(file: File | null) {
  if (!file) return "Choose a document file.";
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension) || !ALLOWED_TYPES.includes(file.type)) {
    return "Upload a PDF, PNG, JPG/JPEG, or WEBP file.";
  }
  if (file.size === 0) return "Choose a non-empty document file.";
  if (file.size > MAX_FILE_BYTES) return "Document files must be 10 MB or smaller.";
  return null;
}

function uploadWithProgress(
  url: string,
  token: string,
  body: FormData,
  onProgress: (percentage: number) => void,
) {
  return new Promise<LibraryDocument>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("The document service is unavailable."));
    request.onload = () => {
      const response = request.response as LibraryDocument | { detail?: string } | null;
      if (request.status >= 200 && request.status < 300 && response) {
        resolve(response as LibraryDocument);
        return;
      }
      reject(new Error((response as { detail?: string } | null)?.detail || "Document upload failed."));
    };
    request.send(body);
  });
}

export function DocumentManagement({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [form, setForm] = useState<DocumentForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [indexingDocumentId, setIndexingDocumentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      approved: documents.filter((document) => document.status === "approved").length,
      archived: documents.filter((document) => document.status === "archived").length,
    }),
    [documents],
  );

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [documentResponse, equipmentResponse] = await Promise.all([
        authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/documents`),
        authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/equipment`),
      ]);
      if (!documentResponse.ok) {
        throw new Error(await apiErrorMessage(documentResponse, "Documents could not be loaded."));
      }
      if (!equipmentResponse.ok) {
        throw new Error(await apiErrorMessage(equipmentResponse, "Equipment choices could not be loaded."));
      }
      setDocuments(sortDocuments((await documentResponse.json()) as LibraryDocument[]));
      setEquipment((await equipmentResponse.json()) as EquipmentOption[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Documents could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLibrary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadLibrary]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setFileInputKey((current) => current + 1);
    setEditingId(null);
    setUploadProgress(0);
    setFormError(null);
  }

  function editDocument(document: LibraryDocument) {
    setEditingId(document.id);
    setForm({
      title: document.title,
      document_type: document.document_type,
      equipment_id: document.equipment_id ?? "",
      source_revision: document.source_revision ?? "",
      description: document.description ?? "",
    });
    setFile(null);
    setUploadProgress(0);
    setFormError(null);
    setSuccess(null);
  }

  function normalizedMetadata() {
    return {
      title: form.title.trim().replace(/\s+/g, " "),
      document_type: form.document_type,
      equipment_id: form.equipment_id || null,
      source_revision: form.source_revision.trim() || null,
      description: form.description.trim() || null,
    };
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const metadata = normalizedMetadata();
    setFormError(null);
    setSuccess(null);
    if (!metadata.title) {
      setFormError("Enter a document title.");
      return;
    }
    if (!editingId) {
      const fileError = validateFile(file);
      if (fileError) {
        setFormError(fileError);
        return;
      }
    }

    setIsSaving(true);
    setUploadProgress(0);
    try {
      let saved: LibraryDocument;
      if (editingId) {
        const response = await authenticatedFetch(
          `${API_ORIGIN}/workspaces/${workspaceId}/documents/${editingId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(metadata),
          },
        );
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, "Document metadata could not be saved."));
        }
        saved = (await response.json()) as LibraryDocument;
      } else {
        const token = await getAccessToken();
        const body = new FormData();
        body.set("title", metadata.title);
        body.set("document_type", metadata.document_type);
        body.set("equipment_id", metadata.equipment_id ?? "");
        body.set("source_revision", metadata.source_revision ?? "");
        body.set("description", metadata.description ?? "");
        body.set("file", file as File);
        saved = await uploadWithProgress(
          `${API_ORIGIN}/workspaces/${workspaceId}/documents`,
          token,
          body,
          setUploadProgress,
        );
      }

      setDocuments((current) =>
        sortDocuments(editingId
          ? current.map((document) => (document.id === saved.id ? saved : document))
          : [...current, saved]),
      );
      setSuccess(editingId ? "Document metadata updated." : "Approved document uploaded.");
      resetForm();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The document service is unavailable.");
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveDocument(document: LibraryDocument) {
    if (document.status === "archived" || busyDocumentId) return;
    setBusyDocumentId(document.id);
    setFormError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/documents/${document.id}/archive`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Document could not be archived."));
      }
      const archived = (await response.json()) as LibraryDocument;
      setDocuments((current) =>
        sortDocuments(current.map((item) => (item.id === archived.id ? archived : item))),
      );
      if (editingId === document.id) resetForm();
      setSuccess(`${document.title} archived.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The document service is unavailable.");
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function openDocument(document: LibraryDocument) {
    if (busyDocumentId) return;
    setBusyDocumentId(document.id);
    setFormError(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/documents/${document.id}/access`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Document could not be opened."));
      }
      const result = (await response.json()) as { url: string };
      const link = window.document.createElement("a");
      link.href = result.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The document service is unavailable.");
    } finally {
      setBusyDocumentId(null);
    }
  }

  async function indexDocument(document: LibraryDocument) {
    if (indexingDocumentId || busyDocumentId || document.content_type !== "application/pdf") return;
    setIndexingDocumentId(document.id);
    setFormError(null);
    setSuccess(null);
    try {
      const response = await authenticatedFetch(
        `${API_ORIGIN}/workspaces/${workspaceId}/documents/${document.id}/index`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "PDF could not be indexed."));
      }
      const indexed = (await response.json()) as LibraryDocument;
      setDocuments((current) =>
        sortDocuments(current.map((item) => (item.id === indexed.id ? indexed : item))),
      );
      if (indexed.index_status === "indexed") {
        setSuccess(`${indexed.title} indexed with ${indexed.indexed_chunk_count} page-aware excerpts.`);
      } else if (indexed.index_status === "no_text") {
        setSuccess(`${indexed.title} has no readable PDF text. OCR was not attempted.`);
      } else {
        setFormError(`${indexed.title} could not be indexed. Check the PDF and API dependency setup.`);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The PDF indexing service is unavailable.");
    } finally {
      setIndexingDocumentId(null);
    }
  }

  return (
    <section className="my-10 rounded-3xl border border-cyan-300/15 bg-[#101e2d]/90 p-6 sm:p-8" aria-labelledby="document-management-title">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Admin controls</p>
          <h2 id="document-management-title" className="mt-2 text-2xl font-semibold text-white">Approved Document Library</h2>
        </div>
        <p className="max-w-lg text-sm leading-6 text-slate-400">Upload and maintain official evidence sources. Files remain private and open through temporary authorized links.</p>
      </div>

      <div className="grid gap-8 pt-7 xl:grid-cols-[1.25fr_0.75fr]">
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-white">Workspace documents</h3>
            {!isLoading && !loadError && <span className="text-xs text-slate-500">{counts.approved} approved · {counts.archived} archived</span>}
          </div>
          {isLoading && <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-slate-400">Loading documents...</p>}
          {loadError && <div role="alert" className="rounded-xl border border-amber-300/25 bg-amber-300/5 p-4 text-sm text-amber-100"><p>{loadError}</p><button type="button" onClick={() => void loadLibrary()} className="mt-3 font-semibold text-cyan-200 hover:text-cyan-100">Try again</button></div>}
          {!isLoading && !loadError && documents.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 bg-[#091522]/60 p-7 text-center"><p className="font-medium text-slate-200">No approved documents have been uploaded.</p><p className="mt-2 text-sm leading-6 text-slate-500">Add the first official manual, diagram, bulletin, or fault-code sheet.</p></div>}
          {!isLoading && !loadError && documents.length > 0 && (
            <ul className="space-y-3">
              {documents.map((document) => (
                <li key={document.id} className="rounded-2xl border border-white/10 bg-[#091522] p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-white">{document.title}</h4>
                        <span className={document.status === "approved" ? "rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200" : "rounded-full border border-slate-400/20 bg-slate-400/5 px-2.5 py-1 text-xs font-semibold text-slate-400"}>{document.status}</span>
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">{DOCUMENT_TYPE_LABELS[document.document_type]}</span>
                      </div>
                      <p className="mt-3 text-sm text-slate-400">{document.description ?? "No description provided."}</p>
                      <p className="mt-3 text-xs text-slate-500">{document.equipment_name ?? "General workspace document"}{document.source_revision ? ` · ${document.source_revision}` : ""}</p>
                      <p className="mt-1 text-xs text-slate-600">{document.file_name ?? "Stored file"} · {formatFileSize(document.size_bytes)}</p>
                      <p className={document.index_status === "indexed" ? "mt-2 text-xs font-medium text-emerald-300" : document.index_status === "no_text" || document.index_status === "failed" ? "mt-2 text-xs font-medium text-amber-200" : "mt-2 text-xs text-slate-500"}>{documentIndexLabel(document)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button type="button" onClick={() => void openDocument(document)} disabled={busyDocumentId !== null || indexingDocumentId !== null} className="rounded-lg border border-cyan-300/20 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300/50 disabled:opacity-50">{busyDocumentId === document.id ? "Opening..." : "Open"}</button>
                      {document.status === "approved" && document.content_type === "application/pdf" && <button type="button" onClick={() => void indexDocument(document)} disabled={indexingDocumentId !== null || busyDocumentId !== null || isSaving} className="rounded-lg border border-emerald-300/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:border-emerald-300/50 disabled:opacity-50">{indexingDocumentId === document.id ? "Indexing..." : document.index_status === "indexed" ? "Reindex PDF" : "Index PDF"}</button>}
                      <button type="button" onClick={() => editDocument(document)} disabled={isSaving || busyDocumentId !== null || indexingDocumentId !== null} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-300/40 disabled:opacity-50">Edit</button>
                      {document.status !== "archived" && <button type="button" onClick={() => void archiveDocument(document)} disabled={busyDocumentId !== null || indexingDocumentId !== null || isSaving} className="rounded-lg border border-amber-300/20 px-3 py-2 text-xs font-semibold text-amber-100 hover:border-amber-300/50 disabled:opacity-50">{busyDocumentId === document.id ? "Archiving..." : "Archive"}</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={saveDocument} noValidate aria-busy={isSaving} className="h-fit rounded-2xl border border-white/10 bg-[#091522] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4"><h3 className="font-semibold text-white">{editingId ? "Edit metadata" : "Upload approved document"}</h3>{editingId && <button type="button" onClick={resetForm} disabled={isSaving} className="text-xs font-semibold text-slate-400 hover:text-white">Cancel</button>}</div>
          <div className="mt-5 space-y-4">
            <label className="block text-sm text-slate-300">Title<input className={inputClass} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} disabled={isSaving} maxLength={200} /></label>
            <label className="block text-sm text-slate-300">Document type<select className={inputClass} value={form.document_type} onChange={(event) => setForm((current) => ({ ...current, document_type: event.target.value as DocumentType }))} disabled={isSaving}>{Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="block text-sm text-slate-300">Linked equipment<select className={inputClass} value={form.equipment_id} onChange={(event) => setForm((current) => ({ ...current, equipment_id: event.target.value }))} disabled={isSaving}><option value="">General workspace document</option>{equipment.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.asset_tag ?? "no asset ID"}){item.status === "archived" ? " — archived" : ""}</option>)}</select></label>
            <label className="block text-sm text-slate-300">Revision / reference<input className={inputClass} value={form.source_revision} onChange={(event) => setForm((current) => ({ ...current, source_revision: event.target.value }))} disabled={isSaving} maxLength={120} placeholder="Example: Rev. C / 3AXD50000044785" /></label>
            <label className="block text-sm text-slate-300">Description<textarea className={`${inputClass} min-h-24 resize-y`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={isSaving} maxLength={2000} /></label>
            {!editingId && <label className="block text-sm text-slate-300">File<input key={fileInputKey} className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:text-xs file:font-bold file:text-[#07111c]`} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={isSaving} /><span className="mt-2 block text-xs text-slate-500">PDF, PNG, JPG/JPEG, or WEBP · maximum 10 MB</span></label>}
          </div>
          {isSaving && !editingId && <div className="mt-4" role="status"><div className="mb-2 flex justify-between text-xs text-slate-400"><span>Uploading securely</span><span>{uploadProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>}
          {formError && <p role="alert" className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">{formError}</p>}
          {success && <p role="status" className="mt-4 rounded-xl border border-emerald-300/25 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-100">{success}</p>}
          <button type="submit" disabled={isSaving} className="mt-5 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-[#07111c] transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60">{isSaving ? editingId ? "Saving..." : "Uploading..." : editingId ? "Save metadata" : "Upload approved document"}</button>
        </form>
      </div>
    </section>
  );
}
