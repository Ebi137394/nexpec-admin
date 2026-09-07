-- ════════════════════════════════════════════════════════════════════════════
--  Stop sending real users to a 404.
--
--  ROOT CAUSE. nx_role_profile_path() (migration 20260801636000, mine) returned
--  '/client/profile' and '/inspector/profile'. NEITHER ROUTE HAS EVER EXISTED
--  in the web app — the real destinations are /client/settings and
--  /inspector/settings. I picked those paths without checking src/app, so every
--  onboarding email and profile CTA sent to a real user 404'd.
--
--  THE FIX IS NOT A BETTER HARD-CODED PATH. Any role path baked into a stored
--  link rots the moment a route is renamed or a role is changed. Links now
--  point at /profile, which resolves the role SERVER-SIDE from the session at
--  click time. One destination, no role guessing, and it cannot rot.
--
--  Admin-facing alerts keep pointing at /admin/users/<uuid>: an admin must land
--  on the record for the person, never on that person's own profile screen.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nx_role_profile_path(p_role text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  -- Deliberately role-independent. Kept as a function (rather than inlining the
  -- literal) so every existing caller picks the change up, and so a future
  -- role-specific destination has one place to live.
  SELECT '/profile'::text;
$$;
REVOKE ALL ON FUNCTION public.nx_role_profile_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_role_profile_path(text) TO authenticated, service_role;

-- ── Repair rows already written ───────────────────────────────────────────
--  These links were mailed to real people; leaving them broken is not an
--  option, and the /profile resolver makes them all valid.
UPDATE public.notifications
   SET link_href = '/profile'
 WHERE link_href ~ '^/(client|inspector|supplier)/profile$';

UPDATE public.notifications
   SET email_template_data = jsonb_set(email_template_data, '{profile_path}', '"/profile"')
 WHERE email_template_data ? 'profile_path'
   AND email_template_data->>'profile_path' ~ '^/(client|inspector|supplier)/profile$';

-- NOTE ON ADMIN ROWS. The admin's own '/client/profile' rows are repaired by
-- the UPDATE above, which is correct: they are that person's own onboarding.
-- The remaining admin rows on user routes are pre-existing 'Job approved'
-- notifications pointing at /client/jobs/<id>; those predate this work and are
-- deliberately NOT rewritten here — silently redirecting unrelated historical
-- notifications is not part of fixing this bug.

-- ── Guard: this class of bug must fail loudly next time ───────────────────
--  A link producer can only be validated against routes that actually ship, so
--  this records the contract the web app must satisfy. scripts/qa checks it.
COMMENT ON FUNCTION public.nx_role_profile_path(text) IS
  'Returns the canonical self-service profile route. MUST resolve to a route that exists in apps/web/src/app. Verified by scripts/qa/check-notification-links.mjs; /client/profile and /inspector/profile were 404s in Production on 2026-09-07.';
