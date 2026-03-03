// src/utils/navigationHelper.ts

import { Platform, Alert, Linking } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OpenMapsOptions {
  label?: string;       // Pin label / place name
  zoom?: number;        // Zoom level (Google Maps: 1-21)
  travelMode?: 'driving' | 'walking' | 'transit' | 'bicycling';
  navigate?: boolean;   // If true, open in navigation/directions mode
}

type MapsApp = 'apple' | 'google' | 'waze';

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Opens coordinates in the platform-native maps app.
 *
 * - **iOS**: Apple Maps (falls back to Google Maps if installed)
 * - **Android**: Google Maps (falls back to any maps intent)
 *
 * @example
 * ```ts
 * import { openMaps } from ''utils/navigationHelper'' (see below for file content);
 *
 * // Simple pin drop
 * openMaps(24.7136, 46.6753);
 *
 * // With label and navigation mode
 * openMaps(24.7136, 46.6753, {
 *   label: 'Aramco Facility Gate 3',
 *   navigate: true,
 *   travelMode: 'driving',
 * });
 * ```
 */
export async function openMaps(
  lat: number,
  lon: number,
  options: OpenMapsOptions = {}
): Promise<boolean> {
  const { label, zoom = 17, travelMode = 'driving', navigate = false } = options;

  // Validate coordinates
  if (!isValidCoordinate(lat, lon)) {
    Alert.alert(
      'Invalid Coordinates',
      `Cannot open maps with coordinates (${lat}, ${lon}).`
    );
    return false;
  }

  try {
    if (Platform.OS === 'ios') {
      return await openIosMaps(lat, lon, label, navigate, travelMode);
    }

    return await openAndroidMaps(lat, lon, label, zoom, navigate, travelMode);
  } catch (error: any) {
    console.error('[NavigationHelper] Error:', error);

    // Ultimate fallback: open in browser
    const browserUrl = `https://www.google.com/maps?q=${lat},${lon}`;
    const canOpen = await Linking.canOpenURL(browserUrl);

    if (canOpen) {
      await Linking.openURL(browserUrl);
      return true;
    }

    Alert.alert('Maps Error', 'Unable to open any maps application.');
    return false;
  }
}

// ── iOS Maps ─────────────────────────────────────────────────────────────────

async function openIosMaps(
  lat: number,
  lon: number,
  label?: string,
  navigate?: boolean,
  travelMode?: string
): Promise<boolean> {
  if (navigate) {
    // Directions mode
    const appleMapsDir = `maps://app?daddr=${lat},${lon}&dirflg=${getAppleTravelFlag(travelMode)}`;
    const googleMapsDir = `comgooglemaps://?daddr=${lat},${lon}&directionsmode=${travelMode}`;

    // Try Google Maps first (more feature-rich navigation)
    if (await Linking.canOpenURL(googleMapsDir)) {
      await Linking.openURL(googleMapsDir);
      return true;
    }

    // Fall back to Apple Maps
    await Linking.openURL(appleMapsDir);
    return true;
  }

  // Pin-drop mode
  const encodedLabel = encodeURIComponent(label || 'Inspection Site');
  const appleMapsUrl = `maps://app?ll=${lat},${lon}&q=${encodedLabel}`;

  await Linking.openURL(appleMapsUrl);
  return true;
}

// ── Android Maps ─────────────────────────────────────────────────────────────

async function openAndroidMaps(
  lat: number,
  lon: number,
  label?: string,
  zoom?: number,
  navigate?: boolean,
  travelMode?: string
): Promise<boolean> {
  if (navigate) {
    const directionsUrl =
      `google.navigation:q=${lat},${lon}&mode=${getGoogleTravelFlag(travelMode)}`;

    if (await Linking.canOpenURL(directionsUrl)) {
      await Linking.openURL(directionsUrl);
      return true;
    }
  }

  // Standard pin-drop
  const encodedLabel = encodeURIComponent(label || 'Inspection Site');
  const googleMapsUrl = `geo:${lat},${lon}?q=${lat},${lon}(${encodedLabel})&z=${zoom}`;

  if (await Linking.canOpenURL(googleMapsUrl)) {
    await Linking.openURL(googleMapsUrl);
    return true;
  }

  // Fallback to HTTPS
  const httpsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  await Linking.openURL(httpsUrl);
  return true;
}

// ── Open with specific app ───────────────────────────────────────────────────

/**
 * Open coordinates in a specific maps app (useful for a "Choose App" sheet).
 */
export async function openMapsWithApp(
  lat: number,
  lon: number,
  app: MapsApp,
  label?: string
): Promise<boolean> {
  const encodedLabel = encodeURIComponent(label || 'Inspection Site');

  const urls: Record<MapsApp, string> = {
    apple: `maps://app?ll=${lat},${lon}&q=${encodedLabel}`,
    google:
      Platform.OS === 'ios'
        ? `comgooglemaps://?q=${lat},${lon}&label=${encodedLabel}`
        : `geo:${lat},${lon}?q=${lat},${lon}(${encodedLabel})`,
    waze: `waze://?ll=${lat},${lon}&navigate=yes`,
  };

  const url = urls[app];

  if (await Linking.canOpenURL(url)) {
    await Linking.openURL(url);
    return true;
  }

  Alert.alert(
    'App Not Available',
    `${app.charAt(0).toUpperCase() + app.slice(1)} Maps is not installed.`
  );
  return false;
}

// ─── Generate a Google Maps link (for sharing / SMS) ─────────────────────────

/**
 * Returns a shareable Google Maps URL string.
 * Used by SOSButton and other sharing features.
 */
export function getGoogleMapsLink(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat},${lon}`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function isValidCoordinate(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function getAppleTravelFlag(mode?: string): string {
  const map: Record<string, string> = {
    driving: 'd',
    walking: 'w',
    transit: 'r',
  };
  return map[mode || 'driving'] || 'd';
}

function getGoogleTravelFlag(mode?: string): string {
  const map: Record<string, string> = {
    driving: 'd',
    walking: 'w',
    transit: 'r',
    bicycling: 'b',
  };
  return map[mode || 'driving'] || 'd';
}