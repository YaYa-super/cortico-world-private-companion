/**
 * 天气源：Open-Meteo 免费接口，城市名 → 地理编码 → 当前天气。
 * 不存 API key；默认关闭；只有配置了城市才发请求。
 */

export interface WeatherSnapshot {
  at: string;
  city: string;
  latitude: number;
  longitude: number;
  temperature: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
}

export interface WeatherTrigger {
  key: string;
  reason: string;
  source: 'weather';
  salience: number;
}

const WMO: Record<number, string> = {
  0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '强阵雪',
  95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴大冰雹',
};

export function weatherText(code: number): string {
  return WMO[code] ?? `天气码 ${code}`;
}

export function isRain(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/** 两次天气之间的边沿触发；同一场雨/同一波降温只触发一次由 key 冷却兜底。 */
export function weatherTrigger(prev: WeatherSnapshot | null, current: WeatherSnapshot, date = current.at.slice(0, 10)): WeatherTrigger | null {
  const rainNow = isRain(current.weatherCode);
  const rainBefore = prev ? isRain(prev.weatherCode) : false;
  if (rainNow && !rainBefore) {
    return {
      key: `weather:rain:${date}`,
      reason: `外面${weatherText(current.weatherCode)}了，想提醒他带伞。`,
      source: 'weather',
      salience: 0.72,
    };
  }
  if (current.temperature >= 35) {
    return {
      key: `weather:heat:${date}`,
      reason: '今天很热，想提醒他别在外面晒太久。',
      source: 'weather',
      salience: 0.62,
    };
  }
  if (current.temperature <= 0) {
    return {
      key: `weather:cold:${date}`,
      reason: '今天很冷，想提醒他多穿一点。',
      source: 'weather',
      salience: 0.62,
    };
  }
  if (prev && current.temperature <= prev.temperature - 5) {
    return {
      key: `weather:cool:${date}`,
      reason: `降温了，从 ${Math.round(prev.temperature)}° 降到 ${Math.round(current.temperature)}°。`,
      source: 'weather',
      salience: 0.66,
    };
  }
  return null;
}

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
}

async function geocode(city: string, signal: AbortSignal): Promise<GeoResult> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const data = await res.json() as { results?: Array<{ latitude?: number; longitude?: number; name?: string }> };
  const hit = data.results?.[0];
  if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') {
    throw new Error('geocode empty');
  }
  return { latitude: hit.latitude, longitude: hit.longitude, name: hit.name || city };
}

/** 查询当前天气；网络失败抛错由调用方静默处理。 */
export async function fetchWeather(city: string, now = new Date()): Promise<WeatherSnapshot> {
  const signal = AbortSignal.timeout(8000);
  const geo = await geocode(city, signal);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}`
    + '&current=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=auto';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const data = await res.json() as {
    current?: {
      temperature_2m?: number;
      precipitation?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  };
  const c = data.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') {
    throw new Error('weather empty');
  }
  return {
    at: now.toISOString(),
    city: geo.name,
    latitude: geo.latitude,
    longitude: geo.longitude,
    temperature: c.temperature_2m,
    precipitation: typeof c.precipitation === 'number' ? c.precipitation : 0,
    weatherCode: c.weather_code,
    windSpeed: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : 0,
  };
}
