// src/types/database.types.ts

export type ProjectStatus =
  | "active"
  | "pending"
  | "completed"
  | "on_hold"
  | "cancelled";

export type InspectionStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type Priority = "critical" | "high" | "medium" | "low";

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          name: string;
          client_name: string;
          status: ProjectStatus;
          priority: Priority;
          location: string;
          latitude: number | null;
          longitude: number | null;
          progress: number;
          start_date: string;
          end_date: string | null;
          budget: number;
          spent: number;
          team_lead_id: string | null;
          team_size: number;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["projects"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["projects"]["Insert"]
        >;
      };
      inspection_events: {
        Row: {
          id: string;
          project_id: string;
          inspector_id: string;
          inspector_name: string;
          type: string;
          status: InspectionStatus;
          priority: Priority;
          title: string;
          description: string | null;
          location: string;
          scheduled_at: string;
          completed_at: string | null;
          findings_count: number;
          critical_findings: number;
          score: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["inspection_events"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["inspection_events"]["Insert"]
        >;
      };
      assets: {
        Row: {
          id: string;
          tag_number: string;
          description: string | null;
          location: string | null;
          category: string | null;
          install_date: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["assets"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["assets"]["Insert"]
        >;
      };
      documents: {
        Row: {
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
        };
        Insert: Omit<
          Database["public"]["Tables"]["documents"]["Row"],
          "id" | "uploaded_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["documents"]["Insert"]
        >;
      };
      alerts: {
        Row: {
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
        };
        Insert: Omit<
          Database["public"]["Tables"]["alerts"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<
          Database["public"]["Tables"]["alerts"]["Insert"]
        >;
      };
    };
  };
}

// Convenience aliases
export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type InspectionEvent =
  Database["public"]["Tables"]["inspection_events"]["Row"];