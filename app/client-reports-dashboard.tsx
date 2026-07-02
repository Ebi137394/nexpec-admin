// app/client-reports-dashboard.tsx — RETIRED (Zero-Defect sweep).
//
// This was a developer DIAGNOSTIC screen: it fetched `projects` and `reports`
// with `select('*')` and NO tenant filter ("Admin View - No Filter") and
// rendered a raw "DIAGNOSTICS MODE" dump of every report. Because the legacy
// `reports` table still carries a permissive `USING(true)` SELECT policy, a
// client reaching this screen would see EVERY tenant's reports — a cross-tenant
// data leak — plus debug UI shipping to production.
//
// Client report viewing happens through the proper per-job surfaces
// (/(client)/jobs/[id]/review-report). This stub redirects to the client home
// so the diagnostic route can never dump cross-tenant data.
import { Redirect } from 'expo-router';

export default function RetiredClientReportsDashboard() {
  return <Redirect href="/(client)" />;
}
