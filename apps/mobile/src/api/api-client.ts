// @bella-vista/mobile/api-client: the app's HTTP client for code outside the app (the API's
// integration tests run it against the real API). It imports nothing from Expo or React
// Native: the token store and fetch are injected (createApiClient options). Re-exports only.

export * from './client.js';
// What the person reads for each API error (no Expo imports either).
export { describeError } from './error-messages.js';
export * from './errors.js';
