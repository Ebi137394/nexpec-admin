// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/voice/useVoiceFindings.ts — offline Voice-to-Text Inspector Copilot
//
//  On-device speech → structured defect suggestions, $0:
//    • Live mode uses the OS recognizer via @react-native-voice/voice (free,
//      on-device). It's require-guarded + this file is intentionally UNWIRED
//      (imported nowhere) so Metro never needs the lib until you install it in a
//      dev build and import this hook from a voice screen.
//    • ingestTranscript() maps ANY transcript (e.g. from Whisper.cpp) → defect
//      suggestions via the shared taxonomy NLU — works with zero native deps.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { transcriptToDefects, type VoiceFindingSuggestion } from '@nexpec/shared-core';

// Require-guarded native STT. Not bundled unless this file is imported AND the
// package is installed (dev build). Until then `available` is false.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Voice: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-voice/voice');
  _Voice = mod?.default ?? mod;
} catch {
  _Voice = null;
}

export interface UseVoiceFindings {
  available: boolean;
  listening: boolean;
  transcript: string;
  suggestions: VoiceFindingSuggestion[];
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  /** Map an externally-produced transcript (e.g. Whisper.cpp) → suggestions. */
  ingestTranscript: (text: string) => VoiceFindingSuggestion[];
}

export function useVoiceFindings(): UseVoiceFindings {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestions, setSuggestions] = useState<VoiceFindingSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ingestTranscript = useCallback((text: string): VoiceFindingSuggestion[] => {
    const s = transcriptToDefects(text);
    setTranscript(text);
    setSuggestions(s);
    return s;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!_Voice) {
      setError('on-device speech recognizer not installed (needs a dev build with @react-native-voice/voice)');
      return false;
    }
    try {
      setError(null);
      setSuggestions([]);
      setTranscript('');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _Voice.onSpeechResults = (e: any) => {
        const text = (e?.value?.[0] ?? '') as string;
        if (text) ingestTranscript(text);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _Voice.onSpeechError = (e: any) => setError(String(e?.error?.message ?? 'speech error'));
      await _Voice.start('en-US');
      setListening(true);
      return true;
    } catch (e) {
      setError((e as Error)?.message ?? 'failed to start recognizer');
      return false;
    }
  }, [ingestTranscript]);

  const stop = useCallback(async (): Promise<void> => {
    try {
      if (_Voice) await _Voice.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  return { available: _Voice != null, listening, transcript, suggestions, error, start, stop, ingestTranscript };
}
