import "server-only";
import { headers } from "next/headers";

// Open-Meteo: free, no API key, fine for a dashboard garnish. Location
// comes from Vercel's per-request geo headers (the visitor's own city),
// falling back to Dublin when absent (local dev, unknown IPs). Cached for
// 30 minutes per rounded coordinate via Next's fetch cache. Any failure
// returns null — the dashboard must never break or slow down because a
// weather API hiccuped.

const FALLBACK = { latitude: 53.35, longitude: -6.26, city: "Dublin" };

const WEATHER_LABELS: [number[], string, string][] = [
  [[0], "☀️", "Clear"],
  [[1, 2], "🌤️", "Partly cloudy"],
  [[3], "☁️", "Cloudy"],
  [[45, 48], "🌫️", "Foggy"],
  [[51, 53, 55, 56, 57], "🌦️", "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Rain"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Snow"],
  [[95, 96, 99], "⛈️", "Thunderstorm"],
];

export type Weather = {
  emoji: string;
  label: string;
  tempC: number;
  city: string;
};

export async function getLocalWeather(): Promise<Weather | null> {
  try {
    const h = await headers();
    const latitude = parseFloat(h.get("x-vercel-ip-latitude") ?? "");
    const longitude = parseFloat(h.get("x-vercel-ip-longitude") ?? "");
    const rawCity = h.get("x-vercel-ip-city");
    const hasGeo = Number.isFinite(latitude) && Number.isFinite(longitude);

    const loc = hasGeo
      ? {
          // Round to ~10km so nearby users share a cache entry.
          latitude: Math.round(latitude * 10) / 10,
          longitude: Math.round(longitude * 10) / 10,
          city: rawCity ? decodeURIComponent(rawCity) : "your area",
        }
      : FALLBACK;

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (typeof temp !== "number" || typeof code !== "number") return null;

    const match = WEATHER_LABELS.find(([codes]) => codes.includes(code));
    return {
      emoji: match?.[1] ?? "🌤️",
      label: match?.[2] ?? "Mixed",
      tempC: Math.round(temp),
      city: loc.city,
    };
  } catch {
    return null;
  }
}

export function greetingForNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IE", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Dublin",
    }).format(new Date())
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
