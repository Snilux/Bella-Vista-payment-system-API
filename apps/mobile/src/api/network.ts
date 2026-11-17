import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';

// Connectivity (3.2 §2): Expo's network state drives TanStack Query's onlineManager, so queries
// pause without signal and reload when it comes back, and the "Sin conexión" notice shows.

/** isInternetReachable can be null while unknown: only a definite "no" counts as offline. */
export function isOnline(state: Network.NetworkState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/** Connects expo-network to onlineManager once, at the root layout. */
export function connectNetworkToQueries(): void {
  onlineManager.setEventListener((setOnline) => {
    Network.getNetworkStateAsync()
      .then((state) => setOnline(isOnline(state)))
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => setOnline(isOnline(state)));
    return () => subscription.remove();
  });
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
