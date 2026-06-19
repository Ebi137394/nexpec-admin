// Client Dashboard Components
export { default as AssetVault } from './assets/AssetVault';
export { default as OrganizationManager } from './team/OrganizationManager';

// Financial Components
export { default as BudgetOverview } from './finance/BudgetOverview';
export { default as InvoiceApprover } from './finance/InvoiceApprover';
export { default as ComplianceAudit } from './finance/ComplianceAudit';

// Export SpendingAnalytics as named export to avoid conflict
export { default as SpendingAnalytics } from './finance/SpendingAnalytics';

// Legacy Components (for backward compatibility)
export { default as CriticalAlerts } from './CriticalAlerts';
export { default as RiskHeatmap } from './RiskHeatmap';
export { default as AssetSearch } from './AssetSearch';
export { default as FinancialsMiniView } from './FinancialsMiniView';
export { default as ClientProfileView } from './ClientProfileView';
export { default as CompanyManager } from './profile/CompanyManager';
export { default as NotificationHistory } from './profile/NotificationHistory';
export { default as BillingPortal } from './profile/BillingPortal';
export { default as ProjectList } from './ProjectList';
export { default as ReportConfigurator } from './reports/ReportConfigurator';
export { default as WebReportShare } from './sharing/WebReportShare';
export { default as BatchActionBar } from './actions/BatchActionBar';
export { default as BatchActionBarSimple } from './actions/BatchActionBarSimple';
export { default as TestHooks } from './TestHooks';
export { default as TestSupabase } from './TestSupabase';
export { default as FrontierScreen } from '@/src/components/frontier/FrontierScreen';
export { default as AudioDiagnose } from '@/src/components/frontier/audio/AudioDiagnose';
export { default as TimeLapseViewer } from '@/src/components/frontier/vision/TimeLapseViewer';
export { default as LiveStreamHub } from '@/src/components/frontier/streaming/LiveStreamHub';
export { default as FrontierLab } from '@/src/screens/frontier/FrontierLab';
export { default as ProfileIntegrationGuide } from '@/src/screens/frontier/ProfileIntegrationGuide';
export { default as ClientDashboard } from '@/src/screens/client/ClientDashboard';
export { default as InspectionPipeline } from './InspectionPipeline';
export { default as DocumentVault } from './project/DocumentVault';
export { default as AssetHistory } from './project/AssetHistory';
export { default as VisualReview } from './project/VisualReview';
export { default as MilestoneManager } from './project/MilestoneManager';
export { default as SmartAnalysis } from './network/SmartAnalysis';
export { default as PreferredNetwork } from './network/PreferredNetwork';
export { default as TeamManager } from './network/TeamManager';
