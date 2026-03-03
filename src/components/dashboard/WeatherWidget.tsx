// src/components/dashboard/WeatherWidget.tsx

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeatherData {
  temperature: number;       // °C
  humidity: number;          // %
  windSpeed: number;         // km/h
  condition: WeatherCondition;
  description: string;
  locationName: string;
}

type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'mist';

interface WeatherWidgetProps {
  apiKey?: string;            // OpenWeatherMap API key (optional — falls back to mock)
  humidityThreshold?: number; // Default 85%
  onWeatherLoaded?: (data: WeatherData) => void;
  onHumidityWarning?: (humidity: number) => void;
}

type LoadingState = 'idle' | 'locating' | 'fetching' | 'success' | 'error';

// ─── Mock API (Production-ready swap point) ──────────────────────────────────

const mockWeatherFetch = async (
  lat: number,
  lon: number
): Promise<WeatherData> => {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Deterministic mock based on coordinates for consistent testing
  const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233) * 43758.5453) % 1;

  const conditions: WeatherCondition[] = ['clear', 'clouds', 'rain', 'mist'];
  const conditionIndex = Math.floor(seed * conditions.length);

  return {
    temperature: Math.round(18 + seed * 22),        // 18–40°C range
    humidity: Math.round(40 + seed * 55),            // 40–95% range
    windSpeed: Math.round(5 + seed * 35),            // 5–40 km/h range
    condition: conditions[conditionIndex],
    description: `Mock data for ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    locationName: 'Current Site',
  };
};

const liveWeatherFetch = async (
  lat: number,
  lon: number,
  apiKey: string
): Promise<WeatherData> => {
  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Weather API returned ${response.status}`);
  }

  const data = await response.json();

  const mapCondition = (id: number): WeatherCondition => {
    if (id >= 200 && id < 300) return 'storm';
    if (id >= 300 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'mist';
    if (id === 800) return 'clear';
    return 'clouds';
  };

  return {
    temperature: Math.round(data.main.temp),
    humidity: data.main.humidity,
    windSpeed: Math.round(data.wind.speed * 3.6), // m/s → km/h
    condition: mapCondition(data.weather[0].id),
    description: data.weather[0].description,
    locationName: data.name || 'Current Site',
  };
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

const ConditionIcon: React.FC<{ condition: WeatherCondition }> = ({ condition }) => {
  const iconMap: Record<WeatherCondition, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
    clear:  { name: 'sunny',            color: '#FFD700' },
    clouds: { name: 'cloud',            color: '#A0AEC0' },
    rain:   { name: 'rainy',            color: '#63B3ED' },
    storm:  { name: 'thunderstorm',     color: '#E53E3E' },
    snow:   { name: 'snow',             color: '#E2E8F0' },
    mist:   { name: 'water',            color: '#CBD5E0' },
  };

  const icon = iconMap[condition] ?? iconMap.clear;
  return <Ionicons name={icon.name} size={32} color={icon.color} />;
};

const MetricPill: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  alert?: boolean;
}> = ({ icon, value, label, alert }) => (
  <View style={[styles.metricPill, alert && styles.metricPillAlert]}>
    <Ionicons
      name={icon}
      size={16}
      color={alert ? '#FED7D7' : 'rgba(255,255,255,0.7)'}
    />
    <Text style={[styles.metricValue, alert && styles.metricValueAlert]}>
      {value}
    </Text>
    <Text style={[styles.metricLabel, alert && styles.metricLabelAlert]}>
      {label}
    </Text>
  </View>
);

const HumidityWarningBanner: React.FC<{ humidity: number }> = ({ humidity }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View style={[styles.warningBanner, { opacity: pulseAnim }]}>
      <Ionicons name="warning" size={14} color="#FED7D7" />
      <Text style={styles.warningText}>
        ⚠ HIGH HUMIDITY ({humidity}%) — Painting conditions critical
      </Text>
    </Animated.View>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const WeatherWidget: React.FC<WeatherWidgetProps> = ({
  apiKey,
  humidityThreshold = 85,
  onWeatherLoaded,
  onHumidityWarning,
}) => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const isHumidityDangerous = weather !== null && weather.humidity > humidityThreshold;

  const fetchWeather = useCallback(async () => {
    try {
      // ── Step 1: Location Permission ────────────────────────────────
      setLoadingState('locating');
      setErrorMessage('');

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Location permission denied. Enable in Settings.');
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;

      // ── Step 2: Weather Data ───────────────────────────────────────
      setLoadingState('fetching');

      let data: WeatherData;

      if (apiKey && apiKey.length > 10) {
        data = await liveWeatherFetch(latitude, longitude, apiKey);
      } else {
        data = await mockWeatherFetch(latitude, longitude);
      }

      setWeather(data);
      setLoadingState('success');

      // Callbacks
      onWeatherLoaded?.(data);
      if (data.humidity > humidityThreshold) {
        onHumidityWarning?.(data.humidity);
      }

      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();
    } catch (err: any) {
      setLoadingState('error');
      setErrorMessage(err.message || 'Failed to fetch weather data.');
    }
  }, [apiKey, humidityThreshold]);

  useEffect(() => {
    fetchWeather();

    // Refresh every 15 minutes
    const interval = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  // ── Loading State ────────────────────────────────────────────────────────

  if (loadingState === 'idle' || loadingState === 'locating' || loadingState === 'fetching') {
    return (
      <View style={styles.container}>
        <View style={styles.glassCard}>
          <ActivityIndicator size="small" color="#60A5FA" />
          <Text style={styles.loadingText}>
            {loadingState === 'locating' ? 'Getting location…' : 'Fetching weather…'}
          </Text>
        </View>
      </View>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────

  if (loadingState === 'error') {
    return (
      <View style={styles.container}>
        <View style={[styles.glassCard, styles.errorCard]}>
          <Ionicons name="cloud-offline" size={24} color="#FC8181" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      </View>
    );
  }

  // ── Success State ────────────────────────────────────────────────────────

  if (!weather) return null;

  const CardWrapper = Platform.OS === 'ios' ? BlurView : View;
  const cardProps = Platform.OS === 'ios'
    ? { intensity: 40, tint: 'dark' as const }
    : {};

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity: fadeAnim }}>
        <CardWrapper
          {...cardProps}
          style={[
            styles.glassCard,
            Platform.OS === 'android' && styles.androidGlass,
            isHumidityDangerous && styles.dangerBorder,
          ]}
        >
          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <ConditionIcon condition={weather.condition} />
              <View style={styles.headerText}>
                <Text style={styles.temperature}>{weather.temperature}°C</Text>
                <Text style={styles.locationName}>{weather.locationName}</Text>
              </View>
            </View>
            <View style={styles.conditionBadge}>
              <Text style={styles.conditionText}>
                {weather.condition.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Metrics Row */}
          <View style={styles.metricsRow}>
            <MetricPill
              icon="thermometer-outline"
              value={`${weather.temperature}°`}
              label="Temp"
            />
            <MetricPill
              icon="water-outline"
              value={`${weather.humidity}%`}
              label="Humidity"
              alert={isHumidityDangerous}
            />
            <MetricPill
              icon="speedometer-outline"
              value={`${weather.windSpeed}`}
              label="km/h"
            />
          </View>

          {/* Humidity Warning */}
          {isHumidityDangerous && (
            <HumidityWarningBanner humidity={weather.humidity} />
          )}
        </CardWrapper>
      </Animated.View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  glassCard: {
    borderRadius: 16,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  androidGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  dangerBorder: {
    borderColor: 'rgba(245, 101, 101, 0.4)',
    borderWidth: 1.5,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(245, 101, 101, 0.08)',
    borderColor: 'rgba(245, 101, 101, 0.2)',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    gap: 2,
  },
  temperature: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  locationName: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  conditionBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  conditionText: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 1.2,
  },

  // Metrics
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricPill: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  metricPillAlert: {
    backgroundColor: 'rgba(245, 101, 101, 0.12)',
    borderColor: 'rgba(245, 101, 101, 0.3)',
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metricValueAlert: {
    color: '#FED7D7',
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metricLabelAlert: {
    color: 'rgba(254, 215, 215, 0.7)',
  },

  // Warning Banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    backgroundColor: 'rgba(245, 101, 101, 0.15)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 101, 101, 0.25)',
  },
  warningText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FED7D7',
    flex: 1,
    letterSpacing: 0.3,
  },

  // Loading / Error
  loadingText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    color: '#FC8181',
    fontSize: 12,
    flex: 1,
  },
});

export default WeatherWidget;