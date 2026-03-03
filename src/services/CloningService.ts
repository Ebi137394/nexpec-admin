/**
 * CloningService — Smart Report Cloning Engine
 *
 * Duplicates an existing InspectionDraft while sanitizing unique/sensitive
 * data to prevent accidental re-submission of photos, signatures, or
 * serial numbers from the source record.
 *
 * Works entirely with SQLite (offline-first).
 */

import * as SQLite from 'expo-sqlite';

// ─── Types ───────────────────────────────────────────────────────────

/** Shape of a draft row in the `inspection_drafts` table. */
interface InspectionDraft {
  id: string;
  jobId: string;
  status: string; // 'draft' | 'in_progress' | 'completed' | 'synced'
  formData: string; // JSON stringified form data
  createdAt: string;
  updatedAt: string;
  syncedAt: string | null;
  inspectorId: string;
  equipmentType: string;
  location: string;
}

/** Parsed form data within a draft. */
interface FormData {
  // Copyable fields (safe to clone)
  equipmentType?: string;
  equipmentModel?: string;
  manufacturer?: string;
  material?: string;
  nominalDiameter?: string;
  wallThickness?: string;
  operatingTemperature?: string;
  operatingPressure?: string;
  designCode?: string;
  inspectionStandard?: string;
  inspectionMethod?: string;
  acceptanceCriteria?: string;
  surfaceCondition?: string;
  coatingType?: string;
  serviceType?: string;
  processFluid?: string;
  environmentalConditions?: string;
  accessMethod?: string;
  scaffoldingRequired?: boolean;
  insulationRemoval?: boolean;
  previousFindings?: string;
  riskLevel?: string;
  notes?: string;

  // Custom / dynamic fields
  customFields?: Record<string, any>;

  // ── FIELDS THAT MUST BE STRIPPED (unique per inspection) ──
  serialNumber?: string;
  assetTag?: string;
  equipmentId?: string;
  photos?: any[];
  photoAnnotations?: any[];
  signature?: string;
  signatureData?: string;
  jsaSignature?: string;
  jsaChecklist?: any[];
  gpsCoordinates?: any;
  readings?: any[];       // Actual measurement readings
  defectsFound?: any[];
  timestamps?: any;
  submittedBy?: string;
  reviewedBy?: string;
  approvalStatus?: string;
  reportNumber?: string;
  certificateNumber?: string;
}

/** Fields that are unique per inspection and must be stripped during cloning */
const SANITIZE_FIELDS: (keyof FormData)[] = [
  'serialNumber',
  'assetTag',
  'equipmentId',
  'photos',
  'photoAnnotations',
  'signature',
  'signatureData',
  'jsaSignature',
  'jsaChecklist',
  'gpsCoordinates',
  'readings',
  'defectsFound',
  'timestamps',
  'submittedBy',
  'reviewedBy',
  'approvalStatus',
  'reportNumber',
  'certificateNumber',
];

/** Result returned after a successful clone */
interface CloneResult {
  success: true;
  newDraftId: string;
  sourceId: string;
  fieldsCopied: string[];
  fieldsStripped: string[];
  message: string;
}

interface CloneError {
  success: false;
  error: string;
  code: 'SOURCE_NOT_FOUND' | 'PARSE_ERROR' | 'DB_ERROR' | 'VALIDATION_ERROR';
}

type CloneOutcome = CloneResult | CloneError;

// ─── Utility Functions ───────────────────────────────────────────────

/** Generate a unique draft ID */
const generateDraftId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `draft_clone_${timestamp}_${randomPart}`;
};

/** Deep clone an object safely */
const deepClone = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
};

/** Get current ISO timestamp */
const nowISO = (): string => new Date().toISOString();

/** Safely parse JSON with error handling */
const safeJsonParse = (str: string): { data: any; error: string | null } => {
  try {
    const data = JSON.parse(str);
    return { data, error: null };
  } catch (e: any) {
    return { data: null, error: e.message || 'Invalid JSON' };
  }
};

// ─── Database Initialization ─────────────────────────────────────────

const DB_NAME = 'nexpec_inspector.db';

const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  return db;
};

/** Ensure the drafts table exists (idempotent) */
const ensureTable = async (db: SQLite.SQLiteDatabase): Promise<void> => {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS inspection_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      jobId TEXT,
      status TEXT DEFAULT 'draft',
      formData TEXT DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      syncedAt TEXT,
      inspectorId TEXT,
      equipmentType TEXT,
      location TEXT,
      clonedFrom TEXT,
      cloneGeneration INTEGER DEFAULT 0
    );
  `);
};

// ─── Core Cloning Logic ──────────────────────────────────────────────

/**
 * Sanitize form data by stripping unique fields.
 * Returns the cleaned data and a list of what was stripped.
 */
const sanitizeFormData = (
  formData: FormData
): { sanitized: FormData; strippedFields: string[]; copiedFields: string[] } => {
  const sanitized = deepClone(formData);
  const strippedFields: string[] = [];
  const copiedFields: string[] = [];

  // Strip unique fields
  for (const field of SANITIZE_FIELDS) {
    if (sanitized[field] !== undefined && sanitized[field] !== null) {
      strippedFields.push(field);
      delete sanitized[field];
    }
  }

  // Also sanitize nested custom fields
  if (sanitized.customFields) {
    const customKeys = Object.keys(sanitized.customFields);
    for (const key of customKeys) {
      const lowerKey = key.toLowerCase();
      const isSensitive =
        lowerKey.includes('serial') ||
        lowerKey.includes('photo') ||
        lowerKey.includes('image') ||
        lowerKey.includes('signature') ||
        lowerKey.includes('certificate') ||
        lowerKey.includes('gps') ||
        lowerKey.includes('coordinate');

      if (isSensitive) {
        strippedFields.push(`customFields.${key}`);
        delete sanitized.customFields[key];
      }
    }
  }

  // Track copied fields
  for (const [key, value] of Object.entries(sanitized)) {
    if (value !== undefined && value !== null && value !== '') {
      copiedFields.push(key);
    }
  }

  return { sanitized, strippedFields, copiedFields };
};

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Clone an existing inspection draft.
 *
 * @param sourceDraftId - The ID of the draft to clone
 * @param overrides - Optional field overrides for the new draft
 * @returns CloneOutcome with new draft ID or error details
 *
 * @example
 * ```ts
 * const result = await CloningService.cloneDraft('draft_abc123', {
 *   location: 'Pipe Section B-42',
 * });
 * if (result.success) {
 *   navigation.navigate('InspectionForm', { draftId: result.newDraftId });
 * }
 * ```
 */
const cloneDraft = async (
  sourceDraftId: string,
  overrides?: Partial<{ location: string; jobId: string; inspectorId: string; equipmentType: string }>
): Promise<CloneOutcome> => {
  let db: SQLite.SQLiteDatabase;

  try {
    db = await getDatabase();
    await ensureTable(db);
  } catch (e: any) {
    return {
      success: false,
      error: `Database initialization failed: ${e.message}`,
      code: 'DB_ERROR',
    };
  }

  try {
    // 1. Fetch source draft
    const source = await db.getFirstAsync<InspectionDraft>(
      'SELECT * FROM inspection_drafts WHERE id = ?',
      [sourceDraftId]
    );

    if (!source) {
      return {
        success: false,
        error: `Source draft "${sourceDraftId}" not found in database.`,
        code: 'SOURCE_NOT_FOUND',
      };
    }

    // 2. Parse form data
    const { data: formData, error: parseError } = safeJsonParse(source.formData || '{}');
    if (parseError) {
      return {
        success: false,
        error: `Failed to parse source form data: ${parseError}`,
        code: 'PARSE_ERROR',
      };
    }

    // 3. Sanitize
    const { sanitized, strippedFields, copiedFields } = sanitizeFormData(formData);

    // 4. Generate new draft
    const newDraftId = generateDraftId();
    const now = nowISO();

    // 5. Determine clone generation (for tracking clone chains)
    const sourceGeneration = await db.getFirstAsync<{ cloneGeneration: number }>(
      'SELECT cloneGeneration FROM inspection_drafts WHERE id = ?',
      [sourceDraftId]
    );
    const newGeneration = ((sourceGeneration?.cloneGeneration) || 0) + 1;

    // 6. Insert new draft
    const newFormDataJson = JSON.stringify(sanitized);

    await db.runAsync(
      `INSERT INTO inspection_drafts 
        (id, jobId, status, formData, createdAt, updatedAt, syncedAt, inspectorId, equipmentType, location, clonedFrom, cloneGeneration)
       VALUES (?, ?, 'draft', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        newDraftId,
        overrides?.jobId || source.jobId || '',
        newFormDataJson,
        now,
        now,
        overrides?.inspectorId || source.inspectorId || '',
        overrides?.equipmentType || source.equipmentType || '',
        overrides?.location || source.location || '',
        sourceDraftId,
        newGeneration,
      ]
    );

    // 7. Verify insertion
    const verification = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM inspection_drafts WHERE id = ?',
      [newDraftId]
    );

    if (!verification) {
      return {
        success: false,
        error: 'Draft was not persisted. Database write may have failed silently.',
        code: 'DB_ERROR',
      };
    }

    return {
      success: true,
      newDraftId,
      sourceId: sourceDraftId,
      fieldsCopied: copiedFields,
      fieldsStripped: strippedFields,
      message: `Successfully cloned. ${copiedFields.length} fields copied, ${strippedFields.length} sensitive fields stripped.`,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Cloning failed: ${e.message}`,
      code: 'DB_ERROR',
    };
  }
};

/**
 * Get clone history for a draft (trace back through the clone chain).
 */
const getCloneHistory = async (
  draftId: string
): Promise<{ chain: string[]; error?: string }> => {
  try {
    const db = await getDatabase();
    await ensureTable(db);

    const chain: string[] = [draftId];
    let currentId: string | null = draftId;
    let depth = 0;
    const MAX_DEPTH = 50; // Prevent infinite loops

    while (currentId && depth < MAX_DEPTH) {
      const row: { clonedFrom: string | null } | null = await db.getFirstAsync(
        'SELECT clonedFrom FROM inspection_drafts WHERE id = ?',
        [currentId]
      );

      if (row?.clonedFrom) {
        chain.push(row.clonedFrom);
        currentId = row.clonedFrom;
      } else {
        currentId = null;
      }
      depth++;
    }

    return { chain: chain.reverse() }; // Oldest → newest
  } catch (e: any) {
    return { chain: [draftId], error: e.message };
  }
};

/**
 * Get all drafts that were cloned from a specific source.
 */
const getCloneChildren = async (
  sourceDraftId: string
): Promise<{ children: InspectionDraft[]; error?: string }> => {
  try {
    const db = await getDatabase();
    await ensureTable(db);

    const children = await db.getAllAsync<InspectionDraft>(
      'SELECT * FROM inspection_drafts WHERE clonedFrom = ? ORDER BY createdAt DESC',
      [sourceDraftId]
    );

    return { children: children || [] };
  } catch (e: any) {
    return { children: [], error: e.message };
  }
};

/**
 * Preview what a clone operation would do without actually performing it.
 * Useful for showing the user what fields will be copied vs. stripped.
 */
const previewClone = async (
  sourceDraftId: string
): Promise<{
  canClone: boolean;
  fieldsToCopy: string[];
  fieldsToStrip: string[];
  error?: string;
}> => {
  try {
    const db = await getDatabase();
    await ensureTable(db);

    const source = await db.getFirstAsync<InspectionDraft>(
      'SELECT formData FROM inspection_drafts WHERE id = ?',
      [sourceDraftId]
    );

    if (!source) {
      return {
        canClone: false,
        fieldsToCopy: [],
        fieldsToStrip: [],
        error: 'Source draft not found.',
      };
    }

    const { data: formData, error: parseError } = safeJsonParse(source.formData || '{}');
    if (parseError) {
      return {
        canClone: false,
        fieldsToCopy: [],
        fieldsToStrip: [],
        error: `Invalid form data: ${parseError}`,
      };
    }

    const { strippedFields, copiedFields } = sanitizeFormData(formData);

    return {
      canClone: true,
      fieldsToCopy: copiedFields,
      fieldsToStrip: strippedFields,
    };
  } catch (e: any) {
    return {
      canClone: false,
      fieldsToCopy: [],
      fieldsToStrip: [],
      error: e.message,
    };
  }
};

// ─── Export ──────────────────────────────────────────────────────────

const CloningService = {
  cloneDraft,
  getCloneHistory,
  getCloneChildren,
  previewClone,
  // Exposed for testing
  _sanitizeFormData: sanitizeFormData,
  _SANITIZE_FIELDS: SANITIZE_FIELDS,
};

export default CloningService;
export type { CloneResult, CloneError, CloneOutcome, InspectionDraft, FormData };