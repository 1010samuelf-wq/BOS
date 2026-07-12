// Session state: who is logged in on this shared shift device. Token lives in
// AsyncStorage (spec §6 explicitly drops local encrypted storage — no offline
// data to protect) and is re-validated by the server on every request anyway.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { setAuthToken } from "../api/client";
import * as endpoints from "../api/endpoints";
import type { Role } from "../api/types";

interface SessionUser {
  id: number;
  name: string;
  role: Role;
  token: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean; // storage hydration finished
  login: (userId: number, pin: string) => Promise<void>;
  setupPin: (userId: number, pin: string, setupCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "bos.session";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const stored = JSON.parse(raw) as SessionUser;
          setAuthToken(stored.token);
          setUser(stored);
        }
      })
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (userId: number, pin: string) => {
    const out = await endpoints.login(userId, pin);
    const session: SessionUser = {
      id: out.user_id,
      name: out.name,
      role: out.role,
      token: out.access_token,
    };
    setAuthToken(session.token);
    setUser(session);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  const setupPin = useCallback(
    async (userId: number, pin: string, setupCode: string) => {
      await endpoints.setPin(userId, pin, setupCode);
      await login(userId, pin); // straight into a session after first setup
    },
    [login],
  );

  const logout = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, setupPin, logout }),
    [user, ready, login, setupPin, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
