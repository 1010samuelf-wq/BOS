// PIN login for any employee (spec §2E). Employees whose PIN isn't set yet go
// through first-login setup (choose PIN → confirm) right here — the web is now a
// full client, so staff can onboard without a tablet.

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { fetchRoster } from "../api/endpoints";
import type { RosterEntry } from "../api/types";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const { login, setupPin } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setPin("");
    setConfirmPin("");
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);

    if (!selected.pin_set) {
      if (pin.length < 4) return setError("PIN must be at least 4 digits.");
      if (pin !== confirmPin) return setError("PINs don't match.");
    }
    setBusy(true);
    try {
      if (selected.pin_set) await login(selected.id, pin);
      else await setupPin(selected.id, pin);
      navigate("/"); // router redirects to the employee's first allowed section
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not reach the server.");
      setPin("");
      setConfirmPin("");
    } finally {
      setBusy(false);
    }
  };

  const firstLogin = selected && !selected.pin_set;

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
                  <div className="role">{e.role}{!e.pin_set ? " · set your PIN" : ""}</div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>
              {firstLogin
                ? <>Welcome <strong>{selected.name}</strong> — choose a PIN</>
                : <>Enter PIN for <strong>{selected.name}</strong></>}
            </p>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder={firstLogin ? "New PIN (min 4 digits)" : "PIN"}
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
              <button type="submit" className="btn primary" disabled={busy || pin.length < 4}>
                {busy ? "…" : firstLogin ? "Set PIN & log in" : "Log in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
