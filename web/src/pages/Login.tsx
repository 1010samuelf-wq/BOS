// PIN login for any employee (spec §2E). The roster no longer reveals who has
// onboarded, so we discover first-login reactively: on a `pin_not_set` response
// we switch to setup mode, where the employee enters the one-time code an admin
// gave them plus a new PIN.

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { fetchRoster } from "../api/endpoints";
import type { RosterEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";

const MIN_PIN = 6;

export default function Login() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const { login, setupPin } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [firstLogin, setFirstLogin] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setFirstLogin(false);
    setPin("");
    setConfirmPin("");
    setSetupCode("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);

    if (firstLogin) {
      if (pin.length < MIN_PIN) return setError(`PIN must be at least ${MIN_PIN} digits.`);
      if (pin !== confirmPin) return setError("PINs don't match.");
      if (!setupCode.trim()) return setError("Enter the setup code your admin gave you.");
      setBusy(true);
      try {
        await setupPin(selected.id, pin, setupCode.trim().toUpperCase());
        navigate("/");
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : "Could not reach the server.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // Normal login. If this account hasn't set a PIN, flip into setup mode.
    setBusy(true);
    try {
      await login(selected.id, pin);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "pin_not_set") {
        setFirstLogin(true);
        setPin("");
        setError(null);
      } else {
        setError(err instanceof ApiRequestError ? err.message : "Could not reach the server.");
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="box">
        <img src="/logo.png" alt="Just Cake" className="login-logo" />
        {!selected ? (
          <>
            <p className="muted">Who's working?</p>
            {roster.isError && <p className="error">Server unreachable.</p>}
            <div className="roster">
              {(roster.data ?? []).map((e) => (
                <button key={e.id} onClick={() => setSelected(e)}>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                  <div className="role">{e.role}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>
              {firstLogin
                ? <>Welcome <strong>{selected.name}</strong> — set up your PIN</>
                : <>Enter PIN for <strong>{selected.name}</strong></>}
            </p>
            {firstLogin && (
              <input
                className="input"
                autoFocus
                placeholder="Setup code from your admin"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                style={{ marginBottom: 8, textTransform: "uppercase" }}
              />
            )}
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoFocus={!firstLogin}
              placeholder={firstLogin ? `New PIN (min ${MIN_PIN} digits)` : "PIN"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {firstLogin && (
              <input
                className="input"
                type="password"
                inputMode="numeric"
                placeholder="Confirm PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
              />
            )}
            {error && <p className="error">{error}</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn neutral" onClick={reset}>Back</button>
              <button type="submit" className="btn primary" disabled={busy || pin.length < 1}>
                {busy ? "…" : firstLogin ? "Set PIN & log in" : "Log in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
