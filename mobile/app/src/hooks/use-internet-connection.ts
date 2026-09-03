import { useNetworkState } from "expo-network";

import { isInternetConnectionOffline } from "@/lib/internet-connection";

export function useInternetConnection() {
  const networkState = useNetworkState();
  return {
    isOffline: isInternetConnectionOffline(networkState),
    isResolved: networkState.isInternetReachable !== undefined || networkState.isConnected !== undefined,
  };
}
