// src/types/network.ts
// ──────────────────────────────────────────────
// Network & Intelligence Domain Types
// ──────────────────────────────────────────────

export interface Certification {
  id: string;
  code: string;
  label: string;
  issuedBy: string;
  expiresAt: string;
  verified: boolean;
}

export interface EquipmentCalibration {
  id: string;
  instrument: string;
  lastCalibrated: string;
  nextDue: string;
  status: "current" | "expiring_soon" | "expired";
}

export interface InspectorProfile {
  id: string;
  name: string;
  avatarUri: string;
  company: string;
  location: string;
  dailyRate: number;
  starRating: number;
  totalReviews: number;
  completedJobs: number;
  avgCompletionDays: number;
  findingsAccuracy: number; // 0–1
  specializations: string[];
  certifications: Certification[];
  equipment: EquipmentCalibration[];
  availableFrom: string;
  isPreferred: boolean;
  inviteOnly: boolean;
}

export interface MatchAnalysis {
  inspectorId: string;
  jobType: string;
  costEfficiency: number;   // 0–100
  qualityScore: number;     // 0–100
  speedScore: number;       // 0–100
  matchScore: number;       // 0–100 weighted
  recommendation: "top_choice" | "strong_match" | "good_fit" | "review_needed";
  reasons: string[];
}

export type TeamRole = "admin" | "tech_viewer" | "accountant" | "project_manager";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatarUri: string;
  role: TeamRole;
  title: string;
  department: string;
  joinedAt: string;
  lastActive: string;
  isOnline: boolean;
  permissions: {
    canApproveBids: boolean;
    canReleaseFunds: boolean;
    canViewReports: boolean;
    canManageTeam: boolean;
    canCreateProjects: boolean;
  };
}

export interface TeamInvite {
  email: string;
  role: TeamRole;
  message?: string;
}