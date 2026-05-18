// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/generate-vca/template.ts
//
//  Embedded HTML template for the Verified Compliance Affidavit. This is
//  the canonical visual artifact rendered server-side from the VCA JSON
//  payload, then uploaded to compliance/affidavits/<job_id>/<id>.html.
//
//  IMPORTANT: this file is a verbatim mirror of
//    src/features/compliance/templates/vca-template.html
//  with two surgical edits:
//    1. We use simpler `{{name}}` and `{{#each items}}…{{/each}}` syntax
//       compiled by Handlebars in the Edge Function.
//    2. The image rendering branch is simplified to use signed URLs
//       resolved by the generator before template fill.
//
//  When the canonical template under src/ changes, update this file.
//  We deliberately do NOT fetch the template from disk at runtime —
//  embedding keeps the Edge Function self-contained and deterministic.
// ════════════════════════════════════════════════════════════════════════════

export const VCA_HTML_TEMPLATE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Verified Compliance Affidavit — {{affidavit_id}}</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 22mm 16mm;
    @bottom-left   { content: "NEXPEC · Verified Compliance Affidavit"; font-family: 'Inter', sans-serif; font-size: 8pt; color: #475569; }
    @bottom-center { content: counter(page) " / " counter(pages); font-family: 'Inter', sans-serif; font-size: 8pt; color: #475569; }
    @bottom-right  { content: "{{public_verify_url}}"; font-family: 'JetBrains Mono', monospace; font-size: 7.5pt; color: #475569; }
  }
  :root {
    --ink: #0F172A; --ink-mute: #475569; --line: #CBD5E1; --line-soft: #E2E8F0;
    --accent: #4338CA; --ok: #047857; --warn: #B45309; --bad: #B91C1C;
    --bg-soft: #F8FAFC; --bg-panel: #F1F5F9;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: 'Source Serif Pro', 'Crimson Pro', Georgia, 'Times New Roman', serif;
    font-size: 10.5pt; line-height: 1.45; color: var(--ink);
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sans  { font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
  .mono  { font-family: 'JetBrains Mono', 'IBM Plex Mono', Menlo, Monaco, monospace; font-size: 8.5pt; }
  .small { font-size: 8.5pt; }
  .micro { font-size: 7.5pt; letter-spacing: 0.4px; text-transform: uppercase; color: var(--ink-mute); }
  .mute  { color: var(--ink-mute); }
  .bold  { font-weight: 700; }
  .right { text-align: right; }
  .center{ text-align: center; }

  .masthead { border-bottom: 2px solid var(--ink); padding-bottom: 12pt; margin-bottom: 18pt; }
  .masthead .brand-row { display: flex; justify-content: space-between; align-items: flex-end; }
  .masthead .brand {
    font-family: 'Inter', sans-serif; font-weight: 800;
    letter-spacing: 2px; font-size: 12pt; color: var(--ink);
  }
  .masthead .brand .nx-mark {
    display: inline-block; width: 14pt; height: 14pt; margin-right: 6pt; vertical-align: -2pt;
    background: var(--accent);
    -webkit-mask: radial-gradient(circle at 30% 30%, transparent 38%, black 39%);
            mask: radial-gradient(circle at 30% 30%, transparent 38%, black 39%);
  }
  .masthead h1 {
    font-family: 'Source Serif Pro', Georgia, serif; font-size: 22pt; font-weight: 700;
    margin: 12pt 0 4pt 0; letter-spacing: -0.3px;
  }
  .masthead .subtitle {
    font-family: 'Inter', sans-serif; font-size: 9.5pt; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--accent); font-weight: 600;
  }
  .masthead .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8pt 24pt; margin-top: 14pt; }
  .masthead .meta-grid .lbl { font-family: 'Inter', sans-serif; font-size: 7.5pt; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-mute); }
  .masthead .meta-grid .val { font-family: 'Inter', sans-serif; font-size: 10pt; font-weight: 600; color: var(--ink); margin-top: 1pt; }
  .masthead .meta-grid .val.mono { font-family: 'JetBrains Mono', monospace; font-size: 8.5pt; word-break: break-all; }

  section { margin-bottom: 18pt; }
  section h2 {
    font-family: 'Inter', sans-serif; font-size: 9pt; letter-spacing: 1.4px;
    text-transform: uppercase; color: var(--ink-mute);
    margin: 0 0 8pt 0; padding-bottom: 4pt; border-bottom: 1px solid var(--line);
  }
  .kv-row { display: grid; grid-template-columns: 140pt 1fr; gap: 6pt 18pt; padding: 3pt 0; border-bottom: 1px solid var(--line-soft); }
  .kv-row:last-child { border-bottom: none; }
  .kv-row .k { font-family: 'Inter', sans-serif; font-size: 8.5pt; color: var(--ink-mute); }
  .kv-row .v { font-size: 10pt; color: var(--ink); }

  .validity-stamp { border: 1.5pt solid var(--accent); border-radius: 6pt; padding: 10pt 14pt; display: inline-block; margin-top: 6pt; }
  .validity-stamp .lbl { font-family: 'Inter', sans-serif; font-size: 7.5pt; letter-spacing: 0.8px; text-transform: uppercase; color: var(--accent); font-weight: 700; }
  .validity-stamp .range { font-family: 'Source Serif Pro', serif; font-size: 12pt; font-weight: 700; margin-top: 4pt; }

  .evidence-group { border: 1px solid var(--line); border-radius: 4pt; padding: 10pt 12pt; margin-bottom: 10pt; page-break-inside: avoid; }
  .evidence-group .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8pt; }
  .evidence-group .head .label { font-family: 'Inter', sans-serif; font-weight: 700; font-size: 10pt; }
  .evidence-group .head .kind  { font-family: 'Inter', sans-serif; font-size: 7.5pt; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-mute); }
  .evidence-group .hint { font-size: 9pt; color: var(--ink-mute); margin-bottom: 8pt; font-style: italic; }

  .capture-row { display: grid; grid-template-columns: 60pt 1fr; gap: 10pt; padding: 8pt 0; border-top: 1px solid var(--line-soft); }
  .capture-row:first-of-type { border-top: none; }
  .capture-thumb { width: 60pt; height: 60pt; background: var(--bg-panel); border: 1px solid var(--line); border-radius: 3pt; overflow: hidden; display: flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; font-size: 7pt; color: var(--ink-mute); text-align: center; }
  .capture-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .capture-meta { font-size: 9pt; }
  .capture-meta .row { display: flex; gap: 8pt; align-items: center; margin-bottom: 2pt; flex-wrap: wrap; }

  .badge { display: inline-block; padding: 1pt 6pt; border-radius: 3pt; font-family: 'Inter', sans-serif; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  .badge-ok      { background: rgba(4,120,87,0.12);  color: var(--ok); }
  .badge-warn    { background: rgba(180,83,9,0.14);  color: var(--warn); }
  .badge-bad     { background: rgba(185,28,28,0.12); color: var(--bad); }
  .badge-neutral { background: var(--bg-panel);      color: var(--ink-mute); }
  /* External-evidence pill: cyan, communicates "off-platform asset". */
  .badge-info    { background: rgba(6,182,212,0.12); color: #0e7490; }
  .ext-link {
    display: inline-block; margin-top: 4px;
    font-size: 8pt; color: #0e7490; text-decoration: underline;
    word-break: break-all;
  }
  .docs-note {
    margin-top: 8pt; font-size: 8pt; line-height: 1.5;
    color: var(--ink-mute); font-style: italic;
  }

  table.docs { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.docs th, table.docs td { padding: 6pt 8pt; border-bottom: 1px solid var(--line-soft); text-align: left; }
  table.docs th { font-family: 'Inter', sans-serif; font-size: 7.5pt; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ink-mute); }

  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24pt; margin-top: 14pt; }
  .sig-card { border-top: 1px solid var(--ink); padding-top: 8pt; }
  .sig-card .role { font-family: 'Inter', sans-serif; font-size: 7.5pt; letter-spacing: 0.6px; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 4pt; }
  .sig-card .name { font-family: 'Source Serif Pro', serif; font-size: 14pt; font-weight: 700; }
  .sig-card .credential { font-size: 9pt; color: var(--ink-mute); margin-top: 1pt; }
  .sig-card .when { font-family: 'Inter', sans-serif; font-size: 8.5pt; margin-top: 6pt; }
  .sig-card .glyph { font-family: 'Source Serif Pro', serif; font-style: italic; font-size: 22pt; color: var(--accent); margin-top: 6pt; letter-spacing: 1px; }

  .coc { background: var(--bg-soft); border: 1px solid var(--line); border-radius: 4pt; padding: 10pt 12pt; page-break-inside: avoid; }
  .coc .row { display: grid; grid-template-columns: 160pt 1fr; gap: 6pt 16pt; padding: 2pt 0; }
  .coc .row .k { font-family: 'Inter', sans-serif; font-size: 8.5pt; color: var(--ink-mute); }
  .coc .row .v { font-family: 'JetBrains Mono', monospace; font-size: 8pt; word-break: break-all; }

  .revoked-banner { background: rgba(185,28,28,0.06); border: 1.5pt solid var(--bad); border-radius: 4pt; padding: 10pt 14pt; margin-bottom: 14pt; }
  .revoked-banner .title { font-family: 'Inter', sans-serif; font-weight: 800; color: var(--bad); letter-spacing: 1px; text-transform: uppercase; font-size: 9pt; }
  .revoked-banner .body  { font-size: 10pt; margin-top: 4pt; }

  .page-break { page-break-before: always; }
</style>
</head>
<body>

  {{#if revocation}}
  <div class="revoked-banner">
    <div class="title">⛔ Revoked</div>
    <div class="body">
      This affidavit was revoked on <span class="bold">{{revocation.revoked_at}}</span>.
      Reason: {{revocation.revoked_reason}}.
    </div>
  </div>
  {{/if}}

  <header class="masthead">
    <div class="brand-row">
      <div class="brand"><span class="nx-mark"></span>NEXPEC</div>
      <div class="micro">Independent Compliance Authority</div>
    </div>
    <div class="subtitle">{{scope.category}} · {{scope.region}} · v{{scope.template_version}}</div>
    <h1>Verified Compliance Affidavit</h1>
    <div class="sans mute small">{{scope.template_name}}</div>

    <div class="meta-grid">
      <div><div class="lbl">Affidavit ID</div>      <div class="val mono">{{affidavit_id}}</div></div>
      <div><div class="lbl">Public Verify URL</div> <div class="val mono">{{public_verify_url}}</div></div>
      <div><div class="lbl">Issued</div>            <div class="val">{{issued_at}}</div></div>
      <div><div class="lbl">Validity</div>          <div class="val">{{validity.from}} — {{validity.until}} <span class="mute">({{validity.months}} months)</span></div></div>
    </div>
  </header>

  <section>
    <h2>Subject Entity (Verified Party)</h2>
    <div class="kv-row"><div class="k">Name</div>            <div class="v">{{subject.name}}</div></div>
    <div class="kv-row"><div class="k">Claimed Address</div> <div class="v">{{subject.claimed_address_text}}</div></div>
    {{#if subject.claimed_address_geocoded}}
    <div class="kv-row"><div class="k">Geocoded</div>        <div class="v mono">{{subject.claimed_address_geocoded.lat}}, {{subject.claimed_address_geocoded.lng}}</div></div>
    {{/if}}
    <div class="kv-row"><div class="k">Subject ID (hash)</div><div class="v mono">{{subject.subject_id_hash}}</div></div>
  </section>

  <section>
    <h2>Commissioning Party (Buyer)</h2>
    <div class="kv-row"><div class="k">Name</div>             <div class="v">{{buyer.name}}</div></div>
    <div class="kv-row"><div class="k">Type</div>             <div class="v">{{buyer.type}}</div></div>
    <div class="kv-row"><div class="k">Buyer ID (hash)</div>  <div class="v mono">{{buyer.buyer_id_hash}}</div></div>
  </section>

  <section class="center">
    <div class="validity-stamp">
      <div class="lbl">This Affidavit Is Valid Until</div>
      <div class="range">{{validity.until}}</div>
    </div>
  </section>

  <section>
    <h2>Evidence Record</h2>
    {{#each evidence}}
    <div class="evidence-group">
      <div class="head">
        <div class="label">{{requirement.sort_order}}. {{requirement.label}}</div>
        <div class="kind">{{requirement.kind}}</div>
      </div>
      {{#if requirement.hint}}<div class="hint">{{requirement.hint}}</div>{{/if}}

      {{#each captures}}
      <div class="capture-row">
        <div class="capture-thumb">
          {{#if storage_signed_url}}<img src="{{storage_signed_url}}" alt="capture" />{{else}}{{kind}}{{/if}}
        </div>
        <div class="capture-meta">
          <div class="row">
            <span class="badge {{validation_badge_class}}">{{validation.status}}</span>
            {{#if gps}}
              <span class="badge {{gps_badge_class}}">GPS {{gps_label}}</span>
            {{/if}}
            {{#if device_attestation.present}}
              <span class="badge badge-ok">Device attested ({{device_attestation.platform}})</span>
            {{/if}}
            {{#if face}}
              <span class="badge {{face_badge_class}}">{{face.detected_count}} face(s) · liveness {{face.liveness_score}}</span>
            {{/if}}
          </div>
          <div class="row mute small">Captured {{captured_at}} · {{mime_type}}</div>
          {{#if exif_summary}}
            <div class="row mute small">Device: {{exif_summary.Make}} {{exif_summary.Model}} · EXIF GPS {{exif_gps_label}}</div>
          {{/if}}
          {{#if gps}}
            <div class="row mono mute">{{gps.lat}}, {{gps.lng}} · ±{{gps.accuracy_m}}m</div>
          {{/if}}
          {{#if text_value}}
            <div class="row" style="margin-top:4pt;"><span class="mute small">Value:</span> <span class="bold">{{text_value}}</span></div>
          {{/if}}
          <div class="row mono mute" style="font-size:7pt; margin-top:2pt;">sha256 {{capture_sha256}}</div>
        </div>
      </div>
      {{/each}}
    </div>
    {{/each}}
  </section>

  {{#if documents.length}}
  <section class="page-break">
    <h2>Documents Verified</h2>
    <table class="docs">
      <thead><tr><th>Type</th><th>Source</th><th>Authority</th><th>Number</th><th>Issued</th><th>Expires</th><th>Status</th></tr></thead>
      <tbody>
        {{#each documents}}
        <tr>
          <td>{{doc_type}}</td>
          <td>
            {{#if is_external_evidence}}
              <span class="badge badge-info">External Evidence</span>
              <br/>
              <a href="{{document_url}}" target="_blank" rel="noopener noreferrer" class="ext-link">Open link &#8599;</a>
            {{else}}
              <span class="badge badge-neutral">Uploaded</span>
            {{/if}}
          </td>
          <td>{{issuing_authority}}</td>
          <td class="mono">{{document_number}}</td>
          <td>{{issued_at}}</td>
          <td>{{expires_at}}</td>
          <td><span class="badge {{verification_badge_class}}">{{verification_status}}</span></td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    <p class="docs-note">
      "External Evidence" links are recorded as part of the supplier's claimed
      compliance package. The platform does not host these artifacts — they are
      reachable via the provided URLs at the time of issuance.
    </p>
  </section>
  {{/if}}

  <section>
    <h2>Chain of Custody</h2>
    <div class="coc">
      <div class="row"><div class="k">Chain integrity</div>
        <div class="v"><span class="badge {{chain_of_custody.chain_badge_class}}">{{chain_of_custody.chain_status_text}}</span></div>
      </div>
      <div class="row"><div class="k">Total captures</div>           <div class="v">{{chain_of_custody.total_captures}}</div></div>
      <div class="row"><div class="k">First capture sha256</div>     <div class="v">{{chain_of_custody.first_capture_sha256}}</div></div>
      <div class="row"><div class="k">Last capture sha256</div>      <div class="v">{{chain_of_custody.last_capture_sha256}}</div></div>
      {{#if chain_of_custody.notes.length}}
      <div class="row"><div class="k">Notes</div>
        <div class="v sans small">{{#each chain_of_custody.notes}}• {{this}}<br/>{{/each}}</div>
      </div>
      {{/if}}
    </div>
  </section>

  <section>
    <h2>Signatures</h2>
    <div class="signatures">
      <div class="sig-card">
        <div class="role">Compliance-Certified Inspector</div>
        <div class="name">{{inspector.name}}</div>
        <div class="credential">{{inspector.credential.tier}} · approved {{inspector.credential.approved_at}}</div>
        <div class="when">Signed {{inspector.signed_at}}</div>
        <div class="glyph">{{inspector.name}}</div>
      </div>
      {{#if countersignature}}
      <div class="sig-card">
        <div class="role">Countersigned by NEXPEC Admin</div>
        <div class="name">{{countersignature.admin_name}}</div>
        <div class="credential">NEXPEC Compliance Authority</div>
        <div class="when">Countersigned {{countersignature.countersigned_at}}</div>
        {{#if countersignature.admin_note}}<div class="small mute" style="margin-top:6pt;">{{countersignature.admin_note}}</div>{{/if}}
        <div class="glyph">{{countersignature.admin_name}}</div>
      </div>
      {{else}}
      <div class="sig-card">
        <div class="role">Awaiting Admin Countersignature</div>
        <div class="name mute" style="font-style:italic;">— pending —</div>
        <div class="credential">Required for {{scope.template_name}} scope.</div>
      </div>
      {{/if}}
    </div>
  </section>

  <section style="margin-top:24pt;">
    <h2>Tamper Evidence</h2>
    <div class="coc">
      <div class="row"><div class="k">VCA schema version</div>   <div class="v sans">{{vca_version}}</div></div>
      <div class="row"><div class="k">JSON payload sha256</div>  <div class="v">{{tamper_evidence.json_payload_sha256}}</div></div>
      <div class="row"><div class="k">HTML sha256</div>          <div class="v">{{tamper_evidence.html_sha256}}</div></div>
      <div class="row"><div class="k">Signing algorithm</div>    <div class="v sans">{{tamper_evidence.signing_algorithm}}</div></div>
      <div class="row"><div class="k">Signing key id</div>       <div class="v">{{tamper_evidence.platform_signing_key_id}}</div></div>
      <div class="row"><div class="k">Platform signature</div>   <div class="v">{{tamper_evidence.platform_signature}}</div></div>
    </div>
    <p class="small mute" style="margin-top:10pt; line-height:1.5;">
      The integrity of this affidavit can be verified at any time by visiting
      <span class="mono bold">{{public_verify_url}}</span>. The platform signature
      is computed over the canonicalized JSON payload (RFC 8785 JCS) using the
      NEXPEC signing key identified above. Tampering with this document — including
      modification of the rendered HTML — will invalidate the hash check on the
      public verify page.
    </p>
  </section>
</body>
</html>`;
