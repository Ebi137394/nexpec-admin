// lib/storageHelpers.ts

/**
 * Construct public URL manually
 * 
 * @param projectRef - Your Supabase project reference (e.g., 'sxqpjxhslzzcdrdctatm')
 * @param bucketName - The storage bucket name (e.g., 'report-images')
 * @param filePath - The file path within the bucket (e.g., 'reports/user123_1234567890_abc123.png')
 * @returns The complete public URL for the file
 * 
 * @example
 * ```typescript
 * const url = constructPublicUrl(
 *   'sxqpjxhslzzcdrdctatm',
 *   'report-images',
 *   'reports/user123_1234567890_abc123.png'
 * );
 * // Returns: https://sxqpjxhslzzcdrdctatm.supabase.co/storage/v1/object/public/report-images/reports/user123_1234567890_abc123.png
 * ```
 */
export function constructPublicUrl(
  projectRef: string,
  bucketName: string,
  filePath: string
): string {
  // Format: https://[PROJECT_REF].supabase.co/storage/v1/object/public/[BUCKET]/[PATH]
  return `https://${projectRef}.supabase.co/storage/v1/object/public/${bucketName}/${filePath}`;
}
