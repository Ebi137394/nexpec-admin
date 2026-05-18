// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientBranding.types.ts — client report-branding configuration
//
//  Mirrors profiles.{company_logo_url, report_header_text, report_footer_text,
//  use_custom_branding}. primary_color from the mobile branding-settings is
//  intentionally NOT included until that column is confirmed to exist on
//  the live profiles schema.
// ════════════════════════════════════════════════════════════════════════════

export interface ClientBranding {
  /** Public URL from the branding_assets bucket. */
  companyLogoUrl: string | null;
  /** Top-of-report header text. */
  reportHeaderText: string | null;
  /** Bottom-of-report footer text (often legal disclaimer / contact). */
  reportFooterText: string | null;
  /** Master toggle — when false, reports use NEXPEC's default chrome. */
  useCustomBranding: boolean;
  /** Company name (read-only here — owned by /client/settings). */
  companyName: string | null;
}
