// src/services/CalendarSync.ts

import * as Calendar from 'expo-calendar';
import { Platform, Alert } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InspectionJob {
  id: string;
  title: string;
  clientName: string;
  location: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  scheduledDate: Date;           // Start date/time
  estimatedDurationMinutes?: number; // Default 60
  notes?: string;
}

export interface CalendarSyncResult {
  success: boolean;
  eventId?: string;
  calendarId?: string;
  error?: string;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

const NEXPEC_CALENDAR_TITLE = 'NEXPEC Inspections';

/**
 * Request calendar read/write permissions.
 * Returns true if granted.
 */
async function ensureCalendarPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Calendar.getCalendarPermissionsAsync();

  if (existingStatus === 'granted') return true;

  const { status: newStatus } = await Calendar.requestCalendarPermissionsAsync();

  if (newStatus !== 'granted') {
    Alert.alert(
      'Calendar Permission Required',
      'NEXPEC needs calendar access to sync your inspection schedule. ' +
        'Please enable it in your device Settings.',
      [{ text: 'OK' }]
    );
    return false;
  }

  return true;
}

/**
 * Find or create the dedicated NEXPEC calendar so we don't pollute
 * the user's personal calendar.
 */
async function getOrCreateNexpecCalendar(): Promise<string> {
  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes.EVENT
  );

  // Look for existing NEXPEC calendar
  const existing = calendars.find(
    (cal) => cal.title === NEXPEC_CALENDAR_TITLE && cal.allowsModifications
  );

  if (existing) return existing.id;

  // ── Create new calendar ────────────────────────────────────────────────

  if (Platform.OS === 'ios') {
    // On iOS, find the default iCloud or local source
    const defaultCalendarSource =
      calendars.find((cal) => cal.source?.name === 'iCloud')?.source ??
      calendars.find((cal) => cal.source?.type === Calendar.CalendarType.LOCAL)
        ?.source;

    if (!defaultCalendarSource) {
      throw new Error('No suitable calendar source found on iOS.');
    }

    const newCalendarId = await Calendar.createCalendarAsync({
      title: NEXPEC_CALENDAR_TITLE,
      color: '#3B82F6',
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultCalendarSource.id,
      source: defaultCalendarSource,
      name: 'nexpec-inspections',
      ownerAccount: 'personal',
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });

    return newCalendarId;
  }

  // Android
  const defaultCalendar = calendars.find(
    (cal) => cal.accessLevel === Calendar.CalendarAccessLevel.OWNER
  );

  const newCalendarId = await Calendar.createCalendarAsync({
    title: NEXPEC_CALENDAR_TITLE,
    color: '#3B82F6',
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: defaultCalendar?.source?.id,
    source: {
      isLocalAccount: true,
      name: NEXPEC_CALENDAR_TITLE,
      type: Calendar.CalendarType.LOCAL,
    },
    name: 'nexpec-inspections',
    ownerAccount: 'nexpec',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  return newCalendarId;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sync an inspection job to the device's native calendar.
 *
 * @example
 * ```ts
 * import { syncJobToCalendar } from ''services/CalendarSync'' (see below for file content);
 *
 * const result = await syncJobToCalendar({
 *   id: 'INS-2024-001',
 *   title: 'Pipeline Coating Inspection',
 *   clientName: 'Saudi Aramco',
 *   location: 'Ras Tanura Terminal',
 *   scheduledDate: new Date('2024-12-15T09:00:00'),
 *   estimatedDurationMinutes: 120,
 *   notes: 'Bring thickness gauge. PPE required.',
 * });
 * ```
 */
export async function syncJobToCalendar(
  job: InspectionJob
): Promise<CalendarSyncResult> {
  try {
    // ── 1. Permissions ─────────────────────────────────────────────────
    const hasPermission = await ensureCalendarPermissions();
    if (!hasPermission) {
      return { success: false, error: 'Calendar permission denied.' };
    }

    // ── 2. Calendar ────────────────────────────────────────────────────
    const calendarId = await getOrCreateNexpecCalendar();

    // ── 3. Build event details ─────────────────────────────────────────
    const durationMs = (job.estimatedDurationMinutes ?? 60) * 60 * 1000;
    const startDate = new Date(job.scheduledDate);
    const endDate = new Date(startDate.getTime() + durationMs);

    const locationString = job.address
      ? `${job.location}, ${job.address}`
      : job.location;

    const notesLines = [
      `📋 Job ID: ${job.id}`,
      `🏢 Client: ${job.clientName}`,
      `📍 Site: ${job.location}`,
    ];

    if (job.latitude && job.longitude) {
      notesLines.push(
        `🗺 Maps: https://www.google.com/maps?q=${job.latitude},${job.longitude}`
      );
    }

    if (job.notes) {
      notesLines.push(`\n📝 Notes:\n${job.notes}`);
    }

    notesLines.push('\n— Synced from NEXPEC App');

    // ── 4. Create event ────────────────────────────────────────────────
    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `🔍 ${job.title}`,
      location: locationString,
      notes: notesLines.join('\n'),
      startDate,
      endDate,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      alarms: [
        { relativeOffset: -60 },  // 1 hour before
        { relativeOffset: -15 },  // 15 minutes before
      ],
    });

    Alert.alert(
      '✅ Calendar Synced',
      `"${job.title}" has been added to your calendar on ${startDate.toLocaleDateString()}.`,
      [{ text: 'Great' }]
    );

    return {
      success: true,
      eventId,
      calendarId,
    };
  } catch (error: any) {
    console.error('[CalendarSync] Error:', error);

    const message =
      error.message || 'An unexpected error occurred while syncing.';

    Alert.alert('Calendar Sync Failed', message, [{ text: 'OK' }]);

    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Remove a previously synced event by its event ID.
 */
export async function removeJobFromCalendar(eventId: string): Promise<boolean> {
  try {
    const hasPermission = await ensureCalendarPermissions();
    if (!hasPermission) return false;

    await Calendar.deleteEventAsync(eventId);
    return true;
  } catch (error: any) {
    console.error('[CalendarSync] Delete error:', error);
    return false;
  }
}

/**
 * Check if the job is already synced (useful for toggle UI).
 */
export async function isJobSynced(eventId: string): Promise<boolean> {
  try {
    const hasPermission = await ensureCalendarPermissions();
    if (!hasPermission) return false;

    const event = await Calendar.getEventAsync(eventId);
    return !!event;
  } catch {
    return false;
  }
}