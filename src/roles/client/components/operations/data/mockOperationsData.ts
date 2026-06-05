// ─────────────────────────────────────────────────────────────
// NEXPEC — Realistic Mock Data for Operations Dashboard
// ─────────────────────────────────────────────────────────────

import {
  Inspector,
  HeatmapCell,
  CriticalAlert,
} from '../types/operations.types';

// ── Pipeline Stages (matches OperationsDashboard.tsx structure) ──────────────────────────────────────────
export const mockPipelineStages = [
  { id: 'S1', label: 'Mobilization', status: 'completed', timestamp: '06:14 AM' },
  { id: 'S2', label: 'Pre-Inspection', status: 'completed', timestamp: '07:32 AM' },
  { id: 'S3', label: 'Field Audit', status: 'active', timestamp: '09:48 AM' },
  { id: 'S4', label: 'Lab Analysis', status: 'pending' },
  { id: 'S5', label: 'Report Gen', status: 'pending' },
  { id: 'S6', label: 'Sign-Off', status: 'pending' },
];

// ── Inspectors (matches OperationsDashboard.tsx structure) ───────────────────────────────────────────────
export const mockInspectors: Inspector[] = [
  {
    id: 'INS-001',
    name: 'Cpt. M. Rivera',
    role: 'Lead Inspector',
    zone: 'Zone Alpha',
    status: 'on-site',
    signalStrength: 94,
    lastPing: '2s ago',
    avatar: 'MR',
  },
  {
    id: 'INS-002',
    name: 'Lt. K. Tanaka',
    role: 'NDT Specialist',
    zone: 'Zone Bravo',
    status: 'on-site',
    signalStrength: 87,
    lastPing: '5s ago',
    avatar: 'KT',
  },
  {
    id: 'INS-003',
    name: 'Sgt. A. Novak',
    role: 'Structural Engineer',
    zone: 'Zone Charlie',
    status: 'in-transit',
    signalStrength: 62,
    lastPing: '12s ago',
    avatar: 'AN',
  },
  {
    id: 'INS-004',
    name: 'Dr. S. Okafor',
    role: 'Materials Analyst',
    zone: 'Zone Delta',
    status: 'idle',
    signalStrength: 100,
    lastPing: '1m ago',
    avatar: 'SO',
  },
  {
    id: 'INS-005',
    name: 'Eng. L. Petrov',
    role: 'QA Auditor',
    zone: 'Zone Alpha',
    status: 'on-site',
    signalStrength: 78,
    lastPing: '8s ago',
    avatar: 'LP',
  },
];

// ── Compliance Heatmap (4x4 Grid = 16 Zones) (matches OperationsDashboard.tsx structure) ────────────────
export const mockHeatmapData: HeatmapCell[] = [
  { row: 0, col: 0, zone: 'A1', risk: 'low', defectCount: 1, label: 'Hull-FWD' },
  { row: 0, col: 1, zone: 'A2', risk: 'moderate', defectCount: 4, label: 'Hull-MID' },
  { row: 0, col: 2, zone: 'A3', risk: 'high', defectCount: 7, label: 'Hull-AFT' },
  { row: 0, col: 3, zone: 'A4', risk: 'low', defectCount: 0, label: 'Hull-STB' },
  { row: 1, col: 0, zone: 'B1', risk: 'none', defectCount: 0, label: 'Deck-01' },
  { row: 1, col: 1, zone: 'B2', risk: 'critical', defectCount: 12, label: 'Deck-02' },
  { row: 1, col: 2, zone: 'B3', risk: 'moderate', defectCount: 3, label: 'Deck-03' },
  { row: 1, col: 3, zone: 'B4', risk: 'high', defectCount: 6, label: 'Deck-04' },
  { row: 2, col: 0, zone: 'C1', risk: 'moderate', defectCount: 2, label: 'Engine-P' },
  { row: 2, col: 1, zone: 'C2', risk: 'low', defectCount: 1, label: 'Engine-S' },
  { row: 2, col: 2, zone: 'C3', risk: 'critical', defectCount: 9, label: 'Boiler-1' },
  { row: 2, col: 3, zone: 'C4', risk: 'none', defectCount: 0, label: 'Boiler-2' },
  { row: 3, col: 0, zone: 'D1', risk: 'high', defectCount: 5, label: 'Ballast-F' },
  { row: 3, col: 1, zone: 'D2', risk: 'low', defectCount: 0, label: 'Ballast-A' },
  { row: 3, col: 2, zone: 'D3', risk: 'moderate', defectCount: 3, label: 'Cargo-1' },
  { row: 3, col: 3, zone: 'D4', risk: 'critical', defectCount: 11, label: 'Cargo-2' },
];

// ── Critical Alerts (matches OperationsDashboard.tsx structure) ──────────────────────────────────────────
export const mockCriticalAlerts: CriticalAlert[] = [
  {
    id: 'CA-001',
    type: 'critical_finding',
    message: '⚠ CRITICAL: Deck-02 structural fatigue exceeds threshold, immediate review required',
    zone: 'B2',
    severity: 'critical',
    timestamp: '09:41 AM',
    priority: 'high',
  },
  {
    id: 'CA-002',
    type: 'critical_finding',
    message: '⚠ CRITICAL: Boiler-1 corrosion depth at 4.2mm, exceeds class limit of 3.0mm',
    zone: 'C3',
    severity: 'critical',
    timestamp: '09:38 AM',
    priority: 'high',
  },
  {
    id: 'CA-003',
    type: 'critical_finding',
    message: '⚠ CRITICAL: Cargo-2 coating breakdown, active pitting observed across 60% surface',
    zone: 'D4',
    severity: 'critical',
    timestamp: '09:35 AM',
    priority: 'high',
  },
  {
    id: 'CA-004',
    type: 'critical_finding',
    message: '⚠ WARNING: Hull-AFT shows moderate wastage pattern, schedule follow-up NDT',
    zone: 'A3',
    severity: 'warning',
    timestamp: '09:22 AM',
    priority: 'medium',
  },
];

// ── Operational Metrics (matches OperationsDashboard.tsx structure) ──────────────────────────────────────
export const mockOperationalMetrics = [
  { label: 'Zones Cleared', value: '9/16', delta: '+3', trend: 'up', color: '#10B981' },
  { label: 'Active Defects', value: '47', delta: '+5', trend: 'up', color: '#EF4444' },
  { label: 'Compliance', value: '82%', delta: '+2.4%', trend: 'up', color: '#3B82F6' },
  { label: 'Time Elapsed', value: '3h 34m', delta: '', trend: 'neutral', color: '#F59E0B' },
];

// ── Aggregated Operations Data ───────────────────────────────
export const mockOperationsData = {
  pipelineStages: mockPipelineStages,
  inspectors: mockInspectors,
  heatmapData: mockHeatmapData,
  criticalAlerts: mockCriticalAlerts,
  operationalMetrics: mockOperationalMetrics,
  summary: {
    totalInspections: 48,
    completedToday: 34,
    criticalFindings: 4,
    complianceRate: 78.5,
    activeInspectors: 3,
  },
  projectName: 'NEXPEC Operations Command Center',
  projectCode: 'NXP-OPS-2025-001',
  lastUpdated: 'Today, 09:48 AM',
};
