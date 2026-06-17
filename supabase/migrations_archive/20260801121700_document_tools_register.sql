-- ════════════════════════════════════════════════════════════════════════════
--  20260801121700_document_tools_register.sql
--
--  DOCUMENT TOOLS — register the engine='edge' generators (Auto WPS, ITP) as
--  rows in the SAME engineering_tools registry. They appear in the live Foundry
--  list immediately (lock-badged, access_tier='pro'); their inputs render through
--  DynamicForm just like the calculators. Execution happens in the
--  `tool-document` edge function (structured doc → canonical-JSON seal → tool_run),
--  reusing the trust spine. Pure data here.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.engineering_tools
  (key, category, title, subtitle, icon_token, input_schema, output_schema, engine, formula, access_tier, standards_refs)
VALUES

('auto_wps','welding','Auto WPS Generator','Draft a Welding Procedure Specification from essential variables','document-text-outline',
 '[
   {"name":"code","label":"Welding code","type":"select","required":true,"defaultValue":"asme_ix","options":[{"label":"ASME BPVC Section IX","value":"asme_ix"},{"label":"EN ISO 15614-1","value":"en_iso_15614"},{"label":"AWS D1.1","value":"aws_d11"}]},
   {"name":"process","label":"Welding process","type":"select","required":true,"defaultValue":"SMAW","options":[{"label":"SMAW (111)","value":"SMAW"},{"label":"GMAW (135)","value":"GMAW"},{"label":"FCAW (136)","value":"FCAW"},{"label":"GTAW (141)","value":"GTAW"},{"label":"SAW (121)","value":"SAW"}]},
   {"name":"base_metal","label":"Base metal spec","type":"text","required":true,"placeholder":"e.g. ASTM A516 Gr.70"},
   {"name":"base_thickness_mm","label":"Base thickness (mm)","type":"number","required":true,"validation":{"min":0.5,"max":300}},
   {"name":"filler","label":"Filler / electrode","type":"text","required":true,"placeholder":"e.g. AWS A5.1 E7018"},
   {"name":"joint_type","label":"Joint type","type":"select","required":true,"defaultValue":"groove","options":[{"label":"Groove (butt)","value":"groove"},{"label":"Fillet","value":"fillet"}]},
   {"name":"position","label":"Welding position","type":"select","required":true,"defaultValue":"3G","options":[{"label":"1G / PA","value":"1G"},{"label":"2G / PC","value":"2G"},{"label":"3G / PF","value":"3G"},{"label":"4G / PE","value":"4G"},{"label":"5G / PF","value":"5G"},{"label":"6G / HL045","value":"6G"},{"label":"1F","value":"1F"},{"label":"2F","value":"2F"},{"label":"3F","value":"3F"},{"label":"4F","value":"4F"}]},
   {"name":"current_type","label":"Current / polarity","type":"select","required":true,"defaultValue":"DCEP","options":[{"label":"DCEP (reverse)","value":"DCEP"},{"label":"DCEN (straight)","value":"DCEN"},{"label":"AC","value":"AC"}]},
   {"name":"preheat_min_c","label":"Minimum preheat (°C)","type":"number","required":true,"defaultValue":15,"validation":{"min":0,"max":600}},
   {"name":"notes","label":"Notes (optional)","type":"text","required":false}
 ]'::jsonb,
 '{}'::jsonb, 'edge', '{}'::jsonb, 'pro', ARRAY['ASME BPVC IX','EN ISO 15614-1','AWS D1.1']),

('itp_generator','document','ITP Generator','Build an Inspection & Test Plan with an H/W/R/S/M matrix','clipboard-outline',
 '[
   {"name":"project_name","label":"Project name","type":"text","required":true},
   {"name":"client_name","label":"Client / end user","type":"text","required":true},
   {"name":"discipline","label":"Discipline","type":"select","required":true,"defaultValue":"welding","options":[{"label":"Welding","value":"welding"},{"label":"NDT","value":"ndt"},{"label":"Coating","value":"coating"},{"label":"Civil","value":"civil"},{"label":"Mechanical","value":"mechanical"}]},
   {"name":"scope","label":"Scope of work","type":"text","required":true,"placeholder":"e.g. Fabrication of pressure vessel shell"}
 ]'::jsonb,
 '{}'::jsonb, 'edge', '{}'::jsonb, 'pro', ARRAY['ISO 9001','Project Quality Plan'])

ON CONFLICT (key) DO UPDATE SET
  category=EXCLUDED.category, title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, icon_token=EXCLUDED.icon_token,
  input_schema=EXCLUDED.input_schema, output_schema=EXCLUDED.output_schema, engine=EXCLUDED.engine,
  formula=EXCLUDED.formula, access_tier=EXCLUDED.access_tier, standards_refs=EXCLUDED.standards_refs,
  spec_version=public.engineering_tools.spec_version + 1, updated_at=now();

COMMIT;
