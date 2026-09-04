import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";

import { isInternetConnectionOffline } from "@/lib/internet-connection";

export function useInternetConnection() {
  const [connection, setConnection] = useState({ isOffline: false, isResolved: false });
  const generation = useRef(0);

  useEffect(() => {
    let active = AppState.currentState === "active";
    let negativeConfirmation: ReturnType<typeof setTimeout> | undefined;

    const clearConfirmation = () => {
      if (negativeConfirmation) clearTimeout(negativeConfirmation);
      negativeConfirmation = undefined;
    };
    const apply = (networkState: NetworkState, token: number, confirmed = false) => {
      if (!active || token !== generation.current) return;
      const resolved = networkState.isInternetReachable !== undefined || networkState.isConnected !== undefined;
      if (!resolved) return;
      if (!isInternetConnectionOffline(networkState)) {
        clearConfirmation();
        setConnection({ isOffline: false, isResolved: true });
        return;
      }
      if (confirmed) {
        setConnection({ isOffline: true, isResolved: true });
        return;
      }
      clearConfirmation();
      negativeConfirmation = setTimeout(() => {
        const confirmationToken = ++generation.current;
        void getNetworkStateAsync()
          .then((fresh) => apply(fresh, confirmationToken, true))
          .catch(() => undefined);
      }, 750);
    };
    const refresh = () => {
      clearConfirmation();
      const token = ++generation.current;
      setConnection((current) => ({ isOffline: false, isResolved: current.isResolved }));
      void getNetworkStateAsync()
        .then((networkState) => apply(networkState, token))
        .catch(() => undefined);
    };

    const networkSubscription = addNetworkStateListener((networkState) => {
      if (!active) return;
      const token = ++generation.current;
      apply(networkState, token);
    });
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      active = nextState === "active";
      generation.current += 1;
      clearConfirmation();
      if (active) refresh();
      else setConnection((current) => ({ isOffline: false, isResolved: current.isResolved }));
    });
    if (active) refresh();

    return () => {
      active = false;
      generation.current += 1;
      clearConfirmation();
      networkSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return connection;
}
