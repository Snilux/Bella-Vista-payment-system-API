import { focusManager, onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

// Connectivity (3.2 §2): Expo's network state drives TanStack Query's onlineManager, so queries
// pause without signal and reload when it comes back, and the "Sin conexión" notice shows.
// Coming back to the app (AppState "active") counts as focus: what is older than 30 s reloads,
// so the president sees the requests and the treasurer the handovers that arrived meanwhile (M9).

/** isInternetReachable can be null while unknown: only a definite "no" counts as offline. */
export function isOnline(state: Network.NetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/** Connects expo-network to onlineManager and AppState to focusManager, once, at the root. */
export function connectNetworkToQueries(): void {
  onlineManager.setEventListener((setOnline) => {
    Network.getNetworkStateAsync()
      .then((state) => setOnline(isOnline(state)))
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => setOnline(isOnline(state)));
    return () => subscription.remove();
  });
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) =>
      setFocused(status === 'active'),
    );
    return () => subscription.remove();
  });
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
