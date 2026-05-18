import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';

export interface CapturedLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  formattedAddress?: string;
}

/**
 * Requests location permission and captures the device's current GPS position.
 * Returns null if permission is denied or location fails.
 */
export async function captureCurrentLocation(): Promise<CapturedLocation | null> {
  try {
    // ── Step 1: Check / Request Permission
    const { status: existingStatus } =
      await Location.getForegroundPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert(
        'Location Permission Required',
        'NEXPEC needs location access to pin the exact job site for inspectors. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              if (Platform.OS === 'ios') {
                Linking.openURL('app-settings:');
              } else {
                Linking.openSettings();
              }
            },
          },
        ]
      );
      return null;
    }

    // ── Step 2: Get Current Position
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const result: CapturedLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };

    // ── Step 3: Reverse Geocode (optional — for display)
    try {
      const [geocode] = await Location.reverseGeocodeAsync({
        latitude: result.latitude,
        longitude: result.longitude,
      });

      if (geocode) {
        const parts = [
          geocode.streetNumber,
          geocode.street,
          geocode.city,
          geocode.region,
          geocode.postalCode,
        ].filter(Boolean);

        result.formattedAddress = parts.join(', ');
      }
    } catch {
      // Reverse geocoding is nice-to-have, not critical
      console.warn('[LocationCapture] Reverse geocode failed — non-critical.');
    }

    return result;
  } catch (error: any) {
    console.error('[LocationCapture] Failed to capture location:', error);

    if (error.code === 'E_LOCATION_SERVICES_DISABLED') {
      Alert.alert(
        'Location Services Disabled',
        'Please enable Location Services in your device settings to pin job sites.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Location Error',
        'Could not determine your current location. You can still post the job with a text address.'
      );
    }

    return null;
  }
}

/**
 * Forward geocode: converts a text address to coordinates.
 * Useful when the client types an address but doesn't use GPS.
 */
export async function geocodeAddress(
  address: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    if (!address || address.trim().length < 3) return null;

    const results = await Location.geocodeAsync(address.trim());

    if (results.length > 0) {
      return {
        latitude: results[0].latitude,
        longitude: results[0].longitude,
      };
    }

    return null;
  } catch (error) {
    console.warn('[LocationCapture] Geocode failed for address:', address, error);
    return null;
  }
}
