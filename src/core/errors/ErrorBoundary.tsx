// ════════════════════════════════════════════════════════════════════════════
//  src/core/errors/ErrorBoundary.tsx
//
//  Phase 5 / Hour 3 — Sentry-grade ErrorBoundary at the root of the app.
//
//  WHAT THIS DOES
//  ──────────────
//  React's default behaviour when a render-time exception escapes a component
//  is to unmount the entire tree, leaving the user staring at a blank or
//  red screen (in production builds the red screen disappears too — they
//  just see a frozen UI).
//
//  This boundary:
//    1. Catches the exception via componentDidCatch / getDerivedStateFromError.
//    2. Renders a recoverable fallback screen with an explicit "Try again"
//       action that resets the boundary's internal state and re-mounts the
//       children. No app restart needed for transient render errors.
//    3. Ships the error to a `client_error_events` Supabase table as
//       best-effort telemetry. Failures here are swallowed — we never let
//       the error reporter become a second crash.
//    4. Logs to console in dev so the stack is visible in Metro / Flipper.
//    5. Designed so that a future Sentry init can hook in by replacing
//       `reportToSink` with `Sentry.captureException` — the boundary
//       contract doesn't change.
//
//  WHY NOT A LIBRARY
//  ─────────────────
//  Sentry is not yet installed in package.json. Rather than block launch
//  on adding a 12 MB native binding, we implement the boundary in-house
//  with the same contract Sentry's React boundary exposes. When Sentry
//  lands post-launch, swap the body of `reportToSink` for
//  `Sentry.captureException` and delete this comment.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { supabase } from '@/lib/supabase';

// ── Public sink ──────────────────────────────────────────────────────────
// Best-effort error reporting to the database. Returns void; never throws.
// Future: replace body with Sentry.captureException(error, { extra: info }).
async function reportToSink(
  error: Error,
  info: { componentStack?: string | null },
): Promise<void> {
  try {
    // Resolve a stable identity if we can; otherwise log anonymously.
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch {
      /* swallow — anonymous report is still useful */
    }

    // We avoid throwing on RLS failure. If the table doesn't exist or
    // RLS denies the insert, the catch below swallows it.
    await supabase.from('client_error_events').insert({
      actor_id: userId,
      platform: Platform.OS,
      platform_version: String(Platform.Version),
      message: (error?.message ?? 'Unknown error').slice(0, 1000),
      stack: (error?.stack ?? '').slice(0, 8000),
      component_stack: (info?.componentStack ?? '').slice(0, 8000),
    });
  } catch (sinkErr) {
    // Last-ditch logging only. Never re-throw — that would crash the
    // boundary itself.
    // eslint-disable-next-line no-console
    console.warn('[ErrorBoundary] sink failed:', sinkErr);
  }
}

// ── Boundary contract ────────────────────────────────────────────────────
interface Props {
  children: React.ReactNode;
  /**
   * Optional override for the report sink. Tests pass a no-op; future
   * Sentry integration passes Sentry.captureException.
   */
  onError?: (error: Error, info: { componentStack?: string | null }) => void;
}

interface State {
  error: Error | null;
  errorInfo: { componentStack?: string | null } | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.setState({ errorInfo: info });

    // Always log to console for dev visibility.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] render crash:', error, info?.componentStack);

    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        /* never let the sink crash the boundary */
      }
    } else {
      // Default sink — fire-and-forget.
      void reportToSink(error, info);
    }
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    const err = this.state.error;

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            We hit an unexpected error. Tap "Try again" to recover. If it
            keeps happening, please restart the app and let support know.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={this.reset}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>

          {isDev && (
            <View style={styles.devBlock}>
              <Text style={styles.devHeader}>Developer details</Text>
              <Text style={styles.devText}>
                {err?.name ?? 'Error'}: {err?.message ?? 'unknown'}
              </Text>
              {err?.stack ? (
                <Text style={styles.devStack}>{err.stack}</Text>
              ) : null}
              {this.state.errorInfo?.componentStack ? (
                <Text style={styles.devStack}>
                  {this.state.errorInfo.componentStack}
                </Text>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }
}

export default ErrorBoundary;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  emoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 32,
  },
  primaryButton: {
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  devBlock: {
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    borderColor: 'rgba(124, 58, 237, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  devHeader: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  devText: {
    color: '#F3F4F6',
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginBottom: 8,
  },
  devStack: {
    color: '#9CA3AF',
    fontSize: 11,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 16,
    marginTop: 6,
  },
});
