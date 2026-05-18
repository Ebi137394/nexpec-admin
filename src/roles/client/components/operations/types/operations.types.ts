// Operations Dashboard Types
export interface ProjectStage {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'reviewing' | 'finalized';
  order: number;
  description: string;
}

export interface InspectorStatus {
  id: string;
  name: string;
  avatar: string;
  status: 'online' | 'offline' | 'on-site' | 'working' | 'in-transit' | 'idle';
  lastSeen: string;
  location?: string;
}

export interface ComplianceHeatmapData {
  id: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'clean' | 'moderate' | 'not_inspected';
  score: number;
  description: string;
  trend: 'improving' | 'stable' | 'declining';
}

export interface CriticalAlert {
  id: string;
  type: 'critical_finding' | 'deadline_approaching' | 'budget_exceeded';
  message: string;
  timestamp: string;
  priority: 'high' | 'medium' | 'low';
  projectId?: string;
  title?: string;
  isNew?: boolean;
  severity?: string;
  zone?: string;
  inspectorName?: string;
  description?: string;
  findingType?: string;
}

export interface OperationsDashboardData {
  projectStages: ProjectStage[];
  inspectorStatus: InspectorStatus;
  heatmapData: ComplianceHeatmapData[];
  criticalAlerts: CriticalAlert[];
}

// New OperationsDashboard.tsx types
export interface PipelineStage {
  id: string;
  label: string;
  status: 'completed' | 'active' | 'pending';
  timestamp?: string;
}

export interface Inspector {
  id: string;
  name: string;
  role: string;
  zone: string;
  status: 'on-site' | 'in-transit' | 'idle' | 'offline';
  signalStrength: number;
  lastPing: string;
  avatar: string;
}

export interface HeatmapCell {
  row: number;
  col: number;
  zone: string;
  risk: 'low' | 'moderate' | 'high' | 'critical' | 'none';
  defectCount: number;
  label: string;
}

export interface OperationalMetric {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down' | 'neutral';
  color: string;
}

// Legacy types for backward compatibility
export type OperationsData = {
  pipelineSteps: PipelineStep[];
  inspector: Inspector;
  heatmapCells: HeatmapCell[];
  criticalAlerts: CriticalAlert[];
};

export interface PipelineStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  description: string;
  order: number;
}

export type HeatmapRiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'clean' | 'moderate' | 'not_inspected';
