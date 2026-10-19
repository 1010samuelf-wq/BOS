// PIN login for any employee (spec §2E). The roster no longer reveals who has
// onboarded, so we discover first-login reactively: on a `pin_not_set` response
// we switch to setup mode, where the employee enters the one-time code an admin
// gave them plus a new PIN.
//
// Admins aren't on the public roster at all (it told anyone which accounts were
// worth guessing), so they choose "Sign in with your name" and type it. And an
// admin's or manager's PIN shorter than 6 digits still checks out once, but
// comes back `pin_change_required`: we switch to change mode and the new PIN
// signs them straight in.

import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ApiRequestError } from "../api/client";
import { fetchRoster, type Who } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";

const MIN_PIN = 6;

type Mode = "login" | "first-login" | "change-pin";

/** The person signing in: picked from the roster, or typed by name. */
interface Person {
  who: Who;
  label: string;
}

export default function Login() {
  const roster = useQuery({ queryKey: ["roster"], queryFn: fetchRoster });
  const { login, changePin, setupPin } = useAuth();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Person | null>(null);
  const [byName, setByName] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [pin, setPin] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setByName(false);
    setTypedName("");
    setMode("login");
    setPin("");
    setOldPin("");
    setConfirmPin("");
    setSetupCode("");
    setError(null);
  };

  const message = (err: unknown) =>
    err instanceof ApiRequestError ? err.message : "Could not reach the server.";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(null);

    if (mode === "first-login" || mode === "change-pin") {
      if (pin.length < MIN_PIN) return setError(`PIN must be at least ${MIN_PIN} digits.`);
      if (pin !== confirmPin) return setError("PINs don't match.");
      if (mode === "first-login" && !setupCode.trim()) {
        return setError("Enter the setup code your admin gave you.");
      }
      setBusy(true);
      try {
        if (mode === "change-pin") {
          await changePin(selected.who, oldPin, pin);
        } else {
          await setupPin(selected.who, pin, setupCode.trim().toUpperCase());
        }
        navigate("/");
      } catch (err) {
        setError(message(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Normal login. If this account hasn't set a PIN, flip into setup mode; if
    // its PIN is too short for its role, flip into change mode.
    setBusy(true);
    try {
      await login(selected.who, pin);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "pin_not_set") {
        setMode("first-login");
        setPin("");
      } else if (err instanceof ApiRequestError && err.code === "pin_change_required") {
        setMode("change-pin");
        setOldPin(pin);
        setPin("");
      } else {
        setError(message(err));
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  };

  const chooseName = (e: FormEvent) => {
    e.preventDefault();
    const name = typedName.trim();
    if (name) setSelected({ who: { name }, label: name });
  };

  const settingPin = mode !== "login";

  return (
    <div className="login">
      <div className="box">
        <img src="/logo.png" alt="Just Cake" className="login-logo" />
        {!selected && !byName ? (
          <>
            <p className="muted">Who's working?</p>
            {roster.isError && <p className="error">Server unreachable.</p>}
            <div className="roster">
              {(roster.data ?? []).map((e) => (
                <button key={e.id} onClick={() => setSelected({ who: { user_id: e.id }, label: e.name })}>
                  <div style={{ fontWeight: 600 }}>{e.name}</div>
                </button>
              ))}
            </div>
            <button type="button" className="btn neutral" style={{ marginTop: 16 }} onClick={() => setByName(true)}>
              Not listed? Sign in with your name
            </button>
          </>
        ) : !selected ? (
          <form onSubmit={chooseName}>
            <p>Type your name as the shop has it</p>
            <input
              className="input"
              autoFocus
              autoComplete="username"
              placeholder="Your name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
            <div className="row" style={{ marginTop: 16 }}>
              <button type="button" className="btn neutral" onClick={reset}>Back</button>
              <button type="submit" className="btn primary" disabled={!typedName.trim()}>Next</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit}>
            <p>
              {mode === "first-login" ? (
                <>Welcome <strong>{selected.label}</strong> — set up your PIN</>
              ) : mode === "change-pin" ? (
                <>
                  <strong>{selected.label}</strong>, your PIN needs to be at least {MIN_PIN} digits now.
                  Choose a new one — use it on the tablets too.
                </>
              ) : (
                <>Enter PIN for <strong>{selected.label}</strong></>
              )}
            </p>
            {mode === "first-login" && (
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
              autoFocus={mode !== "first-login"}
              placeholder={settingPin ? `New PIN (min ${MIN_PIN} digits)` : "PIN"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {settingPin && (
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
                {busy ? "…" : mode === "first-login" ? "Set PIN & log in" : mode === "change-pin" ? "Save PIN & log in" : "Log in"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
