import { z } from 'zod';

// App configuration from EXPO_PUBLIC_* variables (3.2 §3.4). They travel inside the app: never
// put secrets here. Expo inlines process.env.EXPO_PUBLIC_* at build time, so each variable must
// be read with its full name.

const apiUrlSchema = z.url({
  protocol: /^https?$/,
  error: 'EXPO_PUBLIC_API_URL must be an http(s) URL',
});

/**
 * API root without /v1 (the client adds it; /health lives outside it), e.g.
 * http://192.168.1.20:3000 for a phone on the same Wi-Fi or http://10.0.2.2:3000 for the
 * Android emulator.
 */
export function apiBaseUrl(): string | null {
  const parsed = apiUrlSchema.safeParse(process.env.EXPO_PUBLIC_API_URL);
  return parsed.success ? parsed.data.replace(/\/+$/, '') : null;
}
