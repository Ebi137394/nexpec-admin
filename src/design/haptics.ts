// ════════════════════════════════════════════════════════════════════════════
//  src/design/haptics.ts
//
//  AEGIS — Touch Language.
//
//  Seven haptic syllables, each keyed to a specific class of interaction.
//  The discipline is absolute: never haptic-on-every-tap. The buzz means
//  something every time it happens, and users learn the dictionary
//  subliminally:
//
//    selection   chip toggle, picker change, role-card select
//    light       primary tap (Submit, Save, Next)
//    medium      destructive confirm, GPS capture
//    heavy       first capture in a job, affidavit generated
//    success     signature verified, payment released, application approved
//    warning     chain break detected, GPS off-claim, EXIF stripped
//    error       submission failed, access denied
//
//  All seven gracefully no-op on platforms where Haptics isn't available
//  (web) or when the device's Haptic engine is off. The intent stays
//  call-site-readable: aegisHaptic('success') everywhere, fire-and-forget.
// ════════════════════════════════════════════════════════════════════════════

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type AegisHaptic =
  | 'selection'
  | 'light'
  | 'medium'
  | 'heavy'
  | 'success'
  | 'warning'
  | 'error';

/**
 * Fire a named haptic syllable. Promise-returning so callers may await,
 * though most usage is fire-and-forget. Swallows errors silently — a
 * missing haptic engine should never crash a flow.
 */
export async function aegisHaptic(pattern: AegisHaptic): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    switch (pattern) {
      case 'selection': await Haptics.selectionAsync(); break;
      case 'light':     await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
      case 'medium':    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
      case 'heavy':     await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); break;
      case 'success':   await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
      case 'warning':   await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
      case 'error':     await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
    }
  } catch {
    /* haptic engine unavailable — silent */
  }
}

// ─────────────────────────────────────────────────────────────
//  Convenience aliases for the common cases — read better at
//  call sites that just want one shot fired.
// ─────────────────────────────────────────────────────────────
export const tapLight    = () => aegisHaptic('light');
export const tapMedium   = () => aegisHaptic('medium');
export const tapHeavy    = () => aegisHaptic('heavy');
export const buzzSuccess = () => aegisHaptic('success');
export const buzzWarning = () => aegisHaptic('warning');
export const buzzError   = () => aegisHaptic('error');
export const select      = () => aegisHaptic('selection');
