// src/utils/navigationHelper.ts

import { Alert, Linking, Platform } from 'react-native';
import { showLocation } from 'react-native-map-link';

// ─── Types ──────────────────────────────────────────────────
export interface NavigationTarget {
  latitude?: number | null;
  longitude?: number | null;
  title?: string;
  address?: string;
}

// ─── Core Navigation Function ───────────────────────────────

/**
 * Opens a map picker dialog allowing the user to choose their preferred
 * navigation app (Google Maps, Apple Maps, Waze, etc.).
 *
 * If coordinates are available, uses precise lat/lng navigation.
 * If only an address is available, falls back to a Google Maps search.
 * If neither exists, shows an error alert.
 */
export async function navigateToLocation(target: NavigationTarget): Promise<void> {
  const { latitude, longitude, title, address } = target;

  const hasCoordinates =
    latitude != null &&
    longitude != null &&
    !isNaN(latitude) &&
    !isNaN(longitude) &&
    latitude !== 0 &&
    longitude !== 0;

  // ── Case 1: We have precise GPS coordinates
  if (hasCoordinates) {
    try {
      await showLocation({
        latitude: latitude!,
        longitude: longitude!,
        title: title ?? 'Job Site',
        googleForceLatLon: true,
        alwaysIncludeGoogle: true,
        dialogTitle: 'Navigate to Job Site',
        dialogMessage: title
          ? `Open directions to "${title}"`
          : 'Choose your navigation app',
        cancelText: 'Cancel',
        directionsMode: 'car',
        // These apps will appear if installed on the device
        appsWhiteList: [
          'google-maps',
          'apple-maps',
          'waze',
          'citymapper',
          'uber',
        ],
      });
    } catch (error: any) {
      // User cancelled the picker — not an error
      if (error?.message?.includes('cancel') || error?.message?.includes('dismissed')) {
        return;
      }
      console.error('[NavigationHelper] showLocation failed:', error);
      // Fallback: open Google Maps directly via URL
      await openGoogleMapsCoordinates(latitude!, longitude!, title);
    }
    return;
  }

  // ── Case 2: No coordinates, but we have a text address
  if (address && address.trim().length > 0) {
    Alert.alert(
      'Approximate Location',
      'Exact GPS coordinates are not available for this job. We\'ll search the address in Google Maps instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Maps',
          onPress: () => openGoogleMapsAddress(address, title),
        },
      ]
    );
    return;
  }

  // ── Case 3: No coordinates AND no address
  Alert.alert(
    'Location Unavailable',
    'This job does not have location data. Please contact the client for directions.',
    [{ text: 'OK' }]
  );
}

// ─── Fallback: Google Maps via URL (Coordinates) ────────────

async function openGoogleMapsCoordinates(
  lat: number,
  lng: number,
  label?: string
): Promise<void> {
  try {
    // Google Maps universal URL with directions
    const encodedLabel = encodeURIComponent(label ?? 'Job Site');
    const url = Platform.select({
      ios: `maps://app?daddr=${lat},${lng}&dirflg=d`,
      android: `google.navigation:q=${lat},${lng}&mode=d`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodedLabel}&travelmode=driving`,
    });

    const canOpen = await Linking.canOpenURL(url!);
    if (canOpen) {
      await Linking.openURL(url!);
    } else {
      // Ultimate fallback: web URL
      await Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
      );
    }
  } catch (error) {
    console.error('[NavigationHelper] Fallback navigation failed:', error);
    Alert.alert('Navigation Error', 'Could not open maps. Please try again.');
  }
}

// ─── Fallback: Google Maps via URL (Address Search) ─────────

async function openGoogleMapsAddress(
  address: string,
  label?: string
): Promise<void> {
  try {
    const query = encodeURIComponent(address);
    const url = Platform.select({
      ios: `maps://app?q=${query}`,
      android: `geo:0,0?q=${query}`,
      default: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });

    const canOpen = await Linking.canOpenURL(url!);
    if (canOpen) {
      await Linking.openURL(url!);
    } else {
      await Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${query}`
      );
    }
  } catch (error) {
    console.error('[NavigationHelper] Address search failed:', error);
    Alert.alert('Navigation Error', 'Could not open maps. Please try again.');
  }
}

// ─── Convenience Shortcut ───────────────────────────────────

/**
 * Quick shortcut for the map screen.
 * Pass the full job object and it handles everything.
 */
export function navigateToJob(job: {
  latitude?: number | null;
  longitude?: number | null;
  title?: string;
  location?: string;
}): void {
  navigateToLocation({
    latitude: job.latitude,
    longitude: job.longitude,
    title: job.title,
    address: job.location,
  });
}

// ─── Legacy Functions (for backward compatibility) ──────────

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
