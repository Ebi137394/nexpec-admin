// lib/assetIntelligence.types.ts

// ── Raw DB row shapes ──────────────────────────────────────────
export interface AssetRow {
  id: string;
  tag_number: string;
  description: string | null;
  location: string | null;
  category: string | null;
  install_date: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InspectionEventRow {
  id: string;
  asset_id: string;
  type: "inspection" | "maintenance" | "incident" | "calibration" | "audit";
  result: "pass" | "fail" | "pending" | "n/a" | null;
  severity: "low" | "medium" | "high" | "critical" | null;
  summary: string | null;
  performed_by: string | null;
  performed_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  asset_id: string;
  event_id: string | null;
  title: string;
  file_url: string;
  file_type: string | null;
  file_size_kb: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  metadata: Record<string, unknown>;
}

export interface AlertRow {
  id: string;
  event_id: string;
  asset_id: string;
  alert_type: "critical_fail" | "incident" | "anomaly";
  title: string;
  message: string | null;
  severity: "medium" | "high" | "critical";
  status: "new" | "acknowledged" | "resolved" | "dismissed";
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

// ── Joined query result ────────────────────────────────────────
export interface InspectionEventWithDocs extends InspectionEventRow {
  documents: DocumentRow[];
}

export interface AssetWithHistory extends AssetRow {
  inspection_events: InspectionEventWithDocs[];
}

// ── Timeline UI models ─────────────────────────────────────────
export type TimelineItemStatus = "pass" | "fail" | "incident" | "pending" | "info";

export interface TimelineAttachment {
  id: string;
  title: string;
  fileUrl: string;
  fileType: string;
  fileSizeKb: number | null;
}

export interface TimelineItem {
  id: string;
  date: string;            // ISO string
  displayDate: string;     // human-readable
  type: string;
  status: TimelineItemStatus;
  title: string;
  summary: string;
  performedBy: string;
  severity: string | null;
  attachments: TimelineAttachment[];
  metadata: Record<string, unknown>;
}

export interface AssetIntelligenceResult {
  asset: {
    id: string;
    tagNumber: string;
    description: string;
    location: string;
    category: string;
    installDate: string | null;
  };
  timeline: TimelineItem[];
  totalEvents: number;
  criticalCount: number;
  lastInspection: string | null;
}

export interface QueryResult {
  success: boolean;
  data: AssetIntelligenceResult[];
  error: string | null;
  count: number;
}