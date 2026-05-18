import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';
import type { InspectionReport, BrandingConfig, PDFGenerationResult } from '../types/report';

const DEFAULT_PRIMARY = '#7C3AED';
const FALLBACK_LOGO = `<div style="display:flex;align-items:center;gap:10px;"><div style="width:40px;height:40px;background:linear-gradient(135deg,#7C3AED,#9F67FF);border-radius:10px;display:flex;align-items:center;justify-content:center;"><span style="color:#FFF;font-size:18px;font-weight:900;">N</span></div><div><div style="font-size:22px;font-weight:800;color:#0F172A;letter-spacing:2px;">NEXPEC</div><div style="font-size:9px;color:#94A3B8;letter-spacing:1px;text-transform:uppercase;">Field Inspection Platform</div></div></div>`;

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: 'LOW', color: '#059669', bg: '#ECFDF5' }, 
  medium: { label: 'MEDIUM', color: '#D97706', bg: '#FFFBEB' },
  high: { label: 'HIGH', color: '#DC2626', bg: '#FEF2F2' }, 
  critical: { label: 'CRITICAL', color: '#991B1B', bg: '#FEE2E2' },
};

function formatDate(dateStr: string): string { 
  try { 
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); 
  } catch { 
    return dateStr || 'N/A'; 
  } 
}

function formatDateTime(dateStr: string): string { 
  try { 
    return new Date(dateStr).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); 
  } catch { 
    return dateStr || 'N/A'; 
  } 
}

function sanitize(text: string | null | undefined): string { 
  if (!text) return ''; 
  return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/\n/g, '<br/>'); 
}

function buildLogoSection(branding: BrandingConfig | null): string {
  if (branding?.use_custom_branding && branding.company_logo_url && branding.company_logo_url.startsWith('http')) {
    return `<div class="logo-section"><img src="${branding.company_logo_url}" style="max-height:55px;max-width:220px;object-fit:contain;" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" /><div style="display:none;font-size:18px;font-weight:700;color:#0F172A;">${sanitize(branding.company_name || branding.report_header_text || 'Company Report')}</div></div>`;
  }
  return `<div class="logo-section">${FALLBACK_LOGO}</div>`;
}

function buildSeverityBadge(severity: string | undefined): string {
  if (!severity) return '';
  const config = SEVERITY_CONFIG[severity.toLowerCase()] || SEVERITY_CONFIG.low;
  return `<span class="severity-badge" style="background:${config.bg};color:${config.color};border:1px solid ${config.color}22;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:1px;">${config.label} SEVERITY</span>`;
}

function buildPhotosSection(urls: string[]): string {
  if (!urls || urls.length === 0) return '';
  const photoCards = urls.filter((url) => url && url.startsWith('http')).map((url, idx) => `<div class="photo-card"><img src="${url}" class="photo-img" onerror="this.parentElement.style.display='none';" /><div class="photo-label">Evidence #${idx + 1}</div></div>`).join('');
  if (!photoCards) return '';
  return `<div class="section"><div class="section-title"><span class="section-icon">📸</span>Evidence Photos (${urls.length})</div><div class="photo-grid">${photoCards}</div></div>`;
}

function buildSignatureSection(report: InspectionReport): string {
  const inspectorName = [report.inspector_first_name, report.inspector_last_name].filter(Boolean).join(' ') || 'Inspector';
  return `<div class="signature-section"><div class="sig-grid"><div class="sig-block"><div class="sig-label">Inspector Digital Signature</div><div class="sig-area">${report.signature ? `<img src="${report.signature}" class="sig-img" onerror="this.outerHTML='<em style=color:#CBD5E1>Signature image unavailable</em>'" />` : '<em style="color:#CBD5E1;">No signature captured</em>'}</div><div class="sig-name">${sanitize(inspectorName)}</div><div class="sig-date">${formatDateTime(report.submitted_at)}</div></div><div class="sig-block"><div class="sig-label">Client Acknowledgment</div><div class="sig-area"><em style="color:#CBD5E1;">Pending review</em></div><div class="sig-line"></div><div class="sig-date">Date: _______________</div></div></div></div>`;
}

function buildHTMLDocument(report: InspectionReport, branding: BrandingConfig | null): string {
  const isCustom = branding?.use_custom_branding === true;
  const primaryColor = branding?.primary_color || DEFAULT_PRIMARY;
  const headerText = isCustom ? sanitize(branding?.report_header_text) || '' : 'Official Inspection Report';
  const footerText = isCustom ? sanitize(branding?.report_footer_text) || '' : 'Generated via NEXPEC — Field Inspection Platform';
  const reportId = report.id?.substring(0, 8)?.toUpperCase() || 'N/A';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Inspection Report - ${sanitize(report.job_title)}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1E293B; font-size: 12px; line-height: 1.5; padding: 0; }
        @page { size: A4; margin: 15mm 15mm 25mm 15mm; }
        .page-wrapper { padding: 0 5mm; }
        .report-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; margin-bottom: 24px; border-bottom: 3px solid ${primaryColor}; }
        .logo-section { flex-shrink: 0; }
        .header-right { text-align: right; }
        .report-title { font-size: 20px; font-weight: 800; color: #0F172A; letter-spacing: 0.5px; }
        .report-subtitle { font-size: 11px; color: #64748B; margin-top: 2px; }
        .report-meta { font-size: 10px; color: #94A3B8; margin-top: 6px; }
        .report-meta span { display: block; }
        .info-banner { display: flex; gap: 0; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; margin-bottom: 24px; }
        .info-cell { flex: 1; padding: 12px 16px; border-right: 1px solid #E2E8F0; }
        .info-cell:last-child { border-right: none; }
        .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #94A3B8; font-weight: 600; margin-bottom: 4px; }
        .info-value { font-size: 13px; font-weight: 700; color: #0F172A; }
        .section { margin-bottom: 22px; page-break-inside: avoid; }
        .section-title { font-size: 13px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 10px; padding-left: 14px; border-left: 4px solid ${primaryColor}; display: flex; align-items: center; gap: 6px; }
        .section-icon { font-size: 14px; }
        .content-box { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 16px 18px; border-radius: 8px; font-size: 12px; line-height: 1.7; color: #334155; }
        .photo-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .photo-card { width: calc(33.333% - 7px); border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background: #FFF; }
        .photo-img { width: 100%; height: 140px; object-fit: cover; display: block; }
        .photo-label { padding: 6px 8px; font-size: 9px; color: #94A3B8; text-align: center; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .signature-section { margin-top: 30px; padding-top: 20px; border-top: 2px solid #E2E8F0; page-break-inside: avoid; }
        .sig-grid { display: flex; gap: 30px; }
        .sig-block { flex: 1; }
        .sig-label { font-size: 10px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
        .sig-area { min-height: 60px; border: 1px dashed #CBD5E1; border-radius: 8px; padding: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; background: #FAFBFC; }
        .sig-img { max-width: 180px; max-height: 50px; object-fit: contain; }
        .sig-name { font-size: 12px; font-weight: 700; color: #0F172A; }
        .sig-date { font-size: 10px; color: #94A3B8; margin-top: 2px; }
        .sig-line { border-bottom: 1px solid #CBD5E1; margin-bottom: 8px; height: 30px; }
        .severity-badge { display: inline-block; vertical-align: middle; }
        .report-footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 20mm; text-align: center; font-size: 9px; color: #94A3B8; border-top: 1px solid #F1F5F9; background: #FFFFFF; }
        .footer-line { display: flex; justify-content: space-between; align-items: center; }
        .watermark { position: fixed; bottom: 30mm; right: 10mm; font-size: 60px; font-weight: 900; color: rgba(124, 58, 237, 0.03); transform: rotate(-30deg); letter-spacing: 8px; pointer-events: none; z-index: -1; }
      </style>
    </head>
    <body>
      ${!isCustom ? '<div class="watermark">NEXPEC</div>' : ''}
      <div class="page-wrapper">
        <div class="report-header">
          ${buildLogoSection(branding)}
          <div class="header-right">
            <div class="report-title">INSPECTION REPORT</div>
            <div class="report-subtitle">${headerText}</div>
            <div class="report-meta"><span>Report ID: #${reportId}</span><span>Generated: ${formatDateTime(new Date().toISOString())}</span></div>
          </div>
        </div>
        <div class="info-banner">
          <div class="info-cell"><div class="info-label">Project Title</div><div class="info-value">${sanitize(report.job_title)}</div></div>
          <div class="info-cell"><div class="info-label">Site Location</div><div class="info-value">${sanitize(report.job_location) || 'On-site GPS'}</div></div>
          <div class="info-cell"><div class="info-label">Submitted</div><div class="info-value">${formatDate(report.submitted_at)}</div></div>
          <div class="info-cell"><div class="info-label">Status</div><div class="info-value">${sanitize(report.status)} ${buildSeverityBadge(report.severity)}</div></div>
        </div>
        <div class="section"><div class="section-title"><span class="section-icon">📋</span>Findings Summary</div><div class="content-box">${sanitize(report.summary) || '<em style="color:#CBD5E1;">No summary provided.</em>'}</div></div>
        ${report.findings ? `<div class="section"><div class="section-title"><span class="section-icon">🔍</span>Detailed Findings</div><div class="content-box">${sanitize(report.findings)}</div></div>` : ''}
        ${report.recommendations ? `<div class="section"><div class="section-title"><span class="section-icon">💡</span>Recommendations</div><div class="content-box">${sanitize(report.recommendations)}</div></div>` : ''}
        ${buildPhotosSection(report.photos_urls)}
        ${buildSignatureSection(report)}
      </div>
      <div class="report-footer"><div class="footer-line"><span>${footerText}</span><span>Report #${reportId} • ${formatDate(report.submitted_at)}</span></div></div>
    </body>
    </html>
  `;
}

export async function generatePDFFile(report: InspectionReport, branding: BrandingConfig | null): Promise<PDFGenerationResult> {
  try {
    if (!report || !report.id) return { success: false, error: 'Invalid report data provided.' };
    if (!report.summary && !report.findings) return { success: false, error: 'Report has no content.' };
    const html = buildHTMLDocument(report, branding);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    return { success: true, uri };
  } catch (error: any) { 
    return { success: false, error: error.message || 'Failed to generate PDF file.' }; 
  }
}

export async function generateAndSharePDF(report: InspectionReport, branding: BrandingConfig | null): Promise<PDFGenerationResult> {
  try {
    const result = await generatePDFFile(report, branding);
    if (!result.success || !result.uri) { 
      Alert.alert('PDF Generation Failed', result.error || 'Could not create the PDF.'); 
      return result; 
    }
    const sharingAvailable = await Sharing.isAvailableAsync();
    if (!sharingAvailable) { 
      Alert.alert('Sharing Unavailable', 'Sharing is not available. PDF saved locally.', [{ text: 'OK' }]); 
      return { ...result, shared: false }; 
    }
    await Sharing.shareAsync(result.uri, { 
      UTI: 'com.adobe.pdf', 
      mimeType: 'application/pdf', 
      dialogTitle: `Inspection Report - ${report.job_title}` 
    });
    return { ...result, shared: true };
  } catch (error: any) {
    if (error.message?.includes('cancel') || error.message?.includes('dismiss')) return { success: true, shared: false };
    Alert.alert('Export Error', error.message || 'Something went wrong.'); 
    return { success: false, error: error.message };
  }
}

export async function generateAndPrintPDF(report: InspectionReport, branding: BrandingConfig | null): Promise<PDFGenerationResult> {
  try {
    if (!report || !report.id) return { success: false, error: 'Invalid report data.' };
    const html = buildHTMLDocument(report, branding);
    await Print.printAsync({ html });
    return { success: true };
  } catch (error: any) {
    if (error.message?.includes('cancel')) return { success: true, shared: false };
    return { success: false, error: error.message };
  }
}