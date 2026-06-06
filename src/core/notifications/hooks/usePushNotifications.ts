// hooks/usePushNotifications.ts
import { useState, useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ★ NOTIF-DEEPLINK-001 — Sanitises a deep-link target from the push
//   payload and routes via expo-router.
//
//   The notify-job-event Edge Function (supabase/functions/notify-job-event)
//   ships pushes with a `data` payload shaped:
//     { event_id, job_id, event_type, deep_link, ...extra }
//
//   We prefer the server-provided `deep_link` (already constrained to
//   the `/jobs/<id>` shape) but reconstruct from `job_id` as a
//   defence-in-depth fallback if `deep_link` is absent / malformed.
//
//   Whitelist guards against arbitrary push payloads routing the user
//   into an unexpected screen — only paths matching the known shapes
//   are accepted. Anything else falls through to a NO-OP that surfaces
//   in the console for ops triage (we never silently navigate the user
//   somewhere they didn't expect).
const ALLOWED_DEEP_LINK_PATTERNS: readonly RegExp[] = [
  /^\/jobs\/[0-9a-f-]+(?:\/[a-z][a-z0-9_-]*)*$/i,
  /^\/messages\/[0-9a-f-]+$/i,
  /^\/reviews\/submit\/[0-9a-f-]+$/i,
  /^\/payment-screen(?:\?.*)?$/,
  /^\/agreements$/,
  /^\/agreements\/[0-9a-f-]+\/sign$/i,
];

function routeFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;

  const rawLink = typeof d.deep_link === 'string' ? d.deep_link : null;
  if (rawLink && ALLOWED_DEEP_LINK_PATTERNS.some((re) => re.test(rawLink))) {
    return rawLink;
  }

  // Fallback: reconstruct from job_id if the explicit link is missing.
  const jobId = typeof d.job_id === 'string' ? d.job_id : null;
  if (jobId && /^[0-9a-f-]+$/i.test(jobId)) {
    return `/jobs/${jobId}`;
  }

  return null;
}

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
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

    notificationListener.current = Notifications.addNotificationReceivedListener(
      notification => setNotification(notification)
    );

    // ★ NOTIF-DEEPLINK-001 — replace the prior no-op console.log with a
    //   sanitised deep-link router push. Fires on cold-start tap AND
    //   on foreground tap. Bare-string router import is intentional so
    //   this hook stays usable from any layer of the tree without
    //   re-requiring useRouter() context.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      response => {
        const target = routeFromNotificationData(
          response?.notification?.request?.content?.data,
        );
        if (!target) {
          console.warn(
            '[push] tap with unroutable payload, ignored:',
            JSON.stringify(response?.notification?.request?.content?.data ?? null),
          );
          return;
        }
        try {
          router.push(target as any);
        } catch (e: any) {
          console.error('[push] router.push failed:', e?.message ?? e);
        }
      },
    );

    return () => {
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return { expoPushToken, notification, error };
}

async function registerForPushNotificationsAsync(): Promise<string | undefined> {
  // ─── MOCK LOGIC FOR SIMULATOR ───────────────────────────────────────
  if (!Device.isDevice) {
    console.log('--- RUNNING ON SIMULATOR ---');
    console.log('Generating Mock Token for database testing...');
    return "ExponentPushToken[MOCK_TOKEN_FOR_SIMULATOR]"; 
  }
  // ─────────────────────────────────────────────────────────────────────

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return undefined;

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    console.error('Error getting push token:', error);
    return undefined;
  }
}

async function saveTokenToDatabase(token: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // ★ NOTIF-HOOK-CLEANUP-001 — push_tokens is the canonical store.
    //   Pre-strike this function also UPDATEd profiles.expo_push_token
    //   as a "safety net", but that column was never migrated (silent
    //   no-op). After NOTIF-FANOUT-001 + NOTIF-CONTRACTOR-001 the
    //   Edge Functions read tokens only from push_tokens, so the
    //   secondary write was pure dead code.
    const { error: tableError } = await supabase
      .from('push_tokens')
      .upsert(
        {
          user_id: user.id,
          token: token,
          device_type: Platform.OS,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (tableError) {
      console.error('push_tokens upsert failed:', tableError.message);
      return;
    }

    // ★ CONSOLE-NOISE-001(A): PII-stripped (was: user.id).
    console.log('[push] token saved');
  } catch (error) {
    console.error('saveTokenToDatabase failed:', error);
  }
}