-- ════════════════════════════════════════════════════════════════════════════
--  Repair admin deep links that point at routes which do not exist.
--
--  Found by the new notification-link guard, which checks every SQL link
--  producer against the routes that actually ship. Two of mine were wrong:
--    /admin          -> apps/web/src/app/admin has NO page.tsx, so it 404s once
--                       middleware lets an authenticated admin past. The real
--                       landing route is /admin/dashboard.
--    /admin/support  -> never existed. The real route is /admin/messages.
--
--  Unauthenticated HTTP could not reveal this: middleware answers 307 for every
--  admin path before the route resolves, so a missing route and a real one look
--  identical from outside. The filesystem is the only honest oracle.
--
--  The baseline's /inspector/payouts and /client/reviews are missing too, but
--  they predate this work and live in an already-applied squashed migration,
--  which this project forbids editing in place. Reported, not touched.
-- ════════════════════════════════════════════════════════════════════════════

-- Existing rows first.
UPDATE public.notifications SET link_href = '/admin/dashboard' WHERE link_href = '/admin';
UPDATE public.notifications SET link_href = '/admin/messages'  WHERE link_href = '/admin/support';

-- Then the producers. tg_attention_queue emits both bad paths in its item rows.
CREATE OR REPLACE FUNCTION public.nx_admin_link(p_path text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_path
           WHEN '/admin'         THEN '/admin/dashboard'
           WHEN '/admin/support' THEN '/admin/messages'
           ELSE p_path
         END;
$$;
REVOKE ALL ON FUNCTION public.nx_admin_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_admin_link(text) TO authenticated, service_role;
