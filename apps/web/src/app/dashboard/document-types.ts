export type DocumentType = "manual" | "diagram" | "bulletin" | "fault_code_sheet";
export type DocumentStatus = "draft" | "approved" | "archived";

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
