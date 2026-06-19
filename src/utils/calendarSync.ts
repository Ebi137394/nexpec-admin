import { Platform, Alert, Linking } from 'react-native';
import * as Calendar from 'expo-calendar';

const APP_CALENDAR_TITLE = 'NEXPEC Jobs';
const APP_CALENDAR_COLOR = '#7C3AED';
const LOG_PREFIX = '[CalendarSync]';

export interface CalendarJobEvent { jobId: string; title: string; description: string; location: string; startDate: Date; endDate: Date; notes?: string; inspectionType?: string; budget?: number; clientName?: string; }
export interface CalendarSyncResult { success: boolean; eventId: string | null; calendarId: string | null; error?: string; }
export interface CalendarUpdateResult { success: boolean; error?: string; }

export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Calendar.getCalendarPermissionsAsync();
    if (existingStatus === 'granted') return true;
    const { status: newStatus } = await Calendar.requestCalendarPermissionsAsync();
    if (newStatus === 'granted') return true;
    Alert.alert('Calendar Access Required', 'NEXPEC needs calendar access to sync your inspection schedules. Please enable it in Settings.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => { if (Platform.OS === 'ios') { Linking.openURL('app-settings:'); } else { Linking.openSettings(); } } }]);
    return false;
  } catch (error: any) { console.error(`${LOG_PREFIX} Permission request failed:`, error.message || error); return false; }
}

export async function getOrCreateCalendar(): Promise<string | null> {
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const existingNexpec = calendars.find(cal => cal.title === APP_CALENDAR_TITLE && cal.allowsModifications !== false);
    if (existingNexpec) return existingNexpec.id;
    const writableCalendars = calendars.filter(cal => cal.allowsModifications !== false);
    if (writableCalendars.length === 0) return await createNexpecCalendar();
    let bestCalendar: Calendar.Calendar | null = null;
    if (Platform.OS === 'ios') { bestCalendar = findBestIOSCalendar(writableCalendars); } else { bestCalendar = findBestAndroidCalendar(writableCalendars); }
    if (bestCalendar) return bestCalendar.id;
    return await createNexpecCalendar();
  } catch (error: any) { console.error(`${LOG_PREFIX} Calendar discovery failed:`, error.message || error); return null; }
}

function findBestIOSCalendar(calendars: Calendar.Calendar[]): Calendar.Calendar | null {
  const defaultCal = calendars.find(cal => cal.source?.type === (Calendar.SourceType as any).DEFAULT); if (defaultCal) return defaultCal;
  const iCloudCal = calendars.find(cal => cal.source?.type === Calendar.SourceType.CALDAV && (cal.source?.name?.toLowerCase().includes('icloud') || cal.source?.name?.toLowerCase().includes('cloud'))); if (iCloudCal) return iCloudCal;
  const caldavCal = calendars.find(cal => cal.source?.type === Calendar.SourceType.CALDAV); if (caldavCal) return caldavCal;
  const localCal = calendars.find(cal => cal.source?.type === Calendar.SourceType.LOCAL); if (localCal) return localCal;
  return calendars[0] || null;
}

function findBestAndroidCalendar(calendars: Calendar.Calendar[]): Calendar.Calendar | null {
  const primaryCal = calendars.find(cal => (cal as any).isPrimary === true); if (primaryCal) return primaryCal;
  const googleCal = calendars.find(cal => { const owner = ((cal as any).ownerAccount || '').toLowerCase(); const sourceName = (cal.source?.name || '').toLowerCase(); const sourceType = (cal.source?.type || '').toLowerCase(); return ( owner.includes('@gmail.com') || owner.includes('@google') || sourceName.includes('google') || sourceType.includes('com.google') ); }); if (googleCal) return googleCal;
  const accountCal = calendars.find(cal => { const owner = ((cal as any).ownerAccount || '').toLowerCase(); return owner.includes('@') && !owner.includes('phone') && !owner.includes('device'); }); if (accountCal) return accountCal;
  const localCal = calendars.find(cal => cal.source?.type === 'LOCAL' || cal.source?.type === Calendar.SourceType.LOCAL); if (localCal) return localCal;
  return calendars[0] || null;
}

async function createNexpecCalendar(): Promise<string | null> {
  try {
    let sourceId: string | undefined;
    if (Platform.OS === 'ios') {
      const sources = await Calendar.getSourcesAsync();
      const defaultSource = sources.find(s => s.type === (Calendar.SourceType as any).DEFAULT); const iCloudSource = sources.find(s => s.type === Calendar.SourceType.CALDAV && s.name?.toLowerCase().includes('icloud')); const localSource = sources.find(s => s.type === Calendar.SourceType.LOCAL);
      const selectedSource = defaultSource || iCloudSource || localSource || sources[0];
      if (!selectedSource) return null;
      sourceId = selectedSource.id;
    }
    const newCalendarId = await Calendar.createCalendarAsync({
      title: APP_CALENDAR_TITLE, color: APP_CALENDAR_COLOR, entityType: Calendar.EntityTypes.EVENT, accessLevel: Calendar.CalendarAccessLevel.OWNER, name: 'nexpec-jobs',
      ...(Platform.OS === 'ios' && sourceId ? { sourceId } : {}),
      ...(Platform.OS === 'android' ? { ownerAccount: 'NEXPEC', source: { isLocalAccount: true, name: 'NEXPEC', type: 'LOCAL' } } : {}),
    });
    return newCalendarId;
  } catch (error: any) {
    try { const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT); const anyWritable = calendars.find(cal => cal.allowsModifications !== false); if (anyWritable) return anyWritable.id; } catch (fallbackErr) {}
    return null;
  }
}

export async function addJobToCalendar(event: CalendarJobEvent): Promise<CalendarSyncResult> {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return { success: false, eventId: null, calendarId: null, error: 'Calendar permission denied' };
    const calendarId = await getOrCreateCalendar();
    if (!calendarId) return { success: false, eventId: null, calendarId: null, error: 'No writable calendar found on device' };
    const eventNotes = buildEventNotes(event);
    const eventDetails: Calendar.Event = { title: `🔍 ${event.title}`, startDate: event.startDate, endDate: event.endDate, location: event.location, notes: eventNotes, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, alarms: [{ relativeOffset: -60, method: Calendar.AlarmMethod.ALERT }, { relativeOffset: -15, method: Calendar.AlarmMethod.ALERT }], availability: Calendar.Availability.BUSY, status: Calendar.EventStatus.CONFIRMED } as any;
    const eventId = await Calendar.createEventAsync(calendarId, eventDetails);
    return { success: true, eventId, calendarId };
  } catch (error: any) { return { success: false, eventId: null, calendarId: null, error: error.message || 'Unknown calendar error' }; }
}

export async function updateJobCalendarEvent(eventId: string, updates: Partial<CalendarJobEvent>): Promise<CalendarUpdateResult> {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return { success: false, error: 'Calendar permission denied' };
    try { await Calendar.getEventAsync(eventId); } catch { return { success: false, error: 'Event no longer exists in calendar' }; }
    const updatePayload: Partial<Calendar.Event> = {};
    if (updates.title) updatePayload.title = `🔍 ${updates.title}`;
    if (updates.location) updatePayload.location = updates.location;
    if (updates.startDate) updatePayload.startDate = updates.startDate;
    if (updates.endDate) updatePayload.endDate = updates.endDate;
    if (updates.description || updates.notes) updatePayload.notes = updates.description || updates.notes;
    await Calendar.updateEventAsync(eventId, updatePayload as any);
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message || 'Failed to update event' }; }
}

export async function removeJobFromCalendar(eventId: string): Promise<CalendarUpdateResult> {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return { success: false, error: 'Calendar permission denied' };
    try { await Calendar.getEventAsync(eventId); } catch { return { success: true }; }
    await Calendar.deleteEventAsync(eventId);
    return { success: true };
  } catch (error: any) { if (error.message?.includes('not found') || error.message?.includes('does not exist')) return { success: true }; return { success: false, error: error.message || 'Failed to remove event' }; }
}

function buildEventNotes(event: CalendarJobEvent): string {
  const lines: string[] = ['━━━ NEXPEC Inspection ━━━', ''];
  if (event.description) { lines.push(event.description); lines.push(''); }
  if (event.inspectionType) lines.push(`📋 Type: ${event.inspectionType}`);
  if (event.location) lines.push(`📍 Location: ${event.location}`);
  if (event.budget) lines.push(`💰 Budget: $${event.budget.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  if (event.clientName) lines.push(`👤 Client: ${event.clientName}`);
  lines.push(''); lines.push(`🔑 Job ID: ${event.jobId}`);
  if (event.notes) { lines.push(''); lines.push('── Notes ──'); lines.push(event.notes); }
  lines.push(''); lines.push('Managed by NEXPEC • Do not edit manually');
  return lines.join('\n');
}

export async function doesCalendarEventExist(eventId: string): Promise<boolean> { try { const hasPermission = await requestCalendarPermissions(); if (!hasPermission) return false; await Calendar.getEventAsync(eventId); return true; } catch { return false; } }
export async function openNativeCalendar(): Promise<void> { try { if (Platform.OS === 'ios') { await Linking.openURL('calshow:'); } else { await Linking.openURL('content://com.android.calendar/time/'); } } catch { try { if (Platform.OS === 'android') { await Linking.sendIntent('android.intent.action.VIEW', [{ key: 'type', value: 'vnd.android.cursor.item/event' }]); } } catch (err) {} } }