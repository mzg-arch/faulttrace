export type FaultReportStatus = "draft" | "active";

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
  created_by: string;
  technician_name: string | null;
  created_at: string;
  updated_at: string;
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
