// D33 — map availability gate.
//
// On Android, react-native-maps' only provider is Google Maps, and creating a
// MapView WITHOUT a manifest API key does not degrade gracefully: the native
// constructor throws, Fabric's surface dies, expo-updates' error recovery
// gives up ("could not recover from error, crashing") and the WHOLE app is a
// dead white screen until force-stop. Found by the Android role matrix when
// the client Jobs tab white-screened the entire app.
//
// A missing credential must never take down the app. Screens that embed maps
// gate on mapsAvailable() and render this truthful placeholder instead. The
// key is plumbed from GOOGLE_MAPS_ANDROID_API_KEY at prebuild time via
// app.config.js — once the owner provisions one, the gate opens by itself.
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

export function mapsAvailable(): boolean {
  if (Platform.OS !== 'android') return true; // iOS uses Apple Maps — no key
  const cfg = Constants.expoConfig as
    | { android?: { config?: { googleMaps?: { apiKey?: string } } } }
    | null;
  return !!cfg?.android?.config?.googleMaps?.apiKey;
}

export function MapUnavailable({ note }: { note?: string }): React.ReactElement {
  return (
    <View style={s.wrap} testID="map-unavailable">
      <Ionicons name="map-outline" size={28} color="#8B8FA3" />
      <Text style={s.title}>Map view unavailable</Text>
      <Text style={s.sub}>
        {note ?? 'Map display is not configured on this build. Job locations are shown in the list below.'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101223',
    padding: 24,
    gap: 8,
  },
  title: { color: '#E7E9F5', fontSize: 15, fontWeight: '600' },
  sub: { color: '#8B8FA3', fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
