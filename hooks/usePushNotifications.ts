// hooks/usePushNotifications.ts
// Register push notifications in your React Native Expo app

import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import Constants from 'expo-constants';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
  error: string | null;
}

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    // Register for push notifications
    registerForPushNotificationsAsync()
      .then(token => {
        if (token) {
          setExpoPushToken(token);
          saveTokenToDatabase(token);
        }
      })
      .catch(err => {
        setError(err.message);
        console.error('Push notification registration failed:', err);
      });

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(
      notification => {
        setNotification(notification);
        handleNotificationReceived(notification);
      }
    );

    // Listen for notification interactions
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      response => {
        handleNotificationResponse(response);
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);

  return { expoPushToken, notification, error };
}

async function registerForPushNotificationsAsync(): Promise<string | undefined> {
  let token: string | undefined;

  // Must be a physical device
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return undefined;
  }

  // Android-specific channel setup
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('certification-reminders', {
      name: 'Certification Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7C3AED', // Updated to match brand color
      description: 'Notifications for certification expiry reminders',
    });

    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permissions not granted');
    return undefined;
  }

  // Get the Expo push token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    
    token = (await Notifications.getExpoPushTokenAsync({
      projectId,
    })).data;
    
    console.log('Expo Push Token:', token);
  } catch (error) {
    console.error('Error getting push token:', error);
  }

  return token;
}

async function saveTokenToDatabase(token: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('No authenticated user, cannot save push token');
      return;
    }

    // Update the contractor's push token
    const { error } = await supabase
      .from('contractors')
      .update({ 
        expo_push_token: token,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    if (error) {
      console.error('Error saving push token:', error);
    } else {
      console.log('Push token saved successfully');
    }
  } catch (error) {
    console.error('Error in saveTokenToDatabase:', error);
  }
}

function handleNotificationReceived(notification: Notifications.Notification): void {
  const data = notification.request.content.data;
  
  console.log('Notification received:', {
    title: notification.request.content.title,
    body: notification.request.content.body,
    data,
  });

  // Handle certification expiry notifications
  if (data?.type === 'certification_expiry') {
    // You could update local state, show a badge, etc.
    console.log(`Certification "${data.certificationTitle}" expires in ${data.daysUntilExpiry} days`);
  }
}

function handleNotificationResponse(
  response: Notifications.NotificationResponse
): void {
  const data = response.notification.request.content.data;
  
  console.log('Notification tapped:', data);

  // Navigate to the appropriate screen based on notification type
  if (data?.type === 'certification_expiry' && data?.screen) {
    // Use your navigation library to navigate
    // navigation.navigate(data.screen, data.params);
    console.log(`Navigate to ${data.screen} with params:`, data.params);
  }
}

// Export helper to manually request permissions
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// Export helper to get current permission status
export async function getNotificationPermissionStatus(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}