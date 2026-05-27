// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/dispatch-notification-emails/templates.ts
//
//  Real HTML email templates for transactional notifications.
//  All templates share the NEXPEC dark visual language:
//    background  #020420
//    primary     #7C3AED
//    card        #0F172A
//
//  Each renderer returns { subject, html, text }. Plain-text fallback
//  is included for clients that block HTML and for spam-filter karma.
// ════════════════════════════════════════════════════════════════════════════

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  recipient_email: string;
  recipient_name: string | null;
  kind: string;
  title: string;
  body: string | null;
  link_href: string | null;
  job_id: string | null;
  email_template_kind: string | null;
  email_template_data: Record<string, unknown> | null;
  email_attempts: number;
  created_at: string;
}

export function renderEmail(
  row: NotificationRow,
  appBaseUrl: string,
): RenderedEmail {
  const data = (row.email_template_data ?? {}) as Record<string, unknown>;
  const kind = row.email_template_kind ?? 'generic';

  switch (kind) {
    case 'approval.requested':
      return renderApprovalRequested(row, data, appBaseUrl);
    case 'approval.decided.approved':
      return renderApprovalDecided(row, data, appBaseUrl, 'approved');
    case 'approval.decided.rejected':
      return renderApprovalDecided(row, data, appBaseUrl, 'rejected');
    case 'evidence_pack.assembled':
      return renderEvidencePack(row, data, appBaseUrl);
    case 'inspection_report.sealed_awaiting_countersign':
      return renderSealAwaitingCountersign(row, data, appBaseUrl);
    case 'coordination_bridge.invitation':
      return renderBridgeInvitation(row, data, appBaseUrl);
    case 'coordination_bridge.document_requested':
      return renderBridgeDocumentRequested(row, data, appBaseUrl);
    case 'coordination_bridge.schedule_proposed_to_vendor':
      return renderBridgeSchedulePropose(row, data, appBaseUrl);
    default:
      return renderGeneric(row, appBaseUrl);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Shared layout — every email uses the same header + footer wrapper.
// ─────────────────────────────────────────────────────────────────────
function shell(opts: {
  preheader: string;
  bannerLabel: string;
  bannerColor: string;
  bannerIcon: string;
  innerHtml: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>NEXPEC</title>
</head>
<body style="margin: 0; padding: 0; background-color: #020420; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;font-size:1px;line-height:1px;color:#020420;">${escapeHtml(opts.preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#020420;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%);padding:14px 28px;border-radius:12px;">
                    <span style="font-size:24px;font-weight:700;color:#FFFFFF;letter-spacing:2px;">NEXPEC</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#0F172A;border-radius:16px;overflow:hidden;border:1px solid #1E293B;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:${opts.bannerColor};padding:22px;text-align:center;">
                    <div style="font-size:36px;margin-bottom:6px;">${opts.bannerIcon}</div>
                    <h1 style="margin:0;color:#FFFFFF;font-size:22px;font-weight:700;">${escapeHtml(opts.bannerLabel)}</h1>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:28px 30px 18px 30px;">
                    ${opts.innerHtml}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color:#1E293B;padding:18px 30px;border-top:1px solid #334155;text-align:center;">
                    <p style="margin:0;color:#94A3B8;font-size:12px;">
                      ${escapeHtml(opts.footerNote ?? 'You are receiving this because you are an active member of an organization on NEXPEC.')}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 20px;text-align:center;">
              <p style="margin:0 0 6px 0;color:#64748B;font-size:12px;">Automated message from NEXPEC.</p>
              <p style="margin:0;color:#475569;font-size:11px;">© ${new Date().getUTCFullYear()} NEXPEC. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:20px 0;">
    <tr>
      <td style="border-radius:10px;background:linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%);">
        <a href="${escapeAttr(href)}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function metaRow(left: { label: string; value: string }, right?: { label: string; value: string }): string {
  return `<tr>
    <td width="50%" style="padding:8px 0;">
      <span style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(left.label)}</span><br>
      <span style="color:#F1F5F9;font-size:14px;font-weight:600;">${escapeHtml(left.value)}</span>
    </td>
    ${right ? `<td width="50%" style="padding:8px 0;">
      <span style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(right.label)}</span><br>
      <span style="color:#F1F5F9;font-size:14px;font-weight:600;">${escapeHtml(right.value)}</span>
    </td>` : '<td width="50%"></td>'}
  </tr>`;
}

function metaCard(rows: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;">
    <tr>
      <td style="background-color:#1E293B;border-radius:12px;padding:18px 20px;border-left:4px solid #7C3AED;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          ${rows}
        </table>
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────

function renderApprovalRequested(
  row: NotificationRow,
  data: Record<string, unknown>,
  appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection job');
  const orgName = String(data.org_name ?? 'Your organization');
  const requesterName = String(data.requester_name ?? 'A teammate');
  const amount = String(data.amount_display ?? '');
  const deptName = data.department_name ? String(data.department_name) : null;
  const link = absoluteUrl(appBaseUrl, String(data.approver_link ?? row.link_href ?? '/client/approvals'));
  const recipientName = row.recipient_name ?? row.recipient_email;
  const requestedAtRaw = data.requested_at ? String(data.requested_at) : null;
  const requestedAt = requestedAtRaw ? formatDate(requestedAtRaw) : '—';
  const recipientRole = data.recipient_role ? humanRole(String(data.recipient_role)) : 'Approver';

  const subject = `Action required: approve ${amount} for ${jobTitle}`;

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      Hi <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      <strong style="color:#F1F5F9;">${escapeHtml(requesterName)}</strong> at ${escapeHtml(orgName)} has submitted a job that needs your approval before it can be posted.
    </p>
    ${metaCard(
      metaRow(
        { label: 'Job', value: jobTitle },
        { label: 'Amount', value: amount || '—' },
      ) + metaRow(
        { label: 'Department', value: deptName ?? '—' },
        { label: 'Submitted', value: requestedAt },
      ) + metaRow(
        { label: 'Requested by', value: requesterName },
        { label: 'Your role', value: recipientRole },
      )
    )}
    ${ctaButton(link, 'Review and decide')}
    <p style="margin:18px 0 0 0;color:#64748B;font-size:12px;line-height:1.6;">
      NEXPEC enforces Segregation of Duties at the database layer — the requester cannot approve their own request. Your decision is recorded in the immutable audit trail and is independently verifiable.
    </p>`;

  const html = shell({
    preheader: `${requesterName} submitted ${amount} for review.`,
    bannerLabel: 'Approval needed',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '⏳',
    innerHtml: inner,
    footerNote: `Tap "Review and decide" to open the approval inside NEXPEC. You can also reply directly from /client/approvals.`,
  });

  const text =
`Hi ${recipientName},

${requesterName} at ${orgName} has submitted a job that needs your approval before it can be posted.

Job:        ${jobTitle}
Amount:     ${amount || '—'}
Department: ${deptName ?? '—'}
Submitted:  ${requestedAt}
Your role:  ${recipientRole}

Review and decide: ${link}

NEXPEC enforces Segregation of Duties at the database layer. The requester cannot approve their own request.

— NEXPEC`;

  return { subject, html, text };
}

function renderApprovalDecided(
  row: NotificationRow,
  data: Record<string, unknown>,
  appBaseUrl: string,
  outcome: 'approved' | 'rejected',
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection job');
  const amount = String(data.amount_display ?? '');
  const deciderName = String(data.decider_name ?? 'An approver');
  const deciderRole = data.decider_role_at_time ? humanRole(String(data.decider_role_at_time)) : '';
  const comment = data.comment ? String(data.comment) : null;
  const rejectionReason = data.rejection_reason ? String(data.rejection_reason) : null;
  const link = absoluteUrl(appBaseUrl, String(data.requester_link ?? row.link_href ?? '/client'));
  const recipientName = row.recipient_name ?? row.recipient_email;
  const finalAt = data.final_decision_at ? formatDate(String(data.final_decision_at)) : formatDate(row.created_at);

  const banner = outcome === 'approved'
    ? { label: 'Approval granted', color: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', icon: '✓' }
    : { label: 'Approval rejected', color: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)', icon: '✕' };

  const subject = outcome === 'approved'
    ? `Approved: ${jobTitle} is cleared to post`
    : `Not approved: ${jobTitle}`;

  const lead = outcome === 'approved'
    ? `Good news — your <strong>${escapeHtml(amount)}</strong> request for <strong>${escapeHtml(jobTitle)}</strong> has cleared approvals. The job is now visible to inspectors.`
    : `Your <strong>${escapeHtml(amount)}</strong> request for <strong>${escapeHtml(jobTitle)}</strong> was not approved. Review the comment below and adjust as needed.`;

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      Hi <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      ${lead}
    </p>
    ${metaCard(
      metaRow(
        { label: 'Job',     value: jobTitle },
        { label: 'Amount',  value: amount || '—' },
      ) + metaRow(
        { label: 'Decided by', value: deciderName + (deciderRole ? ` (${deciderRole})` : '') },
        { label: 'Decided at', value: finalAt },
      )
    )}
    ${(comment || rejectionReason) ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:14px 0;">
        <tr>
          <td style="background-color:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:10px;padding:14px 16px;">
            <p style="margin:0 0 4px 0;color:#A78BFA;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Approver note</p>
            <p style="margin:0;color:#E2E8F0;font-size:14px;line-height:1.6;">${escapeHtml(rejectionReason ?? comment ?? '')}</p>
          </td>
        </tr>
      </table>` : ''}
    ${ctaButton(link, outcome === 'approved' ? 'View the live job' : 'Open the request')}`;

  const html = shell({
    preheader: outcome === 'approved'
      ? `${jobTitle} is cleared to post.`
      : `${jobTitle} was not approved.`,
    bannerLabel: banner.label,
    bannerColor: banner.color,
    bannerIcon: banner.icon,
    innerHtml: inner,
  });

  const text =
`Hi ${recipientName},

${outcome === 'approved' ? 'APPROVED' : 'NOT APPROVED'}: ${jobTitle}

Amount:     ${amount || '—'}
Decided by: ${deciderName}${deciderRole ? ` (${deciderRole})` : ''}
Decided at: ${finalAt}
${(comment || rejectionReason) ? `\nApprover note:\n${rejectionReason ?? comment}\n` : ''}
Open in NEXPEC: ${link}

— NEXPEC`;

  return { subject, html, text };
}

function renderEvidencePack(
  row: NotificationRow,
  data: Record<string, unknown>,
  appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection job');
  const rootHash = data.root_hash ? String(data.root_hash) : '';
  const packId = data.pack_id ? String(data.pack_id) : '';
  const link = absoluteUrl(appBaseUrl, String(data.pack_link ?? row.link_href ?? '/client/compliance'));
  const verifyLink = absoluteUrl(appBaseUrl, '/verify');
  const recipientName = row.recipient_name ?? row.recipient_email;
  const assembledAt = data.assembled_at ? formatDate(String(data.assembled_at)) : formatDate(row.created_at);

  const subject = `Evidence pack ready: ${jobTitle}`;

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      Hi <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      Your tamper-evident evidence pack for <strong style="color:#F1F5F9;">${escapeHtml(jobTitle)}</strong> has been assembled. Each artifact is hashed with SHA-256 and bound under a Merkle-style root — any modification will invalidate the verification.
    </p>
    ${metaCard(
      metaRow(
        { label: 'Pack ID',   value: packId || '—' },
        { label: 'Assembled', value: assembledAt },
      ) + (rootHash ? `
        <tr>
          <td colspan="2" style="padding:8px 0;">
            <span style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Root hash (SHA-256)</span><br>
            <code style="display:inline-block;margin-top:4px;color:#A78BFA;font-size:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;word-break:break-all;">${escapeHtml(rootHash)}</code>
          </td>
        </tr>` : '')
    )}
    ${ctaButton(link, 'Open the evidence pack')}
    <p style="margin:18px 0 8px 0;color:#94A3B8;font-size:13px;line-height:1.6;">
      Need a third-party reviewer to verify it? Send them the pack file plus this link — no account required:
    </p>
    <p style="margin:0;color:#A78BFA;font-size:13px;word-break:break-all;">
      <a href="${escapeAttr(verifyLink)}" style="color:#A78BFA;text-decoration:underline;">${escapeHtml(verifyLink)}</a>
    </p>`;

  const html = shell({
    preheader: `Evidence pack for ${jobTitle} is ready to share.`,
    bannerLabel: 'Evidence pack ready',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '🛡',
    innerHtml: inner,
    footerNote: 'Evidence packs are cryptographically signed at assembly time and can be re-verified independently of NEXPEC.',
  });

  const text =
`Hi ${recipientName},

Your evidence pack for ${jobTitle} has been assembled.

Pack ID:    ${packId || '—'}
Assembled:  ${assembledAt}
Root hash:  ${rootHash || '—'}

Open the pack:    ${link}
Public verifier:  ${verifyLink}

Any modification to the pack will invalidate the SHA-256 root hash. Share the file plus the verifier link with any third-party reviewer — no NEXPEC account required.

— NEXPEC`;

  return { subject, html, text };
}

function renderSealAwaitingCountersign(
  row: NotificationRow,
  data: Record<string, unknown>,
  appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection job');
  const inspectorName = String(data.inspector_name ?? 'Your inspector');
  const rootHash = data.root_sha256 ? String(data.root_sha256) : '';
  const capturesCount = data.captures_count ? String(data.captures_count) : '0';
  const itemsCount = data.items_count ? String(data.items_count) : '0';
  const chainOk = data.chain_verified === true;
  const sealedAt = data.inspector_sealed_at
    ? formatDate(String(data.inspector_sealed_at))
    : formatDate(row.created_at);
  const countersignLink = absoluteUrl(
    appBaseUrl,
    String(data.countersign_link ?? row.link_href ?? '/client'),
  );
  const verifyLink = absoluteUrl(
    appBaseUrl,
    String(data.verify_link ?? '/verify'),
  );
  const recipientName = row.recipient_name ?? row.recipient_email;

  const subject = `Sealed: ${jobTitle} — ready to countersign`;

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      Hi <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      <strong style="color:#F1F5F9;">${escapeHtml(inspectorName)}</strong> sealed the inspection report for
      <strong style="color:#F1F5F9;">${escapeHtml(jobTitle)}</strong>. Every photo, every finding, and the
      report metadata are now bound under a single SHA-256 root. Your countersignature finalises the cryptographic
      chain — auditors will see both signatures on the evidence pack.
    </p>
    ${metaCard(
      metaRow(
        { label: 'Captures', value: capturesCount },
        { label: 'Items', value: itemsCount },
      ) + metaRow(
        { label: 'Sealed at', value: sealedAt },
        { label: 'Chain', value: chainOk ? 'Intact' : 'Has break (review)' },
      ) + (rootHash ? `
        <tr>
          <td colspan="2" style="padding:8px 0;">
            <span style="color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Root SHA-256</span><br>
            <code style="display:inline-block;margin-top:4px;color:#A78BFA;font-size:12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;word-break:break-all;">${escapeHtml(rootHash)}</code>
          </td>
        </tr>` : '')
    )}
    ${ctaButton(countersignLink, 'Review and countersign')}
    <p style="margin:18px 0 8px 0;color:#94A3B8;font-size:13px;line-height:1.6;">
      Want a third-party verifier to confirm the seal independently? Share this link — no NEXPEC account required:
    </p>
    <p style="margin:0;color:#A78BFA;font-size:13px;word-break:break-all;">
      <a href="${escapeAttr(verifyLink)}" style="color:#A78BFA;text-decoration:underline;">${escapeHtml(verifyLink)}</a>
    </p>`;

  const html = shell({
    preheader: `${inspectorName} sealed ${jobTitle} — awaiting your countersignature.`,
    bannerLabel: 'Sealed — awaiting countersign',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '🛡',
    innerHtml: inner,
    footerNote: 'Countersigning adds your cryptographic signature alongside the inspector’s. The seal becomes binding under both parties.',
  });

  const text =
`Hi ${recipientName},

${inspectorName} sealed the inspection report for ${jobTitle}.

Captures:   ${capturesCount}
Items:      ${itemsCount}
Sealed at:  ${sealedAt}
Chain:      ${chainOk ? 'Intact' : 'Has break (review)'}
Root hash:  ${rootHash || '—'}

Review and countersign: ${countersignLink}
Public verifier:        ${verifyLink}

Countersigning adds your cryptographic signature alongside the inspector’s. The seal becomes binding under both parties.

— NEXPEC`;

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
// Coordination Bridge templates (vendor-facing)
// ─────────────────────────────────────────────────────────────────────

function renderBridgeInvitation(
  _row: NotificationRow,
  data: Record<string, unknown>,
  _appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection');
  const inspectorName = String(data.inspector_name ?? 'Your inspector');
  const vendorCompany = String(data.vendor_company ?? 'your company');
  const vendorContact = data.vendor_contact ? String(data.vendor_contact) : '';
  const portalUrl = String(data.portal_url ?? '');
  const tokenExpiresAt = data.token_expires_at
    ? formatDate(String(data.token_expires_at))
    : '';

  const subject = `${inspectorName} has invited ${vendorCompany} to coordinate the ${jobTitle} inspection`;

  const greeting = vendorContact ? `Hi ${escapeHtml(vendorContact)},` : 'Hello,';

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      ${greeting}
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      <strong style="color:#F1F5F9;">${escapeHtml(inspectorName)}</strong> would like to coordinate the
      <strong style="color:#F1F5F9;">${escapeHtml(jobTitle)}</strong> inspection with
      <strong style="color:#F1F5F9;">${escapeHtml(vendorCompany)}</strong>. Use the secure link below to:
    </p>
    <ul style="margin:0 0 18px 18px;padding:0;color:#94A3B8;font-size:14px;line-height:1.7;">
      <li>Confirm or propose an inspection date</li>
      <li>Upload preliminary documents the inspector has requested</li>
      <li>Share site access requirements (PPE, escort, entry hours)</li>
    </ul>
    ${ctaButton(portalUrl, 'Open the Coordination Bridge')}
    <p style="margin:18px 0 8px 0;color:#94A3B8;font-size:13px;line-height:1.6;">
      This link is private to you and to this one inspection. No NEXPEC account is required.
      The link expires on <strong style="color:#F1F5F9;">${escapeHtml(tokenExpiresAt)}</strong>.
    </p>
    <p style="margin:8px 0 0 0;color:#A78BFA;font-size:11px;word-break:break-all;">
      <a href="${escapeAttr(portalUrl)}" style="color:#A78BFA;text-decoration:underline;">${escapeHtml(portalUrl)}</a>
    </p>`;

  const html = shell({
    preheader: `${inspectorName} invited you to coordinate ${jobTitle}.`,
    bannerLabel: 'Coordination Bridge invitation',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '⌬',
    innerHtml: inner,
    footerNote:
      'You received this email because an inspector working through NEXPEC needs to coordinate an inspection with your company. The link is private to this one inspection.',
  });

  const text =
`${vendorContact ? `Hi ${vendorContact},` : 'Hello,'}

${inspectorName} would like to coordinate the ${jobTitle} inspection with ${vendorCompany}.

Open your private Coordination Bridge:
${portalUrl}

You can:
  • Confirm or propose an inspection date
  • Upload preliminary documents
  • Share site access requirements

The link expires on ${tokenExpiresAt}.
No NEXPEC account is required.

— NEXPEC`;

  return { subject, html, text };
}

function renderBridgeDocumentRequested(
  _row: NotificationRow,
  data: Record<string, unknown>,
  _appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection');
  const inspectorName = String(data.inspector_name ?? 'Your inspector');
  const vendorCompany = String(data.vendor_company ?? 'your company');
  const vendorContact = data.vendor_contact ? String(data.vendor_contact) : '';
  const docTitle = String(data.document_title ?? 'Preliminary document');
  const docDescription = data.document_description ? String(data.document_description) : '';
  const required = data.required === true;

  const subject = `${inspectorName} needs ${docTitle} for the ${jobTitle} inspection`;
  const greeting = vendorContact ? `Hi ${escapeHtml(vendorContact)},` : 'Hello,';

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">${greeting}</p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      <strong style="color:#F1F5F9;">${escapeHtml(inspectorName)}</strong> has requested
      <strong style="color:#F1F5F9;">${escapeHtml(docTitle)}</strong> from
      <strong style="color:#F1F5F9;">${escapeHtml(vendorCompany)}</strong>
      ahead of the <strong style="color:#F1F5F9;">${escapeHtml(jobTitle)}</strong> inspection.
    </p>
    ${docDescription ? `<p style="margin:0 0 14px 0;color:#94A3B8;font-size:14px;line-height:1.7;">${escapeHtml(docDescription)}</p>` : ''}
    ${metaCard(metaRow(
      { label: 'Document', value: docTitle },
      { label: 'Required', value: required ? 'Yes' : 'Optional' },
    ))}
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      Open the Coordination Bridge link the inspector previously sent you and upload the file directly.
      Your bookmarked portal link remains valid.
    </p>
    <p style="margin:18px 0 0 0;color:#64748B;font-size:12px;line-height:1.6;">
      Documents you upload are SHA-256 hashed at upload time and become part of the cryptographic
      chain of custody for this inspection — auditors can verify them independently.
    </p>`;

  const html = shell({
    preheader: `${inspectorName} requested ${docTitle}.`,
    bannerLabel: 'New document requested',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '◉',
    innerHtml: inner,
  });

  const text =
`${vendorContact ? `Hi ${vendorContact},` : 'Hello,'}

${inspectorName} has requested ${docTitle}${required ? ' (REQUIRED)' : ''} from ${vendorCompany} for the ${jobTitle} inspection.

${docDescription ? docDescription + '\n\n' : ''}Open the Coordination Bridge link the inspector previously sent and upload the file there.

— NEXPEC`;

  return { subject, html, text };
}

function renderBridgeSchedulePropose(
  _row: NotificationRow,
  data: Record<string, unknown>,
  _appBaseUrl: string,
): RenderedEmail {
  const jobTitle = String(data.job_title ?? 'Inspection');
  const vendorCompany = String(data.vendor_company ?? 'your company');
  const payload = (data.slot_payload ?? {}) as Record<string, unknown>;
  const proposedAt = payload.proposed_at ? formatDate(String(payload.proposed_at)) : '—';
  const timezone = payload.timezone ? String(payload.timezone) : 'UTC';
  const notes = payload.notes ? String(payload.notes) : '';

  const subject = `Proposed inspection date: ${proposedAt}`;

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">Hello,</p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      The inspector has proposed a date for the <strong style="color:#F1F5F9;">${escapeHtml(jobTitle)}</strong> inspection at
      <strong style="color:#F1F5F9;">${escapeHtml(vendorCompany)}</strong>.
    </p>
    ${metaCard(metaRow(
      { label: 'Proposed date', value: proposedAt },
      { label: 'Timezone', value: timezone },
    ))}
    ${notes ? `<p style="margin:0 0 14px 0;color:#94A3B8;font-size:14px;line-height:1.7;"><em>"${escapeHtml(notes)}"</em></p>` : ''}
    <p style="margin:0;color:#94A3B8;font-size:14px;line-height:1.7;">
      Open your Coordination Bridge portal to accept this date or propose an alternative.
    </p>`;

  const html = shell({
    preheader: `Inspector proposed ${proposedAt}.`,
    bannerLabel: 'Inspection date proposed',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '◷',
    innerHtml: inner,
  });

  const text =
`Hello,

The inspector has proposed a date for the ${jobTitle} inspection at ${vendorCompany}.

Proposed date: ${proposedAt}
Timezone:      ${timezone}
${notes ? `\nNotes from inspector:\n${notes}\n` : ''}
Open your Coordination Bridge portal to accept or propose an alternative.

— NEXPEC`;

  return { subject, html, text };
}

function renderGeneric(row: NotificationRow, appBaseUrl: string): RenderedEmail {
  const link = row.link_href ? absoluteUrl(appBaseUrl, row.link_href) : appBaseUrl;
  const recipientName = row.recipient_name ?? row.recipient_email;
  const subject = row.title || 'A NEXPEC update';

  const inner = `
    <p style="margin:0 0 14px 0;color:#F1F5F9;font-size:16px;line-height:1.6;">
      Hi <strong>${escapeHtml(recipientName)}</strong>,
    </p>
    <p style="margin:0 0 8px 0;color:#94A3B8;font-size:14px;line-height:1.7;">
      ${escapeHtml(row.body ?? row.title ?? 'You have a new update on NEXPEC.')}
    </p>
    ${row.link_href ? ctaButton(link, 'Open in NEXPEC') : ''}`;

  const html = shell({
    preheader: row.body ?? row.title ?? 'New notification',
    bannerLabel: row.title || 'NEXPEC update',
    bannerColor: 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
    bannerIcon: '•',
    innerHtml: inner,
  });

  const text =
`Hi ${recipientName},

${row.body ?? row.title ?? 'You have a new update on NEXPEC.'}

${row.link_href ? `Open in NEXPEC: ${link}\n` : ''}
— NEXPEC`;

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function absoluteUrl(base: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${trimmedBase}${trimmedPath}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function humanRole(role: string): string {
  switch (role) {
    case 'owner':              return 'Owner';
    case 'procurement_admin':  return 'Procurement Admin';
    case 'department_manager': return 'Department Manager';
    case 'finance_lead':       return 'Finance Lead';
    case 'requester':          return 'Requester';
    case 'auditor':            return 'Auditor';
    case 'member':             return 'Member';
    default: return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
