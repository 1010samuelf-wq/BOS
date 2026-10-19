// Session state for the dashboard. Same PIN login as the tablets; token in
// localStorage. HTTPS-only in production (spec §6).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { setAuthToken, setUnauthorizedHandler } from "../api/client";
import * as api from "../api/endpoints";
import type { Role, TokenOut } from "../api/types";

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
  login: (who: api.Who, pin: string) => Promise<void>;
  changePin: (who: api.Who, currentPin: string, newPin: string) => Promise<void>;
  setupPin: (who: api.Who, pin: string, setupCode: string) => Promise<void>;
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

  const start = useCallback((out: TokenOut) => {
    const s: SessionUser = { id: out.user_id, name: out.name, role: out.role, token: out.access_token, sections: out.sections };
    setAuthToken(s.token);
    setUser(s);
    localStorage.setItem(KEY, JSON.stringify(s));
  }, []);

  const login = useCallback(
    async (who: api.Who, pin: string) => start(await api.login(who, pin)),
    [start],
  );

  // An admin's or manager's PIN that's too short: swapping it signs them in.
  const changePin = useCallback(
    async (who: api.Who, currentPin: string, newPin: string) =>
      start(await api.changePin(who, currentPin, newPin)),
    [start],
  );

  const setupPin = useCallback(
    async (who: api.Who, pin: string, setupCode: string) => {
      await api.setPin(who, pin, setupCode); // first-login setup, then straight in
      await login(who, pin);
    },
    [login],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    localStorage.removeItem(KEY);
  }, []);

  // Any 401 (expired/invalid shift token) drops straight back to login,
  // instead of leaving the app stuck on a stale "not connected" state.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = useMemo(
    () => ({ user, ready, login, changePin, setupPin, logout }),
    [user, ready, login, changePin, setupPin, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
