import { apiBaseUrl } from '../config.js';
import { secureTokenStore } from '../session/tokens.js';
import { type ApiClient, createApiClient, type SessionEndReason } from './client.js';

// The app's single client instance. Screens never call it: they use the hooks of src/api.

type SessionListener = (reason: SessionEndReason) => void;
const sessionListeners = new Set<SessionListener>();

/** The session context (M2) subscribes here to go back to C-01 with the right message. */
export function onSessionEnded(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

let client: ApiClient | null = null;

/** Null when EXPO_PUBLIC_API_URL is missing or invalid (the start screen says so). */
export function getApiClient(): ApiClient | null {
  if (client) return client;
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return null;
  client = createApiClient({
    baseUrl,
    tokens: secureTokenStore,
    onSessionEnded: (reason) => {
      for (const listener of sessionListeners) listener(reason);
    },
  });
  return client;
}
