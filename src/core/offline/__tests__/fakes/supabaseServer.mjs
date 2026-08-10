// ─────────────────────────────────────────────────────────────────
//  Fake `@/src/core/supabase/supabase`.
//
//  A miniature PostgREST + RLS simulator. The authorization predicates
//  below are transcribed 1:1 from the real migrations so that replay-time
//  authorization can be exercised without PostgreSQL (which cannot run in
//  this environment):
//
//   supabase/migrations/20260801378000_team_evidence_and_report_contribution.sql:82
//     captures_insert_team_member  (PERMISSIVE, INSERT)
//       inspector_id = auth.uid()
//       AND nx_is_active_job_team_member(job_id, auth.uid())
//     ...where nx_is_active_job_team_member (same file, :66-71) is
//       EXISTS job_inspectors ji
//        WHERE ji.job_id = $1 AND ji.inspector_id = $2
//          AND ji.status IN ('assigned','active')
//
//   supabase/migrations/00000000000000_remote_baseline.sql:29984
//     captures_insert_inspector_self  (PERMISSIVE, INSERT)
//       inspector_id = auth.uid()
//       AND EXISTS (jobs j WHERE j.id = job_id AND j.contractor_id = auth.uid())
//
//  Permissive policies OR together, so INSERT is allowed iff either holds.
//  Evaluated at CALL time — i.e. whenever the outbox handler actually fires.
// ─────────────────────────────────────────────────────────────────

const key = (jobId, inspectorId) => `${jobId}|${inspectorId}`;

export const server = {
  /** auth.uid() for the CURRENT session. null = signed out. */
  uid: null,
  /** jobId -> { contractor_id } */
  jobs: new Map(),
  /** `${jobId}|${inspectorId}` -> job_inspectors.status */
  team: new Map(),
  /** visitId -> { job_id, status } */
  visits: new Map(),
  /** inspection_captures, keyed by PK id */
  captures: new Map(),
  /** every storage object write, in order */
  storageWrites: [],
  /** refreshSession() outcome for the injected auth seam */
  sessionRefreshable: true,

  reset() {
    this.uid = null;
    this.jobs.clear();
    this.team.clear();
    this.visits.clear();
    this.captures.clear();
    this.storageWrites.length = 0;
    this.sessionRefreshable = true;
  },

  signInAs(uid) {
    this.uid = uid;
  },
  signOut() {
    this.uid = null;
  },

  addJob(jobId, contractorId) {
    this.jobs.set(jobId, { contractor_id: contractorId });
  },
  /** status: 'assigned' | 'active' | 'removed' | 'replaced' */
  setTeamStatus(jobId, inspectorId, status) {
    this.team.set(key(jobId, inspectorId), status);
  },
  addVisit(visitId, jobId, status = 'scheduled') {
    this.visits.set(visitId, { job_id: jobId, status });
  },

  // ── transcribed predicates ──────────────────────────────────────
  nx_is_active_job_team_member(jobId, uid) {
    const s = this.team.get(key(jobId, uid));
    return s === 'assigned' || s === 'active';
  },
  isContractor(jobId, uid) {
    return this.jobs.get(jobId)?.contractor_id === uid;
  },
  capturesInsertAllowed(row) {
    const uid = this.uid;
    if (!uid) return false;
    if (row.inspector_id !== uid) return false; // both policies require this
    return (
      this.nx_is_active_job_team_member(row.job_id, uid) || this.isContractor(row.job_id, uid)
    );
  },
  // nx_can_record_visit_work (20260801388000, amended by 396000). 'rescheduled'
  // is refused because the guard forwards past it before reaching here;
  // 'cancelled' is permitted so late offline evidence is never destroyed.
  canRecordVisitWork(visitId, uid) {
    const v = this.visits.get(visitId);
    if (!v || !uid) return false;
    if (v.status === 'rescheduled') return false;
    return (
      this.nx_is_active_job_team_member(v.job_id, uid) || this.isContractor(v.job_id, uid)
    );
  },
};

// ── PostgREST-shaped errors ──────────────────────────────────────
const errNoSession = () => ({
  status: 401,
  code: 'PGRST301',
  message: 'JWT expired',
});
const errRls = (table) => ({
  status: 403,
  code: '42501',
  message: `new row violates row-level security policy for table "${table}"`,
});
// 23514 — a CHECK/trigger rejection. shared-core classifies this as FATAL, so
// a capture that trips it is discarded permanently rather than retried. That
// is precisely why 396000 forwards superseded evidence instead of raising.
const errCheck = (detail) => ({
  status: 400,
  code: '23514',
  message: `new row for relation "inspection_captures" violates check constraint: ${detail}`,
});
const errDup = (constraint) => ({
  status: 409,
  code: '23505',
  message: `duplicate key value violates unique constraint "${constraint}"`,
});
const errFk = (constraint) => ({
  status: 409,
  code: '23503',
  message: `insert or update on table "inspection_captures" violates foreign key constraint "${constraint}"`,
});

function insertCapture(row) {
  if (!server.uid) return { data: null, error: errNoSession() };
  // Order matches Postgres: the RLS WITH CHECK expression is evaluated before
  // the unique index is consulted, so an unauthorized re-delivery reports
  // 42501 rather than 23505.
  if (!server.capturesInsertAllowed(row)) {
    return { data: null, error: errRls('inspection_captures') };
  }
  if (row.visit_id != null && !server.visits.has(row.visit_id)) {
    return { data: null, error: errFk('inspection_captures_visit_id_fkey') };
  }
  // ── 20260801388000 + 20260801396000 BEFORE-INSERT guards ──────────────────
  //  These were MISSING from this fake, which made it certify the opposite of
  //  production: captures on a cancelled/rescheduled visit and cross-job
  //  visit_id injection both "passed" here while Postgres rejects (or
  //  rewrites) them. Transcribed from tg_guard_capture_visit.
  let inserted = { ...row };
  if (inserted.visit_id != null) {
    const visit = server.visits.get(inserted.visit_id);

    // Job coherence — the cross-job injection guard (388000). Fails closed.
    if (visit.job_id !== inserted.job_id) {
      return { data: null, error: errCheck('visit belongs to a different job') };
    }

    // Supersession forwarding (396000): a reschedule must move late-arriving
    // offline evidence forward, never destroy it.
    let hops = 0;
    while (server.visits.get(inserted.visit_id)?.status === 'rescheduled' && hops < 50) {
      const next = [...server.visits.entries()]
        .find(([, v]) => v.rescheduled_from_id === inserted.visit_id);
      if (!next) break;
      inserted.visit_id = next[0];
      hops += 1;
    }
    // 'cancelled' is deliberately accepted — see 396000.

    // Actor rules (nx_can_record_visit_work): a removed inspector may not
    // record NEW work, though their history stays attributed.
    if (!server.canRecordVisitWork(inserted.visit_id, server.uid)) {
      return { data: null, error: errRls('inspection_captures') };
    }
  }
  if (server.captures.has(inserted.id)) {
    return { data: null, error: errDup('inspection_captures_pkey') };
  }
  server.captures.set(inserted.id, { visit_id: null, ...inserted });
  return { data: [inserted], error: null };
}

function insertGeneric(table, row) {
  if (!server.uid) return { data: null, error: errNoSession() };
  return { data: [row], error: null };
}

// ── minimal thenable query builder ───────────────────────────────
function makeBuilder(run) {
  const b = {
    eq() {
      return b;
    },
    select() {
      return Promise.resolve(run());
    },
    maybeSingle() {
      return Promise.resolve(run());
    },
    then(res, rej) {
      return Promise.resolve(run()).then(res, rej);
    },
  };
  return b;
}

export const supabase = {
  from(table) {
    return {
      insert(row) {
        return makeBuilder(() =>
          table === 'inspection_captures' ? insertCapture(row) : insertGeneric(table, row),
        );
      },
      update() {
        return makeBuilder(() => ({ data: [], error: null }));
      },
      select() {
        return makeBuilder(() => ({ data: null, error: null }));
      },
    };
  },

  rpc(name, args) {
    return Promise.resolve({ data: null, error: server.uid ? null : errNoSession() });
  },

  storage: {
    from(bucket) {
      return {
        async upload(path, bytes, opts) {
          if (!server.uid) return { data: null, error: errNoSession() };
          server.storageWrites.push({ bucket, path, uid: server.uid, bytes: bytes?.length ?? 0 });
          return { data: { path }, error: null };
        },
      };
    },
  },

  auth: {
    async refreshSession() {
      return server.sessionRefreshable && server.uid
        ? { data: { session: { access_token: 'tok' } }, error: null }
        : { data: { session: null }, error: { message: 'refresh_token_not_found' } };
    },
  },
};

export default { supabase };
