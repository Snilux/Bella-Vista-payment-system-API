import type { SessionResponse } from '@bella-vista/shared';
import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '../api/client.js';
import { sessionStore } from './session-store.js';

// Session tokens (3.2 §3.2): the access token (15 min) only in memory; the refresh token
// (30 days) in the phone's secure store, so opening the app refreshes without the password.
// Saving a session also publishes its account to the session state.

const REFRESH_TOKEN_KEY = 'bella-vista.refresh-token';

let accessToken: string | null = null;

export const secureTokenStore: TokenStore = {
  getAccessToken: () => accessToken,
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  async save(session: SessionResponse) {
    accessToken = session.accessToken;
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
    sessionStore.signedIn(session.account);
  },
  async clear() {
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
