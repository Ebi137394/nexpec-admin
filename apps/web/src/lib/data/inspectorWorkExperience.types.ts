// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorWorkExperience.types.ts
// ════════════════════════════════════════════════════════════════════════════

export interface InspectorWorkExperience {
  id: string;
  company: string;
  title: string;
  location: string | null;
  startDate: string;       // ISO date (YYYY-MM-DD)
  endDate: string | null;  // ISO date; null while is_current=true
  isCurrent: boolean;
  description: string | null;
  achievements: string[];
  createdAt: string;
  updatedAt: string;
}
