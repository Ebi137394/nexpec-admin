-- ════════════════════════════════════════════════════════════════════════════
--  20260801560000_restore_engineering_tools_registry.sql
--
--  P1 REGRESSION — the Engineering Tools library rendered empty ("No tools
--  match your search.") for signed-in inspectors on Web and Mobile.
--
--  ── ROOT CAUSE (reproduced, not inferred) ───────────────────────────────────
--  The tool Foundry is 100% data-driven: both clients list rows from
--  public.engineering_tools (RLS tools_read: is_active). Commit 71a0416
--  ("squash 199 migrations into single prod-schema baseline") captured SCHEMA
--  only — the tool DEFINITIONS were pure DATA seeded by the (now archived,
--  never-applied) migrations 20260801121000_tool_foundry_core.sql and
--  20260801121700_document_tools_register.sql. Rebuilding the database from
--  the squashed baseline therefore restored the engine (tables, tool_invoke,
--  tool_eval, RLS, grants — all verified present) with ZERO rows:
--      staging: select count(*) from engineering_tools      → 0
--      staging: select count(*) from tool_reference_data    → 0
--  Nothing was filtered, hidden or permission-blocked; there was simply
--  nothing to list. No code path changed.
--
--  ── FIX ─────────────────────────────────────────────────────────────────────
--  Re-register, VERBATIM from the archived sources (nothing invented):
--    §1  tool_reference_data: unit_si conversion table + rt_hvl gamma HVL
--    §2  the 12 DSL calculators (mechanical/civil/electrical/welding/ndt/…)
--    §3  the 2 edge document generators (Auto WPS, ITP — pro tier)
--    §4  the original end-to-end behavioural self-test: tool_invoke really
--        computes (bolt torque 600 N·m, 1 in → 25.4 mm, 100 °C → 212 °F,
--        heat input 0.8 kJ/mm, Reynolds regime, validation rejection).
--  All inserts are idempotent (ON CONFLICT ... DO UPDATE), so re-applying is
--  safe and future edits bump spec_version.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;


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


-- ─── Behavioural self-test (verbatim from the archived foundry core) ────────
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

-- Registry completeness — exactly the library that existed before the squash.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.engineering_tools WHERE is_active;
  IF n < 14 THEN
    RAISE EXCEPTION 'RESTORE SELFTEST: expected >= 14 active tools, found %', n;
  END IF;
  SELECT count(*) INTO n FROM public.tool_reference_data;
  IF n < 2 THEN
    RAISE EXCEPTION 'RESTORE SELFTEST: reference data missing (found % rows)', n;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
