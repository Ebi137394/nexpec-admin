// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/chat/VoiceNoteBubble.tsx
//
//  Playback bubble for an audio chat attachment. Mirrors the proven VoiceBubble
//  in app/inbox/[id].tsx; kept as a NEW shared component so the working inbox
//  screen is not modified. Attachments live in a private bucket, so the path is
//  exchanged for a short-lived signed URL via the existing signedUrl() helper.
// ════════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { signedUrl } from '@/src/core/storage/signedUrls';

export function VoiceNoteBubble({
  bucket,
  path,
  mine,
  tint = '#B154F0',
}: {
  bucket: string;
  path: string;
  mine: boolean;
  tint?: string;
}) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  // Always unload on unmount — a leaked Sound keeps the audio session open.
  useEffect(() => () => { void soundRef.current?.unloadAsync(); }, []);

  const toggle = useCallback(async () => {
    try {
      if (soundRef.current) {
        if (playing) { await soundRef.current.pauseAsync(); setPlaying(false); }
        else { await soundRef.current.playAsync(); setPlaying(true); }
        return;
      }
      setBusy(true);
      const url = await signedUrl({ bucket, path, ttl: 600 });
      if (!url) return;
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((st: any) => {
        if (st?.isLoaded && st.didJustFinish) { setPlaying(false); void sound.setPositionAsync(0); }
      });
    } catch {
      setPlaying(false);
    } finally {
      setBusy(false);
    }
  }, [bucket, path, playing]);

  return (
    <Pressable onPress={toggle} style={vs.row} accessibilityRole="button" accessibilityLabel="Voice message">
      {busy
        ? <ActivityIndicator size="small" color={mine ? '#FFFFFF' : tint} />
        : <Ionicons name={playing ? 'pause' : 'play'} size={18} color={mine ? '#FFFFFF' : tint} />}
      <Text style={[vs.label, mine && { color: 'rgba(255,255,255,0.9)' }]}>Voice message</Text>
    </Pressable>
  );
}

const vs = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  label: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
});
