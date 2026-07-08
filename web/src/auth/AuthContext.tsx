// Session state for the dashboard. Same PIN login as the tablets; token in
// localStorage. HTTPS-only in production (spec §6).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { setAuthToken } from "../api/client";
import * as api from "../api/endpoints";
import type { Role } from "../api/types";

interface SessionUser {
  id: number;
  name: string;
  role: Role;
  token: string;
  sections: string[]; // which nav sections this employee may access
}
interface AuthValue {
  user: SessionUser | null;
  ready: boolean;
  login: (userId: number, pin: string) => Promise<void>;
  setupPin: (userId: number, pin: string, setupCode: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const KEY = "bos.web.session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as SessionUser;
      setAuthToken(s.token);
      setUser(s);
    }
    setReady(true);
  }, []);

  const login = useCallback(async (userId: number, pin: string) => {
    const out = await api.login(userId, pin);
    const s: SessionUser = { id: out.user_id, name: out.name, role: out.role, token: out.access_token, sections: out.sections };
    setAuthToken(s.token);
    setUser(s);
    localStorage.setItem(KEY, JSON.stringify(s));
  }, []);

  const setupPin = useCallback(
    async (userId: number, pin: string, setupCode: string) => {
      await api.setPin(userId, pin, setupCode); // first-login setup, then straight in
      await login(userId, pin);
    },
    [login],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    localStorage.removeItem(KEY);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, setupPin, logout }),
    [user, ready, login, setupPin, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
