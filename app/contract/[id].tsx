// app/contract/[id].tsx — RETIRED (Hardening Step 2).
//
// This was the legacy v2 contract screen (the `contracts` table). Its sign flow
// did a blind `update({ status: 'signed' })` that reported "Contract Signed ✅"
// even on a 0-row result (already-cancelled / RLS-filtered) — a false-success,
// and it was not offline-durable.
//
// The canonical, broker-compliant, offline-durable signing flow is the V3
// job-contract screen (`app/contracts/job/[id].tsx`, table `job_contracts`,
// via client_sign_job_contract / inspector_sign_job_contract RPCs routed
// through the offline outbox). This stub redirects so any lingering
// /contract/[id] deep link lands on the contracts list instead of the unsafe
// legacy screen.
import { Redirect } from 'expo-router';

export default function RetiredContractScreen() {
  return <Redirect href="/contracts" />;
}
