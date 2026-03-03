// src/utils/ipService.ts

interface IPInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
}

export const getIPAddress = async (): Promise<IPInfo> => {
  try {
    // Try primary service
    const response = await fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error('Primary IP service failed');
    }
    
    const data = await response.json();
    
    // Try to get geo info
    try {
      const geoResponse = await fetch(`https://ipapi.co/${data.ip}/json/`);
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        return {
          ip: data.ip,
          country: geoData.country_name,
          region: geoData.region,
          city: geoData.city,
          timezone: geoData.timezone,
        };
      }
    } catch {
      // Geo lookup failed, return just IP
    }
    
    return { ip: data.ip };
  } catch (error) {
    // Fallback: Generate a mock IP for development
    console.warn('IP service unavailable, using mock IP');
    return {
      ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
    };
  }
};

export const generateTimestamp = (): string => {
  return new Date().toISOString();
};

export const getDeviceInfo = async (): Promise<string> => {
  try {
    const Platform = require('react-native').Platform;
    return `${Platform.OS} ${Platform.Version}`;
  } catch {
    return 'Unknown Device';
  }
};
