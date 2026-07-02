// app/find-jobs.tsx
//
// RETIRED — Final Lockdown (2026-06-25).
//
// This legacy screen let an inspector "claim" a job by INSERTing a `reports`
// row and writing `jobs.status` directly — a hard violation of the
// admin-brokered model (no admin dispatch, no `contractor_id` set) that also
// wrote an invalid enum value ('In_Progress'). It additionally queried
// status = 'Open' (capitalised), which no longer matches the lowercase `jobs`
// status enum, so it had already stopped returning any jobs.
//
// All inspector job discovery now flows through the modern, price-blind,
// broker-compliant surface:
//     browse → /(tabs)/jobs  →  open a job  →  /(inspector)/jobs/[id]/apply
// which creates an `applications` row (status pending). Only the NEXPEC admin
// dispatches (admin_dispatch_job), setting jobs.contractor_id + status.
//
// This stub preserves the /find-jobs route as a redirect so any lingering
// link lands on the correct flow instead of the retired bypass.
import { Redirect } from 'expo-router';

export default function FindJobsRetired() {
  return <Redirect href="/(tabs)/jobs" />;
}
