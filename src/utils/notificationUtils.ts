// src/utils/notificationUtils.ts
import { supabase } from '@/lib/supabase';

export interface NotificationSettings {
  user_id: string;
  email_disputes: boolean;
  email_project_updates: boolean;
  push_disputes: boolean;
  push_project_updates: boolean;
  push_contract_updates: boolean;
  email_contract_updates: boolean;
}

/**
 * Checks if user has enabled specific notification types
 * @param userId - The user ID to check settings for
 * @param notificationType - The type of notification to check
 * @returns Promise<boolean> - Whether the notification type is enabled
 */
export async function checkUserNotificationSettings(
  userId: string, 
  notificationType: 'email_disputes' | 'email_project_updates' | 'push_disputes' | 'push_project_updates' | 'push_contract_updates' | 'email_contract_updates'
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error fetching notification settings:', error);
      return false;
    }

    if (!data) {
      // If no settings found, return default true for backward compatibility
      return true;
    }

    return data[notificationType] ?? true;
  } catch (error) {
    console.error('Error checking notification settings:', error);
    return false;
  }
}

/**
 * Sends email notification only if user has enabled email notifications for the specific type
 * @param userId - Recipient user ID
 * @param emailData - Email data object
 * @param notificationType - Type of email notification
 */
export async function sendEmailWithSettingsCheck(
  userId: string,
  emailData: any,
  notificationType: 'email_disputes' | 'email_project_updates' | 'email_contract_updates'
): Promise<void> {
  const isEnabled = await checkUserNotificationSettings(userId, notificationType);
  
  if (isEnabled) {
    try {
      // Your email sending logic here
      // await sendEmail({ ...emailData });
      console.log(`Sending ${notificationType} email to user ${userId}`);
    } catch (error) {
      console.error('Error sending email:', error);
    }
  } else {
    console.log(`User ${userId} has disabled ${notificationType} notifications`);
  }
}

/**
 * Sends push notification only if user has enabled push notifications for the specific type
 * @param userId - Recipient user ID
 * @param pushData - Push notification data object
 * @param notificationType - Type of push notification
 */
export async function sendPushWithSettingsCheck(
  userId: string,
  pushData: any,
  notificationType: 'push_disputes' | 'push_project_updates' | 'push_contract_updates'
): Promise<void> {
  const isEnabled = await checkUserNotificationSettings(userId, notificationType);
  
  if (isEnabled) {
    try {
      // Your push notification sending logic here
      // await sendPushNotification({ ...pushData });
      console.log(`Sending ${notificationType} push notification to user ${userId}`);
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  } else {
    console.log(`User ${userId} has disabled ${notificationType} push notifications`);
  }
}

/**
 * Sends both email and push notification with settings checks
 * @param userId - Recipient user ID
 * @param emailData - Email data object
 * @param pushData - Push notification data object
 * @param emailType - Type of email notification
 * @param pushType - Type of push notification
 */
export async function sendNotificationWithSettingsCheck(
  userId: string,
  emailData: any,
  pushData: any,
  emailType: 'email_disputes' | 'email_project_updates' | 'email_contract_updates',
  pushType: 'push_disputes' | 'push_project_updates' | 'push_contract_updates'
): Promise<void> {
  // Send email if enabled
  await sendEmailWithSettingsCheck(userId, emailData, emailType);
  
  // Send push notification if enabled
  await sendPushWithSettingsCheck(userId, pushData, pushType);
}

/**
 * Creates a notification record in the database
 * @param notificationData - Notification data
 */
export async function createNotification(notificationData: {
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
}): Promise<void> {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([{
        ...notificationData,
        created_at: new Date().toISOString(),
        is_read: false
      }]);

    if (error) {
      console.error('Error creating notification:', error);
    }
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}