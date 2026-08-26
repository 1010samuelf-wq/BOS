// Connectivity signal for offline mode (spec: bakery-floor offline mode).
// Three inputs feed one effective state:
//  - real device connectivity (NetInfo)
//  - the existing WebSocket link (RealtimeProvider) — a live push channel,
//    not required for reads/writes to work, just for instant cross-device nudges
//  - a manual "Work offline" override the user can flip from the side rail,
//    independent of actual connectivity (testing, or choosing to batch up
//    work rather than sync continuously)
//
// `isOffline` is what the rest of the app should branch on: true only when
// there's genuinely no way to reach the API (device offline, or the manual
// override is on). A dead WebSocket alone does NOT mean offline — reads and
// writes still go over plain HTTP; only live push is missing until it
// reconnects (handled transparently by RealtimeProvider's own retry loop).

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { useRealtime } from "../realtime/RealtimeProvider";

const MANUAL_OVERRIDE_KEY = "bos.manual-offline";

interface ConnectivityContextValue {
  isOffline: boolean;
  netConnected: boolean;
  wsConnected: boolean;
  manualOffline: boolean;
  setManualOffline: (v: boolean) => void;
}

const ConnectivityContext = createContext<ConnectivityContextValue>({
  isOffline: false,
  netConnected: true,
  wsConnected: true,
  manualOffline: false,
  setManualOffline: () => {},
});

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const { online: wsConnected } = useRealtime();
  const [netConnected, setNetConnected] = useState(true);
  const [manualOffline, setManualOfflineState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(MANUAL_OVERRIDE_KEY)
      .then((raw) => setManualOfflineState(raw === "1"))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // `isConnected` is the has-a-link signal (wifi/cell associated);
      // `isInternetReachable` can be null while NetInfo is still probing —
      // treat "not yet known" as connected rather than flashing offline on
      // every cold start.
      setNetConnected(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  const setManualOffline = (v: boolean) => {
    setManualOfflineState(v);
    void AsyncStorage.setItem(MANUAL_OVERRIDE_KEY, v ? "1" : "0");
  };

  const isOffline = !hydrated ? false : manualOffline || !netConnected;

  return (
    <ConnectivityContext.Provider
      value={{ isOffline, netConnected, wsConnected, manualOffline, setManualOffline }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}

export const useConnectivity = () => useContext(ConnectivityContext);
