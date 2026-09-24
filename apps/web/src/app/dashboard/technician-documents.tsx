"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { API_ORIGIN, apiErrorMessage, authenticatedFetch } from "@/lib/faulttrace-api";
import {
  DOCUMENT_TYPE_LABELS,
  formatFileSize,
  type DocumentType,
  type LibraryDocument,
} from "./document-types";

export function TechnicianDocuments({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DocumentType>("all");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await authenticatedFetch(`${API_ORIGIN}/workspaces/${workspaceId}/documents`);
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Documents could not be loaded."));
      }
      setDocuments((await response.json()) as LibraryDocument[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Documents could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDocuments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  const equipmentOptions = useMemo(() => {
    const values = new Map<string, string>();
    documents.forEach((document) => {
      if (document.equipment_id && document.equipment_name) {
        values.set(document.equipment_id, document.equipment_name);
      }
    });
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [documents]);

  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return documents.filter((document) => {
      if (typeFilter !== "all" && document.document_type !== typeFilter) return false;
      if (equipmentFilter === "general" && document.equipment_id !== null) return false;
      if (equipmentFilter !== "all" && equipmentFilter !== "general" && document.equipment_id !== equipmentFilter) return false;
      if (!normalized) return true;
      return [document.title, document.source_revision, document.description, document.equipment_name]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized));
    });
  }, [documents, equipmentFilter, query, typeFilter]);

  async function openDocument(document: LibraryDocument) {
    if (openingId) return;
    setOpeningId(document.id);
    setLoadError(null);
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
      setLoadError(error instanceof Error ? error.message : "The document service is unavailable.");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <section id="documents" className="scroll-mt-6 rounded-lg border border-white/10 bg-[#151719] p-5 sm:p-6" aria-labelledby="technician-documents-title">
      <div className="border-b border-white/10 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Approved evidence sources</p>
        <h2 id="technician-documents-title" className="mt-2 text-xl font-semibold text-white">Available sources</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">Official workspace manuals, diagrams, bulletins, and fault-code sheets. Opening a document creates a temporary private link.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search approved documents..." className="rounded-md border border-white/15 bg-[#0d0f10] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-teal-300" />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | DocumentType)} className="rounded-md border border-white/15 bg-[#0d0f10] px-4 py-3 text-sm text-white outline-none focus:border-teal-300"><option value="all">All document types</option>{Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value)} className="rounded-md border border-white/15 bg-[#0d0f10] px-4 py-3 text-sm text-white outline-none focus:border-teal-300"><option value="all">All equipment</option><option value="general">General workspace documents</option>{equipmentOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        </div>
      </div>

      <div className="pt-7">
        {isLoading && <p role="status" className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">Loading approved documents...</p>}
        {loadError && <div role="alert" className="rounded-md border border-red-300/25 bg-red-300/5 p-4 text-sm text-red-100"><p>{loadError}</p><button type="button" onClick={() => void loadDocuments()} className="mt-3 font-semibold text-teal-200 hover:text-teal-100">Try again</button></div>}
        {!isLoading && !loadError && documents.length === 0 && <div className="rounded-lg border border-dashed border-white/15 p-7 text-center"><p className="font-medium text-zinc-200">No approved documents are available.</p><p className="mt-2 text-sm text-zinc-500">Your maintenance lead can add official evidence sources.</p></div>}
        {!isLoading && !loadError && documents.length > 0 && visibleDocuments.length === 0 && <p className="rounded-md border border-white/10 p-4 text-sm text-zinc-400">No approved documents match these filters.</p>}
        {!isLoading && !loadError && visibleDocuments.length > 0 && (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleDocuments.map((document) => (
              <li key={document.id} className="flex h-full flex-col rounded-lg border border-white/10 bg-[#111315] p-5">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-2.5 py-1 text-xs font-semibold text-emerald-200">approved</span><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-300">{DOCUMENT_TYPE_LABELS[document.document_type]}</span></div>
                <h3 className="mt-4 font-semibold text-white">{document.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-400">{document.description ?? "Approved workspace evidence source."}</p>
                <div className="mt-auto pt-5 text-xs text-zinc-500"><p>{document.equipment_name ?? "General workspace document"}</p><p className="mt-1">{document.source_revision ?? "Revision not provided"} · {formatFileSize(document.size_bytes)}</p></div>
                <button type="button" onClick={() => void openDocument(document)} disabled={openingId !== null} className="mt-5 rounded-md border border-teal-300/25 px-4 py-3 text-sm font-semibold text-teal-100 transition hover:border-teal-300/60 hover:bg-teal-300/5 disabled:opacity-50">{openingId === document.id ? "Creating secure link..." : "Open approved document"}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
