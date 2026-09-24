export type FaultReportStatus = "draft" | "active" | "resolved";

export type FaultReport = {
  id: string;
  equipment_id: string;
  equipment_name: string;
  equipment_asset_tag: string | null;
  fault_code: string | null;
  symptom: string;
  planned_task: string | null;
  operating_context: string | null;
  status: FaultReportStatus;
  ack_authorized_qualified: boolean;
  ack_loto_isolation: boolean;
  ack_ppe_stored_energy: boolean;
  ack_stop_escalate: boolean;
  activated_at: string | null;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolution_summary: string | null;
  created_by: string;
  technician_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolvedReportSummary = {
  id: string;
  equipment_id: string;
  equipment_name: string;
  equipment_asset_tag: string | null;
  fault_code: string | null;
  symptom: string;
  resolved_at: string;
  resolution_summary: string;
  created_by: string;
  report_owner: string | null;
};

export type DashboardReportSummary = {
  id: string;
  equipment_id: string;
  equipment_name: string;
  equipment_asset_tag: string | null;
  fault_code: string | null;
  symptom: string;
  status: FaultReportStatus;
  owner_user_id: string;
  owner_name: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_summary: string | null;
};

export type DashboardAffectedEquipment = {
  id: string;
  name: string;
  asset_tag: string | null;
  location: string | null;
  active_report_count: number;
};

export type DashboardActivity = {
  id: string;
  fault_report_id: string;
  equipment_name: string;
  equipment_asset_tag: string | null;
  report_status: FaultReportStatus;
  entry_type: WorkLogEntryType;
  note: string;
  author_user_id: string;
  author_name: string | null;
  created_at: string;
};

export type DashboardSummary = {
  role: "admin" | "technician";
  active_report_count: number;
  draft_report_count: number;
  resolved_report_count: number;
  recent_active_reports: DashboardReportSummary[];
  recent_draft_reports: DashboardReportSummary[];
  recent_resolved_reports: DashboardReportSummary[];
  equipment_with_active_reports: DashboardAffectedEquipment[];
  recent_activity: DashboardActivity[];
};

export type FaultReportAttachment = {
  id: string;
  fault_report_id: string;
  uploaded_by_user_id: string;
  file_name: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  size_bytes: number;
  created_at: string;
  can_delete: boolean;
};

export type WorkLogEntryType =
  | "observation"
  | "action_taken"
  | "measurement"
  | "escalation"
  | "resolution";

export type WorkLogEntry = {
  id: string;
  fault_report_id: string;
  author_user_id: string;
  author_name: string | null;
  entry_type: WorkLogEntryType;
  note: string;
  created_at: string;
};

export type ActiveEquipment = {
  id: string;
  name: string;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
  location: string | null;
  status: "active";
};

export type EvidenceExcerpt = {
  chunk_id: number;
  document_id: string;
  document_title: string;
  document_type: "manual" | "diagram" | "bulletin" | "fault_code_sheet";
  source_revision: string | null;
  page_number: number;
  excerpt: string;
  equipment_linked: boolean;
  source_url: string;
  source_url_expires_in: number;
};

export type CitedStatement = {
  text: string;
  citation_ids: number[];
};

export type GuidanceCheck = {
  title: string;
  supported_action: string;
  citation_ids: number[];
};

export type GuidanceEvidence = Omit<EvidenceExcerpt, "source_url" | "source_url_expires_in"> & {
  source_available: boolean;
  source_url: string | null;
  source_url_expires_in: number | null;
};

export type GuidancePlan = {
  id: string;
  fault_report_id: string;
  status: "grounded" | "insufficient_evidence";
  case_summary: CitedStatement;
  safety_brief_items: CitedStatement[];
  guided_checks: GuidanceCheck[];
  escalation_criteria: CitedStatement[];
  evidence_citation_ids: number[];
  evidence: GuidanceEvidence[];
  model: string | null;
  created_by: string;
  created_at: string;
};

export type EvidenceRetrievalResponse = {
  report_id: string;
  evidence: EvidenceExcerpt[];
  message: string;
};

export const SAFETY_ACKNOWLEDGEMENTS = [
  {
    key: "ack_authorized_qualified",
    label: "I am authorized and qualified for this work.",
  },
  {
    key: "ack_loto_isolation",
    label: "I will follow the site's approved LOTO and isolation procedure.",
  },
  {
    key: "ack_ppe_stored_energy",
    label: "I will use required PPE and verify stored-energy and electrical hazards.",
  },
  {
    key: "ack_stop_escalate",
    label: "I will stop and escalate if conditions are unsafe or uncertain.",
  },
] as const;

export function formatReportDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
