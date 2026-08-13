# Behavioural run harness (pgTAP-free)

`senior_review_behaviour_run.sql` is the executable twin of
`../senior_review_behaviour_test.sql`.

**Why it exists.** pgTAP is not installed in the authoring sandbox, so the
pgTAP suite next door is written but unexecuted. This file asserts the SAME 24
behaviours using three tiny `pg_temp` helpers (`throws` / `lives` / `eq`)
instead of pgTAP, so the logic can be proved on a bare PostgreSQL.

**It is not a replacement.** It runs against a stub schema, not the real
157-migration chain. When pgTAP and a real Supabase are available, run the
pgTAP suite — that is the authority. This is what stops the behaviours going
unverified in the meantime.

    psql "$URL" -X -tA -f senior_review_behaviour_run.sql | grep -E '^(ok|FAIL)'

Last run: PostgreSQL 18.4, 24/24 ok.
