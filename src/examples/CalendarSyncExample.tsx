// ═══════════════════════════════════════════════════════════
// src/examples/CalendarSyncExample.tsx — Calendar Sync Integration Example
// Cross-Platform · Bulletproof · Production-Ready
// ═══════════════════════════════════════════════════════════

import React, { useCallback } from 'react';
import { Alert, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import {
  addJobToCalendar,
  removeJobFromCalendar,
  updateJobCalendarEvent,
  type CalendarJobEvent,
} from '../utils/calendarSync';

// ── Mock Job Data ──────────────────────────────────────────────
const mockJob = {
  id: 'job-123',
  title: 'Roof Inspection',
  description: 'Inspect roof for water damage and structural issues',
  address: '123 Main St, Toronto, ON',
  city: 'Toronto',
  state: 'ON',
  scheduled_date: new Date(Date.now() + 86400000), // Tomorrow
  inspection_type: 'Roof Inspection',
  budget: 500,
  notes: 'Client prefers morning appointment',
  profiles: {
    full_name: 'John Smith',
  },
};

// ── Integration Example Component ───────────────────────────────
export function CalendarSyncExample() {
  const { user } = useAuth();

  // ── Accept Job with Calendar Sync ────────────────────────────
  const handleAcceptJob = useCallback(async () => {
    if (!user?.id) {
      Alert.alert('Error', 'You must be logged in to accept jobs.');
      return;
    }

    Alert.alert(
      'Accept Job',
      `Accept "${mockJob.title}" and add it to your calendar?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept & Sync',
          onPress: async () => {
            try {
              // ── Step 1: Update job in your database (example) ──────
              // Replace this with your actual database update logic
              console.log('Updating job status to assigned...');
              
              // ── Step 2: Sync to native calendar ─────
              const scheduledStart = mockJob.scheduled_date
                ? new Date(mockJob.scheduled_date)
                : new Date(Date.now() + 86400000); // Tomorrow if no date

              const scheduledEnd = new Date(
                scheduledStart.getTime() + 2 * 60 * 60 * 1000, // 2 hours default
              );

              const calendarEvent: CalendarJobEvent = {
                jobId: mockJob.id,
                title: mockJob.title || 'Inspection',
                description:
                  mockJob.description || 'Scheduled inspection via NEXPEC',
                location:
                  mockJob.address ||
                  [mockJob.city, mockJob.state].filter(Boolean).join(', ') ||
                  'Location TBD',
                startDate: scheduledStart,
                endDate: scheduledEnd,
                inspectionType: mockJob.inspection_type,
                budget: mockJob.budget,
                clientName:
                  mockJob.profiles?.full_name || 'Client',
                notes: mockJob.notes,
              };

              const calendarResult = await addJobToCalendar(calendarEvent);

              // ── Step 3: Store eventId in your database (example) ───
              // Replace this with your actual database update logic
              if (calendarResult.success && calendarResult.eventId) {
                console.log('Calendar event created with ID:', calendarResult.eventId);
                console.log('Storing calendar_event_id in database...');
                
                Alert.alert(
                  '✅ Job Accepted!',
                  'The inspection has been added to your calendar with reminders at 1 hour and 15 minutes before.',
                );
              } else {
                // Job was accepted but calendar sync failed — not fatal
                Alert.alert(
                  'Job Accepted',
                  `Job accepted successfully!\n\n⚠️ Calendar sync skipped: ${calendarResult.error || 'Unknown reason'}`,
                );
              }

              // Refresh job lists (you would call your actual refresh functions here)
              // await fetchDiscoverJobs?.();
              // await fetchMyJobs?.();
            } catch (err: any) {
              Alert.alert(
                'Error',
                err.message || 'Failed to accept job.',
              );
            }
          },
        },
      ],
    );
  }, [user?.id]);

  // ── Cancel/Complete a job — remove from calendar ──────
  const handleCancelJob = useCallback(async () => {
    try {
      // Remove from calendar if synced (you would get this from your job data)
      const calendarEventId = 'event-123'; // This would come from your job record
      
      if (calendarEventId) {
        await removeJobFromCalendar(calendarEventId);
      }

      // Update database (example)
      // Replace this with your actual database update logic
      console.log('Updating job status to cancelled...');
      console.log('Setting calendar_event_id to null...');

      Alert.alert('Job Cancelled', 'The calendar event has been removed.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to cancel job.');
    }
  }, []);

  // ── Reschedule a job — update calendar ────────────────
  const handleReschedule = useCallback(async () => {
    try {
      const newStartDate = new Date(Date.now() + 2 * 86400000); // Day after tomorrow
      const newEndDate = new Date(
        newStartDate.getTime() + 2 * 60 * 60 * 1000,
      );

      // Update database (example)
      // Replace this with your actual database update logic
      console.log('Updating scheduled_date to:', newStartDate.toISOString());

      // Update calendar if synced (you would get this from your job data)
      const calendarEventId = 'event-123'; // This would come from your job record
      
      if (calendarEventId) {
        const result = await updateJobCalendarEvent(
          calendarEventId,
          {
            jobId: mockJob.id,
            title: mockJob.title,
            description: mockJob.description || '',
            location: mockJob.address || '',
            startDate: newStartDate,
            endDate: newEndDate,
          },
        );

        if (!result.success) {
          console.warn('Calendar update failed:', result.error);
        }
      }

      Alert.alert('Rescheduled', 'Job and calendar have been updated.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to reschedule.');
    }
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Calendar Sync Integration Example</Text>
      
      <Text style={styles.subtitle}>Job: {mockJob.title}</Text>
      <Text style={styles.detail}>Client: {mockJob.profiles?.full_name}</Text>
      <Text style={styles.detail}>
        Scheduled: {mockJob.scheduled_date.toLocaleString()}
      </Text>
      <Text style={styles.detail}>Location: {mockJob.address}</Text>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={handleAcceptJob}>
          <Text style={styles.buttonText}>Accept Job & Sync to Calendar</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleCancelJob}>
          <Text style={styles.buttonText}>Cancel Job</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleReschedule}>
          <Text style={styles.buttonText}>Reschedule Job</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>How It Works:</Text>
        <Text style={styles.infoText}>
          1. Accept job → Updates database status to "assigned"
        </Text>
        <Text style={styles.infoText}>
          2. Calendar sync → Creates native calendar event with alarms
        </Text>
        <Text style={styles.infoText}>
          3. Store eventId → Saves calendar_event_id in database for future updates
        </Text>
        <Text style={styles.infoText}>
          4. Cancel/Reschedule → Updates or removes calendar event
        </Text>
      </View>

      <View style={styles.codeContainer}>
        <Text style={styles.codeTitle}>Integration Code:</Text>
        <Text style={styles.codeText}>
          {`// 1. Import the calendar sync functions
import {
  addJobToCalendar,
  removeJobFromCalendar,
  updateJobCalendarEvent,
} from '../utils/calendarSync';

// 2. Create calendar event data
const calendarEvent = {
  jobId: job.id,
  title: job.title,
  description: job.description,
  location: job.address,
  startDate: new Date(job.scheduled_date),
  endDate: new Date(job.scheduled_date + 2 hours),
  inspectionType: job.inspection_type,
  budget: job.budget,
  clientName: job.client_name,
  notes: job.notes,
};

// 3. Sync to calendar
const result = await addJobToCalendar(calendarEvent);
if (result.success) {
  // Store result.eventId in your database
  await updateJob({ calendar_event_id: result.eventId });
}`}
        </Text>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333',
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#666',
  },
  detail: {
    fontSize: 14,
    marginBottom: 5,
    color: '#888',
  },
  buttonContainer: {
    marginVertical: 20,
  },
  button: {
    backgroundColor: '#7C3AED',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  infoText: {
    fontSize: 14,
    marginBottom: 5,
    color: '#666',
    lineHeight: 20,
  },
  codeContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#1e1e1e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  codeTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#fff',
  },
  codeText: {
    fontSize: 12,
    color: '#d4d4d4',
    lineHeight: 18,
    fontFamily: 'Courier New, monospace',
  },
});

// ═══════════════════════════════════════════════════════════
// Usage in your actual job detail screen:
// 
// import { CalendarSyncExample } from '../examples/CalendarSyncExample';
//
// // In your job detail component:
// <CalendarSyncExample />
//
// Or integrate the functions directly into your existing job detail screen
// using the patterns shown above.
// ═══════════════════════════════════════════════════════════