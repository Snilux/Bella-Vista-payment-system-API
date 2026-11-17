import { apiBaseUrl } from '../config.js';
import { sessionStore } from '../session/session-store.js';
import { secureTokenStore } from '../session/tokens.js';
import { type ApiClient, createApiClient } from './client.js';

// The app's single client instance. Screens never call it: they use the hooks of src/api.
// When the client ends the session (or the API asks for the new password) it tells the session
// state, and the layouts send the person to C-01 (with the reason) or to C-02.

let client: ApiClient | null = null;

/** Null when EXPO_PUBLIC_API_URL is missing or invalid (C-01 says so). */
export function getApiClient(): ApiClient | null {
  if (client) return client;
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  client = createApiClient({
    baseUrl,
    tokens: secureTokenStore,
    onSessionEnded: (reason) => sessionStore.signedOut(reason),
    onPasswordChangeRequired: () => sessionStore.passwordChangeRequired(),
  });
  return client;
}
