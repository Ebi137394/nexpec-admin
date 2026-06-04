-- ════════════════════════════════════════════════════════════════════════════
--  20260801121000_tool_foundry_core.sql
--
--  THE TOOL FOUNDRY — Phase 1 (Server-Driven Engineering Tools)
--
--  A calculator is a row. Its inputs render through your existing DynamicForm
--  (FormField[]); its math is a sandboxed JSONB DSL evaluated by one function;
--  its result is projected into the JSON-driven list you already ship; and every
--  run is canonical-JSON SHA-256 hashed into the trust spine.
--
--  Adding a new tool = INSERT one row. No deploy, no screen, no client change.
--
--  Contents
--    1. Tables       engineering_tools · tool_reference_data · tool_runs · tool_pro_grants
--    2. RLS + grants (public read of active tools; runs are private; least-privilege)
--    3. DSL engine   _tool_num · _tool_eval (recursive, depth-limited, whitelist-only)
--    4. Surface      tool_eval · tool_validate_inputs · tool_project · tool_invoke
--    5. Seeds        reference data (unit_si, rt_hvl) + 12 cross-discipline calculators
--    6. Self-test    in-migration DO block — a wrong formula FAILS the deploy
--
--  Safe to re-run: tables IF NOT EXISTS, functions CREATE OR REPLACE, seeds UPSERT.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() / gen_random_uuid()

-- ════════════════════════════════════════════════════════════════════════
--  1) TABLES
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.engineering_tools (
  key            text PRIMARY KEY,
  category       text NOT NULL,
  title          text NOT NULL,
  subtitle       text,
  icon_token     text,
  input_schema   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- FormField[]  (renders via DynamicForm)
  output_schema  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { cards:[{key,label,unit,round,tone}] }
  engine         text  NOT NULL DEFAULT 'dsl',          -- 'dsl' | 'edge'
  formula        jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { let:[{name:expr}], outputs:{name:expr} }
  reference_key  text,
  standards_refs text[] NOT NULL DEFAULT '{}',
  access_tier    text  NOT NULL DEFAULT 'free',         -- 'free' | 'pro'
  spec_version   int   NOT NULL DEFAULT 1,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineering_tools_category_chk CHECK (category = ANY (ARRAY[
    'ndt','welding','mechanical','civil','electrical','chemical','industrial','general','document'])),
  CONSTRAINT engineering_tools_engine_chk   CHECK (engine = ANY (ARRAY['dsl','edge'])),
  CONSTRAINT engineering_tools_tier_chk     CHECK (access_tier = ANY (ARRAY['free','pro']))
);
CREATE INDEX IF NOT EXISTS engineering_tools_active_cat_idx
  ON public.engineering_tools (category) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.tool_reference_data (
  reference_key  text NOT NULL,
  payload        jsonb NOT NULL,
  source         text,
  spec_version   int  NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reference_key, spec_version)
);

CREATE TABLE IF NOT EXISTS public.tool_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key      text NOT NULL,
  tool_version  int  NOT NULL,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,  -- null = anonymous
  inputs        jsonb NOT NULL,
  outputs       jsonb NOT NULL,
  input_sha256  text NOT NULL,
  result_sha256 text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_runs_actor_idx ON public.tool_runs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_runs_tool_idx  ON public.tool_runs (tool_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tool_pro_grants (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  revoked    boolean NOT NULL DEFAULT false,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════
--  2) RLS + GRANTS
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.engineering_tools  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_reference_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_pro_grants    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tools_read  ON public.engineering_tools;
CREATE POLICY tools_read  ON public.engineering_tools FOR SELECT USING (is_active);
DROP POLICY IF EXISTS tools_admin ON public.engineering_tools;
CREATE POLICY tools_admin ON public.engineering_tools FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- reference data: admin-managed; the SECURITY DEFINER engine reads it as table owner.
DROP POLICY IF EXISTS refdata_admin ON public.tool_reference_data;
CREATE POLICY refdata_admin ON public.tool_reference_data FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

-- runs: a user sees their own; admin sees all; writes happen only via the definer RPC.
DROP POLICY IF EXISTS tool_runs_read ON public.tool_runs;
CREATE POLICY tool_runs_read ON public.tool_runs FOR SELECT USING (actor_id = auth.uid() OR public.nx_is_admin());

DROP POLICY IF EXISTS pro_grants_self  ON public.tool_pro_grants;
CREATE POLICY pro_grants_self  ON public.tool_pro_grants FOR SELECT USING (user_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS pro_grants_admin ON public.tool_pro_grants;
CREATE POLICY pro_grants_admin ON public.tool_pro_grants FOR ALL USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());

GRANT SELECT ON public.engineering_tools TO anon, authenticated;
GRANT SELECT ON public.tool_runs         TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
--  3) DSL ENGINE  (sandboxed: operator whitelist, depth-limited, no I/O, no SQL)
-- ════════════════════════════════════════════════════════════════════════

-- canonical-JSON hash helper — folds into the existing seal spine when present.
CREATE OR REPLACE FUNCTION public._tool_canon(j jsonb)
RETURNS text LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF to_regprocedure('public.pi_canonical_json(jsonb)') IS NOT NULL THEN
    RETURN public.pi_canonical_json(j);
  END IF;
  RETURN j::text;
END $$;

-- evaluate a node to a NUMERIC (casts numbers/numeric-strings/booleans).
CREATE OR REPLACE FUNCTION public._tool_num(node jsonb, ctx jsonb, depth int)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE r jsonb;
BEGIN
  r := public._tool_eval(node, ctx, depth);
  IF r IS NULL OR jsonb_typeof(r) = 'null' THEN
    RAISE EXCEPTION 'dsl_null_value';
  ELSIF jsonb_typeof(r) = 'number'  THEN RETURN (r #>> '{}')::numeric;
  ELSIF jsonb_typeof(r) = 'boolean' THEN RETURN CASE WHEN r = 'true'::jsonb THEN 1 ELSE 0 END;
  ELSIF jsonb_typeof(r) = 'string'  THEN
    BEGIN RETURN (r #>> '{}')::numeric;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'dsl_non_numeric: %', (r #>> '{}'); END;
  END IF;
  RAISE EXCEPTION 'dsl_non_numeric';
END $$;

-- the recursive evaluator. node ∈ {number, boolean, string($ref|literal), {op: args}}.
CREATE OR REPLACE FUNCTION public._tool_eval(node jsonb, ctx jsonb, depth int)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  t text; op text; a jsonb; s text; i int;
  acc numeric; x numeric; res jsonb; ref text; pth text[]; pl jsonb;
BEGIN
  IF depth > 64 THEN RAISE EXCEPTION 'dsl_depth_exceeded'; END IF;
  t := jsonb_typeof(node);

  IF t IN ('number','boolean','null') THEN
    RETURN node;
  ELSIF t = 'string' THEN
    s := node #>> '{}';
    IF left(s,2) = '$.' THEN RETURN ctx->'in'  -> substr(s,3);
    ELSIF left(s,1) = '$' THEN RETURN ctx->'var' -> substr(s,2);
    ELSE RETURN node;  -- string literal
    END IF;
  ELSIF t <> 'object' THEN
    RAISE EXCEPTION 'dsl_bad_node';
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(node) AS k(key)) <> 1 THEN
    RAISE EXCEPTION 'dsl_node_must_have_one_operator';
  END IF;
  op := (SELECT key FROM jsonb_object_keys(node) AS k(key) LIMIT 1);
  a  := node -> op;

  CASE op
    WHEN 'pi'  THEN RETURN to_jsonb(3.14159265358979323846::numeric);
    WHEN 'e'   THEN RETURN to_jsonb(2.71828182845904523536::numeric);
    WHEN 'add' THEN acc := 0; FOR i IN 0..jsonb_array_length(a)-1 LOOP acc := acc + public._tool_num(a->i, ctx, depth+1); END LOOP; RETURN to_jsonb(acc);
    WHEN 'mul' THEN acc := 1; FOR i IN 0..jsonb_array_length(a)-1 LOOP acc := acc * public._tool_num(a->i, ctx, depth+1); END LOOP; RETURN to_jsonb(acc);
    WHEN 'sub' THEN RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) - public._tool_num(a->1,ctx,depth+1));
    WHEN 'div' THEN x := public._tool_num(a->1,ctx,depth+1); IF x = 0 THEN RAISE EXCEPTION 'dsl_division_by_zero'; END IF; RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) / x);
    WHEN 'mod' THEN x := public._tool_num(a->1,ctx,depth+1); IF x = 0 THEN RAISE EXCEPTION 'dsl_division_by_zero'; END IF; RETURN to_jsonb(mod(public._tool_num(a->0,ctx,depth+1), x));
    WHEN 'pow' THEN RETURN to_jsonb(power(public._tool_num(a->0,ctx,depth+1), public._tool_num(a->1,ctx,depth+1)));
    WHEN 'sqrt' THEN RETURN to_jsonb(sqrt(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'abs' THEN RETURN to_jsonb(abs(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'neg' THEN RETURN to_jsonb(-public._tool_num(a->0,ctx,depth+1));
    WHEN 'ln'  THEN RETURN to_jsonb(ln(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'log10' THEN RETURN to_jsonb(log(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'exp' THEN RETURN to_jsonb(exp(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'sin' THEN RETURN to_jsonb(sin(public._tool_num(a->0,ctx,depth+1)::double precision)::numeric);
    WHEN 'cos' THEN RETURN to_jsonb(cos(public._tool_num(a->0,ctx,depth+1)::double precision)::numeric);
    WHEN 'tan' THEN RETURN to_jsonb(tan(public._tool_num(a->0,ctx,depth+1)::double precision)::numeric);
    WHEN 'deg2rad' THEN RETURN to_jsonb(radians(public._tool_num(a->0,ctx,depth+1)::double precision)::numeric);
    WHEN 'rad2deg' THEN RETURN to_jsonb(degrees(public._tool_num(a->0,ctx,depth+1)::double precision)::numeric);
    WHEN 'round' THEN
      IF jsonb_array_length(a) > 1 THEN RETURN to_jsonb(round(public._tool_num(a->0,ctx,depth+1), (public._tool_num(a->1,ctx,depth+1))::int));
      ELSE RETURN to_jsonb(round(public._tool_num(a->0,ctx,depth+1))); END IF;
    WHEN 'floor' THEN RETURN to_jsonb(floor(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'ceil'  THEN RETURN to_jsonb(ceil(public._tool_num(a->0,ctx,depth+1)));
    WHEN 'min' THEN acc := NULL; FOR i IN 0..jsonb_array_length(a)-1 LOOP x := public._tool_num(a->i,ctx,depth+1); acc := CASE WHEN acc IS NULL THEN x ELSE least(acc,x) END; END LOOP; RETURN to_jsonb(acc);
    WHEN 'max' THEN acc := NULL; FOR i IN 0..jsonb_array_length(a)-1 LOOP x := public._tool_num(a->i,ctx,depth+1); acc := CASE WHEN acc IS NULL THEN x ELSE greatest(acc,x) END; END LOOP; RETURN to_jsonb(acc);
    WHEN 'clamp' THEN x := public._tool_num(a->0,ctx,depth+1); RETURN to_jsonb(greatest(public._tool_num(a->1,ctx,depth+1), least(public._tool_num(a->2,ctx,depth+1), x)));
    WHEN 'eq'  THEN RETURN to_jsonb(public._tool_eval(a->0,ctx,depth+1) =  public._tool_eval(a->1,ctx,depth+1));
    WHEN 'ne'  THEN RETURN to_jsonb(public._tool_eval(a->0,ctx,depth+1) <> public._tool_eval(a->1,ctx,depth+1));
    WHEN 'lt'  THEN RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) <  public._tool_num(a->1,ctx,depth+1));
    WHEN 'lte' THEN RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) <= public._tool_num(a->1,ctx,depth+1));
    WHEN 'gt'  THEN RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) >  public._tool_num(a->1,ctx,depth+1));
    WHEN 'gte' THEN RETURN to_jsonb(public._tool_num(a->0,ctx,depth+1) >= public._tool_num(a->1,ctx,depth+1));
    WHEN 'and' THEN FOR i IN 0..jsonb_array_length(a)-1 LOOP IF public._tool_eval(a->i,ctx,depth+1) <> 'true'::jsonb THEN RETURN 'false'::jsonb; END IF; END LOOP; RETURN 'true'::jsonb;
    WHEN 'or'  THEN FOR i IN 0..jsonb_array_length(a)-1 LOOP IF public._tool_eval(a->i,ctx,depth+1) =  'true'::jsonb THEN RETURN 'true'::jsonb;  END IF; END LOOP; RETURN 'false'::jsonb;
    WHEN 'not' THEN RETURN to_jsonb(public._tool_eval(a->0,ctx,depth+1) <> 'true'::jsonb);
    WHEN 'if'  THEN
      IF public._tool_eval(a->0,ctx,depth+1) = 'true'::jsonb
        THEN RETURN public._tool_eval(a->1,ctx,depth+1);
        ELSE RETURN public._tool_eval(a->2,ctx,depth+1); END IF;
    WHEN 'coalesce' THEN
      FOR i IN 0..jsonb_array_length(a)-1 LOOP
        res := public._tool_eval(a->i,ctx,depth+1);
        IF res IS NOT NULL AND jsonb_typeof(res) <> 'null' THEN RETURN res; END IF;
      END LOOP; RETURN 'null'::jsonb;
    WHEN 'lookup' THEN
      ref := a->>0;
      pth := ARRAY(SELECT (public._tool_eval(a->g.idx, ctx, depth+1) #>> '{}')
                   FROM generate_series(1, jsonb_array_length(a)-1) AS g(idx) ORDER BY g.idx);
      SELECT payload INTO pl FROM public.tool_reference_data
        WHERE reference_key = ref ORDER BY spec_version DESC LIMIT 1;
      IF pl IS NULL THEN RAISE EXCEPTION 'dsl_lookup_no_ref: %', ref; END IF;
      res := pl #> pth;
      IF res IS NULL THEN RAISE EXCEPTION 'dsl_lookup_miss: % / %', ref, array_to_string(pth,'.'); END IF;
      RETURN res;
    ELSE RAISE EXCEPTION 'dsl_unknown_operator: %', op;
  END CASE;
END $$;

-- ════════════════════════════════════════════════════════════════════════
--  4) SURFACE FUNCTIONS
-- ════════════════════════════════════════════════════════════════════════

-- run a whole formula { let:[{name:expr}...], outputs:{name:expr...} } → outputs object.
CREATE OR REPLACE FUNCTION public.tool_eval(p_formula jsonb, p_inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE ctx jsonb; letarr jsonb; elem jsonb; nm text; outs jsonb; k text; result jsonb := '{}'::jsonb; i int;
BEGIN
  ctx := jsonb_build_object('in', coalesce(p_inputs,'{}'::jsonb), 'var', '{}'::jsonb);
  IF p_formula ? 'let' THEN
    letarr := p_formula->'let';
    FOR i IN 0..jsonb_array_length(letarr)-1 LOOP
      elem := letarr->i;
      nm := (SELECT key FROM jsonb_object_keys(elem) AS k2(key) LIMIT 1);
      ctx := jsonb_set(ctx, ARRAY['var', nm], coalesce(public._tool_eval(elem->nm, ctx, 0), 'null'::jsonb), true);
    END LOOP;
  END IF;
  outs := coalesce(p_formula->'outputs','{}'::jsonb);
  FOR k IN SELECT key FROM jsonb_object_keys(outs) AS t(key) LOOP
    result := result || jsonb_build_object(k, public._tool_eval(outs->k, ctx, 0));
  END LOOP;
  RETURN result;
END $$;

-- validate submitted inputs against the FormField[] schema (server is the gate).
CREATE OR REPLACE FUNCTION public.tool_validate_inputs(p_schema jsonb, p_inputs jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE f jsonb; nm text; ftype text; req boolean; val jsonb; present boolean; num numeric; mn numeric; mx numeric; ok boolean;
BEGIN
  IF p_schema IS NULL THEN RETURN; END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_schema) AS x LOOP
    nm := f->>'name'; ftype := coalesce(f->>'type','text'); req := coalesce((f->>'required')::boolean,false);
    val := p_inputs->nm;
    present := val IS NOT NULL AND jsonb_typeof(val) <> 'null'
              AND NOT (jsonb_typeof(val) = 'string' AND (val #>> '{}') = '');
    IF req AND NOT present THEN RAISE EXCEPTION 'required field missing: %', nm; END IF;
    IF present AND ftype = 'number' THEN
      BEGIN num := (val #>> '{}')::numeric; EXCEPTION WHEN others THEN RAISE EXCEPTION 'field % must be a number', nm; END;
      IF f ? 'validation' THEN
        IF (f->'validation') ? 'min' THEN mn := (f->'validation'->>'min')::numeric; IF num < mn THEN RAISE EXCEPTION 'field % below min %', nm, mn; END IF; END IF;
        IF (f->'validation') ? 'max' THEN mx := (f->'validation'->>'max')::numeric; IF num > mx THEN RAISE EXCEPTION 'field % above max %', nm, mx; END IF;  END IF;
      END IF;
    END IF;
    IF present AND ftype = 'select' AND (f ? 'options') THEN
      SELECT exists(SELECT 1 FROM jsonb_array_elements(f->'options') AS o WHERE o->>'value' = (val #>> '{}')) INTO ok;
      IF NOT ok THEN RAISE EXCEPTION 'field % has an invalid option', nm; END IF;
    END IF;
  END LOOP;
END $$;

-- project raw outputs into display cards your JSON-driven list renders.
CREATE OR REPLACE FUNCTION public.tool_project(p_schema jsonb, p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE cards jsonb := '[]'::jsonb; c jsonb; k text; raw jsonb; val text; rnd int;
BEGIN
  IF p_schema ? 'cards' THEN
    FOR c IN SELECT x FROM jsonb_array_elements(p_schema->'cards') AS x LOOP
      k := c->>'key'; raw := p_results->k;
      IF raw IS NULL THEN CONTINUE; END IF;
      IF jsonb_typeof(raw) = 'number' THEN
        rnd := coalesce((c->>'round')::int, 4);
        val := round((raw #>> '{}')::numeric, rnd)::text;
      ELSE val := raw #>> '{}'; END IF;
      cards := cards || jsonb_build_object(
        'label', c->>'label', 'value', val,
        'unit', coalesce(c->>'unit',''), 'tone', coalesce(c->>'tone','default'));
    END LOOP;
  ELSE
    FOR k IN SELECT key FROM jsonb_object_keys(p_results) AS t(key) LOOP
      raw := p_results->k;
      val := CASE WHEN jsonb_typeof(raw)='number' THEN round((raw #>> '{}')::numeric,4)::text ELSE raw #>> '{}' END;
      cards := cards || jsonb_build_object('label', k, 'value', val, 'unit', '', 'tone', 'default');
    END LOOP;
  END IF;
  RETURN cards;
END $$;

-- entitlement predicate (free tools always pass; pro needs a grant or god-mode admin).
CREATE OR REPLACE FUNCTION public.tool_has_pro_access(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.nx_is_admin(), false)
      OR EXISTS (SELECT 1 FROM public.tool_pro_grants g WHERE g.user_id = p_uid AND g.revoked = false);
$$;

-- THE one entry point. Validate → execute → hash → log → project. Never throws to the client.
CREATE OR REPLACE FUNCTION public.tool_invoke(p_tool_key text, p_inputs jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_tool   public.engineering_tools;
  v_inputs jsonb := coalesce(p_inputs, '{}'::jsonb);
  v_field  jsonb;
  v_name   text;
  v_out    jsonb;
  v_uid    uuid := auth.uid();
BEGIN
  SELECT * INTO v_tool FROM public.engineering_tools WHERE key = p_tool_key AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool', 'tool', p_tool_key);
  END IF;

  IF v_tool.access_tier = 'pro' AND NOT public.tool_has_pro_access(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'locked', true, 'tool', v_tool.key,
      'result_cards', jsonb_build_array(jsonb_build_object(
        'label','Pro tool','value','Upgrade to unlock','unit','','tone','warn')));
  END IF;

  -- apply declared defaults for any unset field
  FOR v_field IN SELECT x FROM jsonb_array_elements(coalesce(v_tool.input_schema,'[]'::jsonb)) AS x LOOP
    v_name := v_field->>'name';
    IF v_name IS NOT NULL AND (v_inputs->v_name) IS NULL AND (v_field ? 'defaultValue') THEN
      v_inputs := jsonb_set(v_inputs, ARRAY[v_name], v_field->'defaultValue', true);
    END IF;
  END LOOP;

  PERFORM public.tool_validate_inputs(v_tool.input_schema, v_inputs);

  IF v_tool.engine = 'dsl' THEN
    v_out := public.tool_eval(v_tool.formula, v_inputs);
  ELSIF v_tool.engine = 'edge' THEN
    RETURN jsonb_build_object('ok', true, 'queued', true, 'tool', v_tool.key,
      'message', 'This tool runs as a background document job.');
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'engine_not_enabled', 'engine', v_tool.engine);
  END IF;

  INSERT INTO public.tool_runs(tool_key, tool_version, actor_id, inputs, outputs, input_sha256, result_sha256)
  VALUES (v_tool.key, v_tool.spec_version, v_uid, v_inputs, v_out,
          encode(digest(public._tool_canon(v_inputs), 'sha256'), 'hex'),
          encode(digest(public._tool_canon(v_out),    'sha256'), 'hex'));

  RETURN jsonb_build_object(
    'ok', true, 'tool', v_tool.key, 'title', v_tool.title, 'version', v_tool.spec_version,
    'computed_at', now(), 'inputs', v_inputs, 'outputs', v_out,
    'result_cards', public.tool_project(v_tool.output_schema, v_out),
    'citations', to_jsonb(v_tool.standards_refs),
    'result_sha256', encode(digest(public._tool_canon(v_out), 'sha256'), 'hex'));
EXCEPTION WHEN others THEN
  -- the form gets a clean error card instead of a 500
  RETURN jsonb_build_object('ok', false, 'error', 'tool_error', 'detail', SQLERRM, 'tool', p_tool_key);
END $$;

-- least privilege: only tool_invoke is callable by the client; helpers are internal.
REVOKE ALL ON FUNCTION public._tool_eval(jsonb,jsonb,int)          FROM public;
REVOKE ALL ON FUNCTION public._tool_num(jsonb,jsonb,int)           FROM public;
REVOKE ALL ON FUNCTION public._tool_canon(jsonb)                   FROM public;
REVOKE ALL ON FUNCTION public.tool_eval(jsonb,jsonb)              FROM public;
REVOKE ALL ON FUNCTION public.tool_validate_inputs(jsonb,jsonb)   FROM public;
REVOKE ALL ON FUNCTION public.tool_has_pro_access(uuid)           FROM public;
GRANT  EXECUTE ON FUNCTION public.tool_invoke(text,jsonb)         TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════
--  5) SEEDS — reference data + 12 calculators (pure data)
-- ════════════════════════════════════════════════════════════════════════

-- 5a. SI conversion table (scale + offset to SI base; affine covers temperature).
INSERT INTO public.tool_reference_data (reference_key, payload, source, spec_version) VALUES
('unit_si', '{
  "m":{"scale":1,"offset":0,"cat":"length"},      "cm":{"scale":0.01,"offset":0,"cat":"length"},
  "mm":{"scale":0.001,"offset":0,"cat":"length"}, "km":{"scale":1000,"offset":0,"cat":"length"},
  "in":{"scale":0.0254,"offset":0,"cat":"length"},"ft":{"scale":0.3048,"offset":0,"cat":"length"},
  "yd":{"scale":0.9144,"offset":0,"cat":"length"},
  "kg":{"scale":1,"offset":0,"cat":"mass"},       "g":{"scale":0.001,"offset":0,"cat":"mass"},
  "lb":{"scale":0.45359237,"offset":0,"cat":"mass"},"oz":{"scale":0.028349523,"offset":0,"cat":"mass"},
  "tonne":{"scale":1000,"offset":0,"cat":"mass"},
  "Pa":{"scale":1,"offset":0,"cat":"pressure"},   "kPa":{"scale":1000,"offset":0,"cat":"pressure"},
  "MPa":{"scale":1000000,"offset":0,"cat":"pressure"},"bar":{"scale":100000,"offset":0,"cat":"pressure"},
  "psi":{"scale":6894.757,"offset":0,"cat":"pressure"},"atm":{"scale":101325,"offset":0,"cat":"pressure"},
  "K":{"scale":1,"offset":0,"cat":"temperature"}, "degC":{"scale":1,"offset":273.15,"cat":"temperature"},
  "degF":{"scale":0.5555555556,"offset":255.3722222,"cat":"temperature"},
  "m3":{"scale":1,"offset":0,"cat":"volume"},     "L":{"scale":0.001,"offset":0,"cat":"volume"},
  "mL":{"scale":0.000001,"offset":0,"cat":"volume"},"gal_us":{"scale":0.003785412,"offset":0,"cat":"volume"},
  "ft3":{"scale":0.028316846,"offset":0,"cat":"volume"}
}'::jsonb, 'SI base units', 1)
ON CONFLICT (reference_key, spec_version) DO UPDATE SET payload = EXCLUDED.payload, source = EXCLUDED.source;

-- 5b. Approximate half-value layer (mm of steel) by gamma source — calibrate to your kit.
INSERT INTO public.tool_reference_data (reference_key, payload, source, spec_version) VALUES
('rt_hvl', '{"Ir-192":{"hvl_mm_steel":12.8},"Co-60":{"hvl_mm_steel":21.7},"Se-75":{"hvl_mm_steel":9.0}}'::jsonb,
 'Approximate HVL in steel (typical values)', 1)
ON CONFLICT (reference_key, spec_version) DO UPDATE SET payload = EXCLUDED.payload, source = EXCLUDED.source;

-- 5c. The calculators. Each row is complete + renderable + runnable.
INSERT INTO public.engineering_tools
  (key, category, title, subtitle, icon_token, input_schema, output_schema, engine, formula, reference_key, standards_refs)
VALUES

-- ── MECHANICAL ───────────────────────────────────────────────────────────
('bolt_torque','mechanical','Bolt Torque Calculator','Tightening torque from target preload and nut factor','build-outline',
 '[{"name":"diameter_mm","label":"Bolt nominal diameter (mm)","type":"number","required":true,"placeholder":"e.g. 20","validation":{"min":1,"max":200}},
   {"name":"preload_kn","label":"Target preload (kN)","type":"number","required":true,"placeholder":"e.g. 150","validation":{"min":0}},
   {"name":"k_factor","label":"Friction condition (nut factor K)","type":"select","required":true,"defaultValue":"0.20","options":[{"label":"Lightly lubricated (0.16)","value":"0.16"},{"label":"Dry / as-received (0.20)","value":"0.20"},{"label":"Zinc-plated (0.25)","value":"0.25"}],"helperText":"K depends on thread/face lubrication"}]'::jsonb,
 '{"cards":[{"key":"torque_nm","label":"Tightening torque","unit":"N·m","round":1},{"key":"torque_lbft","label":"Tightening torque","unit":"lbf·ft","round":1}]}'::jsonb,
 'dsl',
 '{"let":[{"t":{"mul":["$.k_factor","$.preload_kn","$.diameter_mm"]}}],"outputs":{"torque_nm":"$t","torque_lbft":{"mul":["$t",0.737562]}}}'::jsonb,
 NULL, ARRAY['T = K · F · d','VDI 2230 (concept)']),

('pipe_volume','mechanical','Pipe Internal Volume','Fluid volume held by a pipe run','water-outline',
 '[{"name":"inner_diameter_mm","label":"Pipe inner diameter (mm)","type":"number","required":true,"validation":{"min":0}},
   {"name":"length_m","label":"Pipe length (m)","type":"number","required":true,"validation":{"min":0}}]'::jsonb,
 '{"cards":[{"key":"volume_l","label":"Internal volume","unit":"L","round":2},{"key":"volume_gal_us","label":"Internal volume","unit":"US gal","round":2},{"key":"volume_m3","label":"Internal volume","unit":"m³","round":4}]}'::jsonb,
 'dsl',
 '{"let":[{"idm":{"div":["$.inner_diameter_mm",1000]}},{"vol":{"mul":[{"div":[{"pi":[]},4]},{"pow":["$idm",2]},"$.length_m"]}}],"outputs":{"volume_l":{"mul":["$vol",1000]},"volume_gal_us":{"mul":["$vol",264.172]},"volume_m3":"$vol"}}'::jsonb,
 NULL, ARRAY['V = π/4 · ID² · L']),

-- ── INDUSTRIAL / PIPING ──────────────────────────────────────────────────
('barlow_pressure','industrial','Barlow Pipe Pressure','Internal pressure rating from wall, OD and allowable stress','speedometer-outline',
 '[{"name":"outside_diameter_mm","label":"Pipe outside diameter (mm)","type":"number","required":true,"validation":{"min":0}},
   {"name":"wall_thickness_mm","label":"Wall thickness (mm)","type":"number","required":true,"validation":{"min":0}},
   {"name":"allowable_stress_mpa","label":"Allowable stress S (MPa)","type":"number","required":true,"validation":{"min":0}}]'::jsonb,
 '{"cards":[{"key":"pressure_mpa","label":"Pressure rating","unit":"MPa","round":3},{"key":"pressure_bar","label":"Pressure rating","unit":"bar","round":1},{"key":"pressure_psi","label":"Pressure rating","unit":"psi","round":1}]}'::jsonb,
 'dsl',
 '{"let":[{"p":{"div":[{"mul":[2,"$.allowable_stress_mpa","$.wall_thickness_mm"]},"$.outside_diameter_mm"]}}],"outputs":{"pressure_mpa":"$p","pressure_bar":{"mul":["$p",10]},"pressure_psi":{"mul":["$p",145.038]}}}'::jsonb,
 NULL, ARRAY['Barlow: P = 2·S·t / D']),

-- ── WELDING ──────────────────────────────────────────────────────────────
('heat_input','welding','Welding Heat Input','Arc energy per unit length per EN 1011-1','flame-outline',
 '[{"name":"voltage_v","label":"Arc voltage (V)","type":"number","required":true,"validation":{"min":1,"max":100}},
   {"name":"current_a","label":"Welding current (A)","type":"number","required":true,"validation":{"min":1,"max":2000}},
   {"name":"travel_mm_min","label":"Travel speed (mm/min)","type":"number","required":true,"validation":{"min":1}},
   {"name":"efficiency","label":"Process (thermal efficiency η)","type":"select","required":true,"defaultValue":"0.8","options":[{"label":"SMAW / FCAW / GMAW (0.80)","value":"0.8"},{"label":"GTAW / Plasma (0.60)","value":"0.6"},{"label":"SAW (1.00)","value":"1.0"}]}]'::jsonb,
 '{"cards":[{"key":"heat_input_kj_mm","label":"Heat input","unit":"kJ/mm","round":3},{"key":"heat_input_kj_in","label":"Heat input","unit":"kJ/in","round":2}]}'::jsonb,
 'dsl',
 '{"let":[{"arc":{"mul":["$.efficiency","$.voltage_v","$.current_a"]}},{"hi":{"div":[{"mul":["$arc",60]},{"mul":["$.travel_mm_min",1000]}]}}],"outputs":{"heat_input_kj_mm":"$hi","heat_input_kj_in":{"mul":["$hi",25.4]}}}'::jsonb,
 NULL, ARRAY['EN 1011-1','ASME IX QW-409','HI = η·V·I / v']),

-- ── ELECTRICAL ───────────────────────────────────────────────────────────
('three_phase_flc','electrical','3-Phase Full-Load Current','Line current of a balanced three-phase load','flash-outline',
 '[{"name":"power_kw","label":"Load power (kW)","type":"number","required":true,"validation":{"min":0}},
   {"name":"voltage_v","label":"Line-to-line voltage (V)","type":"number","required":true,"validation":{"min":1}},
   {"name":"power_factor","label":"Power factor (cos φ)","type":"number","required":true,"defaultValue":0.85,"validation":{"min":0.1,"max":1}},
   {"name":"efficiency","label":"Efficiency (η)","type":"number","required":true,"defaultValue":0.9,"validation":{"min":0.1,"max":1}}]'::jsonb,
 '{"cards":[{"key":"current_a","label":"Full-load current","unit":"A","round":2}]}'::jsonb,
 'dsl',
 '{"let":[{"den":{"mul":[{"sqrt":[3]},"$.voltage_v","$.power_factor","$.efficiency"]}}],"outputs":{"current_a":{"div":[{"mul":["$.power_kw",1000]},"$den"]}}}'::jsonb,
 NULL, ARRAY['I = P / (√3 · V · pf · η)']),

('voltage_drop_3ph','electrical','3-Phase Voltage Drop','Cable volt-drop and percentage','pulse-outline',
 '[{"name":"current_a","label":"Line current (A)","type":"number","required":true,"validation":{"min":0}},
   {"name":"length_m","label":"One-way cable length (m)","type":"number","required":true,"validation":{"min":0}},
   {"name":"r_ohm_km","label":"Cable resistance R (Ω/km)","type":"number","required":true,"validation":{"min":0}},
   {"name":"x_ohm_km","label":"Cable reactance X (Ω/km)","type":"number","required":true,"defaultValue":0.08,"validation":{"min":0}},
   {"name":"power_factor","label":"Power factor (cos φ)","type":"number","required":true,"defaultValue":0.85,"validation":{"min":0.1,"max":1}},
   {"name":"voltage_v","label":"Line-to-line voltage (V)","type":"number","required":true,"validation":{"min":1}}]'::jsonb,
 '{"cards":[{"key":"voltage_drop_v","label":"Voltage drop","unit":"V","round":2},{"key":"voltage_drop_pct","label":"Voltage drop","unit":"%","round":2}]}'::jsonb,
 'dsl',
 '{"let":[{"sinphi":{"sqrt":[{"sub":[1,{"pow":["$.power_factor",2]}]}]}},{"z":{"add":[{"mul":["$.r_ohm_km","$.power_factor"]},{"mul":["$.x_ohm_km","$sinphi"]}]}},{"vd":{"div":[{"mul":[{"sqrt":[3]},"$.current_a","$.length_m","$z"]},1000]}}],"outputs":{"voltage_drop_v":"$vd","voltage_drop_pct":{"mul":[{"div":["$vd","$.voltage_v"]},100]}}}'::jsonb,
 NULL, ARRAY['Vd = √3 · I · L · (R·cosφ + X·sinφ)']),

-- ── CIVIL ────────────────────────────────────────────────────────────────
('concrete_volume','civil','Concrete Volume Estimator','Wet + dry volume with waste allowance','cube-outline',
 '[{"name":"length_m","label":"Length (m)","type":"number","required":true,"validation":{"min":0}},
   {"name":"width_m","label":"Width (m)","type":"number","required":true,"validation":{"min":0}},
   {"name":"thickness_mm","label":"Thickness / depth (mm)","type":"number","required":true,"validation":{"min":0}},
   {"name":"waste_pct","label":"Waste allowance (%)","type":"number","required":true,"defaultValue":5,"validation":{"min":0,"max":50}}]'::jsonb,
 '{"cards":[{"key":"volume_m3","label":"Wet volume","unit":"m³","round":3},{"key":"volume_yd3","label":"Wet volume","unit":"yd³","round":3},{"key":"dry_volume_m3","label":"Dry volume (×1.54)","unit":"m³","round":3}]}'::jsonb,
 'dsl',
 '{"let":[{"tm":{"div":["$.thickness_mm",1000]}},{"vol":{"mul":["$.length_m","$.width_m","$tm",{"add":[1,{"div":["$.waste_pct",100]}]}]}}],"outputs":{"volume_m3":"$vol","volume_yd3":{"mul":["$vol",1.30795]},"dry_volume_m3":{"mul":["$vol",1.54]}}}'::jsonb,
 NULL, ARRAY['Dry-to-wet factor 1.54']),

-- ── CHEMICAL / PROCESS ───────────────────────────────────────────────────
('reynolds_number','chemical','Reynolds Number','Flow regime in a circular pipe','analytics-outline',
 '[{"name":"density_kg_m3","label":"Fluid density ρ (kg/m³)","type":"number","required":true,"defaultValue":998,"validation":{"min":0}},
   {"name":"velocity_m_s","label":"Flow velocity v (m/s)","type":"number","required":true,"validation":{"min":0}},
   {"name":"diameter_mm","label":"Internal diameter D (mm)","type":"number","required":true,"validation":{"min":0}},
   {"name":"viscosity_pa_s","label":"Dynamic viscosity μ (Pa·s)","type":"number","required":true,"defaultValue":0.001,"validation":{"min":0.0000001}}]'::jsonb,
 '{"cards":[{"key":"reynolds","label":"Reynolds number","unit":"","round":0},{"key":"regime","label":"Flow regime","unit":""}]}'::jsonb,
 'dsl',
 '{"let":[{"dm":{"div":["$.diameter_mm",1000]}},{"re":{"div":[{"mul":["$.density_kg_m3","$.velocity_m_s","$dm"]},"$.viscosity_pa_s"]}}],"outputs":{"reynolds":"$re","regime":{"if":[{"lt":["$re",2300]},"Laminar",{"if":[{"lt":["$re",4000]},"Transitional","Turbulent"]}]}}}'::jsonb,
 NULL, ARRAY['Re = ρ·v·D / μ']),

('solution_dilution','chemical','Solution Dilution','Stock + diluent volumes from C1V1 = C2V2','flask-outline',
 '[{"name":"stock_conc","label":"Stock concentration C1","type":"number","required":true,"validation":{"min":0}},
   {"name":"final_conc","label":"Final concentration C2","type":"number","required":true,"validation":{"min":0}},
   {"name":"final_volume","label":"Final volume V2","type":"number","required":true,"validation":{"min":0},"helperText":"Use consistent units for C and V"}]'::jsonb,
 '{"cards":[{"key":"stock_volume","label":"Stock volume needed (V1)","unit":"","round":3},{"key":"diluent_volume","label":"Diluent to add","unit":"","round":3},{"key":"note","label":"Status","unit":""}]}'::jsonb,
 'dsl',
 '{"let":[{"v1":{"div":[{"mul":["$.final_conc","$.final_volume"]},"$.stock_conc"]}}],"outputs":{"stock_volume":"$v1","diluent_volume":{"sub":["$.final_volume","$v1"]},"note":{"if":[{"gt":["$.final_conc","$.stock_conc"]},"WARNING: final concentration exceeds stock — not achievable by dilution","OK"]}}}'::jsonb,
 NULL, ARRAY['C1·V1 = C2·V2']),

('ideal_gas_density','chemical','Ideal Gas Density','Gas density from pressure, molar mass and temperature','cloud-outline',
 '[{"name":"pressure_kpa","label":"Absolute pressure (kPa)","type":"number","required":true,"defaultValue":101.325,"validation":{"min":0}},
   {"name":"molar_mass_g_mol","label":"Molar mass (g/mol)","type":"number","required":true,"validation":{"min":0}},
   {"name":"temperature_c","label":"Temperature (°C)","type":"number","required":true,"defaultValue":15,"validation":{"min":-273.15}}]'::jsonb,
 '{"cards":[{"key":"density_kg_m3","label":"Density","unit":"kg/m³","round":4},{"key":"density_g_l","label":"Density","unit":"g/L","round":4}]}'::jsonb,
 'dsl',
 '{"let":[{"ppa":{"mul":["$.pressure_kpa",1000]}},{"mkg":{"div":["$.molar_mass_g_mol",1000]}},{"tk":{"add":["$.temperature_c",273.15]}},{"rho":{"div":[{"mul":["$ppa","$mkg"]},{"mul":[8.314462618,"$tk"]}]}}],"outputs":{"density_kg_m3":"$rho","density_g_l":"$rho"}}'::jsonb,
 NULL, ARRAY['ρ = P·M / (R·T)','R = 8.314462618 J/mol·K']),

-- ── NDT ──────────────────────────────────────────────────────────────────
('rt_exposure_time','ndt','RT Exposure Time','Scale a known exposure to a new thickness + SFD','scan-outline',
 '[{"name":"source","label":"Radiation source","type":"select","required":true,"defaultValue":"Ir-192","options":[{"label":"Iridium-192","value":"Ir-192"},{"label":"Cobalt-60","value":"Co-60"},{"label":"Selenium-75","value":"Se-75"}],"helperText":"HVL is approximate — calibrate to your source and film"},
   {"name":"thickness_mm","label":"Target thickness (mm steel)","type":"number","required":true,"validation":{"min":0}},
   {"name":"d_ref_mm","label":"Reference thickness (mm steel)","type":"number","required":true,"validation":{"min":0}},
   {"name":"t_ref_min","label":"Reference exposure time (min)","type":"number","required":true,"validation":{"min":0}},
   {"name":"sfd_mm","label":"Target source-to-film distance (mm)","type":"number","required":true,"validation":{"min":1}},
   {"name":"sfd_ref_mm","label":"Reference source-to-film distance (mm)","type":"number","required":true,"validation":{"min":1}}]'::jsonb,
 '{"cards":[{"key":"exposure_min","label":"Exposure time","unit":"min","round":2},{"key":"hvl_used_mm","label":"HVL used","unit":"mm steel","round":1}]}'::jsonb,
 'dsl',
 '{"let":[{"hvl":{"lookup":["rt_hvl","$.source","hvl_mm_steel"]}},{"dterm":{"pow":[2,{"div":[{"sub":["$.thickness_mm","$.d_ref_mm"]},"$hvl"]}]}},{"sfd2":{"pow":[{"div":["$.sfd_mm","$.sfd_ref_mm"]},2]}},{"t":{"mul":["$.t_ref_min","$dterm","$sfd2"]}}],"outputs":{"exposure_min":"$t","hvl_used_mm":"$hvl"}}'::jsonb,
 'rt_hvl', ARRAY['ASME BPVC V Art.2','HVL doubling + inverse-square law']),

-- ── GENERAL ──────────────────────────────────────────────────────────────
('unit_converter','general','Unit Converter','Length, mass, pressure, temperature and volume','swap-horizontal-outline',
 '[{"name":"value","label":"Value to convert","type":"number","required":true},
   {"name":"from_unit","label":"From unit","type":"select","required":true,"options":[{"label":"Length — meter (m)","value":"m"},{"label":"Length — centimeter (cm)","value":"cm"},{"label":"Length — millimeter (mm)","value":"mm"},{"label":"Length — kilometer (km)","value":"km"},{"label":"Length — inch (in)","value":"in"},{"label":"Length — foot (ft)","value":"ft"},{"label":"Length — yard (yd)","value":"yd"},{"label":"Mass — kilogram (kg)","value":"kg"},{"label":"Mass — gram (g)","value":"g"},{"label":"Mass — pound (lb)","value":"lb"},{"label":"Mass — ounce (oz)","value":"oz"},{"label":"Mass — tonne (t)","value":"tonne"},{"label":"Pressure — pascal (Pa)","value":"Pa"},{"label":"Pressure — kilopascal (kPa)","value":"kPa"},{"label":"Pressure — megapascal (MPa)","value":"MPa"},{"label":"Pressure — bar","value":"bar"},{"label":"Pressure — psi","value":"psi"},{"label":"Pressure — atm","value":"atm"},{"label":"Temp — Celsius (°C)","value":"degC"},{"label":"Temp — Fahrenheit (°F)","value":"degF"},{"label":"Temp — Kelvin (K)","value":"K"},{"label":"Volume — m³","value":"m3"},{"label":"Volume — liter (L)","value":"L"},{"label":"Volume — milliliter (mL)","value":"mL"},{"label":"Volume — US gallon","value":"gal_us"},{"label":"Volume — ft³","value":"ft3"}]},
   {"name":"to_unit","label":"To unit","type":"select","required":true,"options":[{"label":"Length — meter (m)","value":"m"},{"label":"Length — centimeter (cm)","value":"cm"},{"label":"Length — millimeter (mm)","value":"mm"},{"label":"Length — kilometer (km)","value":"km"},{"label":"Length — inch (in)","value":"in"},{"label":"Length — foot (ft)","value":"ft"},{"label":"Length — yard (yd)","value":"yd"},{"label":"Mass — kilogram (kg)","value":"kg"},{"label":"Mass — gram (g)","value":"g"},{"label":"Mass — pound (lb)","value":"lb"},{"label":"Mass — ounce (oz)","value":"oz"},{"label":"Mass — tonne (t)","value":"tonne"},{"label":"Pressure — pascal (Pa)","value":"Pa"},{"label":"Pressure — kilopascal (kPa)","value":"kPa"},{"label":"Pressure — megapascal (MPa)","value":"MPa"},{"label":"Pressure — bar","value":"bar"},{"label":"Pressure — psi","value":"psi"},{"label":"Pressure — atm","value":"atm"},{"label":"Temp — Celsius (°C)","value":"degC"},{"label":"Temp — Fahrenheit (°F)","value":"degF"},{"label":"Temp — Kelvin (K)","value":"K"},{"label":"Volume — m³","value":"m3"},{"label":"Volume — liter (L)","value":"L"},{"label":"Volume — milliliter (mL)","value":"mL"},{"label":"Volume — US gallon","value":"gal_us"},{"label":"Volume — ft³","value":"ft3"}]}]'::jsonb,
 '{"cards":[{"key":"result","label":"Converted value","unit":"","round":6},{"key":"note","label":"Status","unit":""}]}'::jsonb,
 'dsl',
 '{"let":[{"bf":{"add":[{"mul":["$.value",{"lookup":["unit_si","$.from_unit","scale"]}]},{"lookup":["unit_si","$.from_unit","offset"]}]}},{"res":{"div":[{"sub":["$bf",{"lookup":["unit_si","$.to_unit","offset"]}]},{"lookup":["unit_si","$.to_unit","scale"]}]}}],"outputs":{"result":"$res","note":{"if":[{"eq":[{"lookup":["unit_si","$.from_unit","cat"]},{"lookup":["unit_si","$.to_unit","cat"]}]},"Conversion OK","WARNING: units are different categories"]}}}'::jsonb,
 'unit_si', ARRAY['SI base conversion (affine for temperature)'])

ON CONFLICT (key) DO UPDATE SET
  category=EXCLUDED.category, title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, icon_token=EXCLUDED.icon_token,
  input_schema=EXCLUDED.input_schema, output_schema=EXCLUDED.output_schema, engine=EXCLUDED.engine,
  formula=EXCLUDED.formula, reference_key=EXCLUDED.reference_key, standards_refs=EXCLUDED.standards_refs,
  spec_version=public.engineering_tools.spec_version + 1, updated_at=now();

-- ════════════════════════════════════════════════════════════════════════
--  6) SELF-TEST — a wrong formula fails this migration (atomic rollback)
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r jsonb; v numeric;
BEGIN
  -- Bolt torque: 0.20 · 150 · 20 = 600 N·m
  r := public.tool_invoke('bolt_torque','{"diameter_mm":20,"preload_kn":150,"k_factor":"0.20"}'::jsonb);
  IF (r->>'ok') <> 'true' THEN RAISE EXCEPTION 'SELFTEST bolt_torque not ok: %', r; END IF;
  v := (r->'outputs'->>'torque_nm')::numeric;
  IF abs(v - 600) > 1e-6 THEN RAISE EXCEPTION 'SELFTEST bolt_torque expected 600 got %', v; END IF;

  -- Unit converter: 1 in → mm = 25.4
  r := public.tool_invoke('unit_converter','{"value":1,"from_unit":"in","to_unit":"mm"}'::jsonb);
  IF (r->>'ok') <> 'true' THEN RAISE EXCEPTION 'SELFTEST unit not ok: %', r; END IF;
  v := (r->'outputs'->>'result')::numeric;
  IF abs(v - 25.4) > 1e-6 THEN RAISE EXCEPTION 'SELFTEST unit in->mm expected 25.4 got %', v; END IF;

  -- Temperature is affine: 100 °C → 212 °F
  r := public.tool_invoke('unit_converter','{"value":100,"from_unit":"degC","to_unit":"degF"}'::jsonb);
  v := (r->'outputs'->>'result')::numeric;
  IF abs(v - 212) > 1e-3 THEN RAISE EXCEPTION 'SELFTEST 100C->F expected 212 got %', v; END IF;

  -- Heat input: 0.8·25·200·60 / (300·1000) = 0.8 kJ/mm
  r := public.tool_invoke('heat_input','{"voltage_v":25,"current_a":200,"travel_mm_min":300,"efficiency":"0.8"}'::jsonb);
  v := (r->'outputs'->>'heat_input_kj_mm')::numeric;
  IF abs(v - 0.8) > 1e-6 THEN RAISE EXCEPTION 'SELFTEST heat_input expected 0.8 got %', v; END IF;

  -- Reynolds: 1000·2·0.1 / 0.001 = 200000 → Turbulent
  r := public.tool_invoke('reynolds_number','{"density_kg_m3":1000,"velocity_m_s":2,"diameter_mm":100,"viscosity_pa_s":0.001}'::jsonb);
  IF (r->'outputs'->>'regime') <> 'Turbulent' THEN RAISE EXCEPTION 'SELFTEST reynolds regime %', r->'outputs'->>'regime'; END IF;

  -- Validation must reject a missing required field
  r := public.tool_invoke('bolt_torque','{"diameter_mm":20}'::jsonb);
  IF (r->>'ok') <> 'false' THEN RAISE EXCEPTION 'SELFTEST validation should have failed: %', r; END IF;

  RAISE NOTICE 'Tool Foundry self-test passed (6/6). Seal hash present: %',
    (public.tool_invoke('bolt_torque','{"diameter_mm":20,"preload_kn":150,"k_factor":"0.20"}'::jsonb)->>'result_sha256');
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- USAGE (client, zero new UI):
--   1. List tools:   select key, category, title, subtitle, icon_token, access_tier
--                      from engineering_tools where is_active order by category, title;
--   2. Render form:  feed engineering_tools.input_schema (FormField[]) to <DynamicForm/>.
--   3. Run:          const { data } = await supabase.rpc('tool_invoke',
--                       { p_tool_key:'bolt_torque', p_inputs:{ diameter_mm:20, preload_kn:150, k_factor:'0.20' } });
--   4. Render result: map data.result_cards → your JSON-driven list. data.result_sha256 is the seal.
--
-- ADD A NEW TOOL = one INSERT into engineering_tools. No deploy, no screen.
-- ─────────────────────────────────────────────────────────────────────────
