export type DocumentType = "manual" | "diagram" | "bulletin" | "fault_code_sheet";
export type DocumentStatus = "draft" | "approved" | "archived";
export type DocumentIndexStatus =
  | "not_indexed"
  | "indexing"
  | "indexed"
  | "no_text"
  | "failed"
  | "unsupported";

export type LibraryDocument = {
  id: string;
  title: string;
  document_type: DocumentType;
  status: DocumentStatus;
  equipment_id: string | null;
  equipment_name: string | null;
  source_revision: string | null;
  description: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  index_status: DocumentIndexStatus;
  indexed_at: string | null;
  indexed_page_count: number;
  indexed_chunk_count: number;
  indexing_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type EquipmentOption = {
  id: string;
  name: string;
  asset_tag: string | null;
  status: "active" | "archived";
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  manual: "Manual",
  diagram: "Diagram",
  bulletin: "Bulletin",
  fault_code_sheet: "Fault-code sheet",
};

export function formatFileSize(size: number | null) {
  if (size === null) return "Size unavailable";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function documentIndexLabel(document: LibraryDocument) {
  if (document.content_type !== "application/pdf") return "Not text-searchable";
  if (document.index_status === "indexed") {
    return `${document.indexed_page_count} searchable page${document.indexed_page_count === 1 ? "" : "s"}`;
  }
  const labels: Record<DocumentIndexStatus, string> = {
    not_indexed: "PDF not indexed",
    indexing: "Indexing PDF",
    indexed: "PDF indexed",
    no_text: "No readable PDF text",
    failed: "PDF indexing failed",
    unsupported: "Not text-searchable",
  };
  return labels[document.index_status];
}
