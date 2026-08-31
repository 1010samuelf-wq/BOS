// Customer name field with suggestions from people already on file.
//
// Typing is never blocked: a new customer is just a name nobody has used yet,
// and order-taking cannot stop to manage records. Picking a suggestion fills in
// the phone and usual address, which is the point — it stops the same person
// being re-typed three ways and turning into three customers.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { searchCustomers } from "../api/endpoints";
import type { Customer } from "../api/types";

export default function CustomerPicker({
  name,
  onNameChange,
  onPick,
}: {
  name: string;
  onNameChange: (v: string) => void;
  /** Fired when an existing customer is chosen, so the caller can fill the
   *  rest of the form. */
  onPick: (c: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = name.trim();
  const suggestions = useQuery({
    queryKey: ["customers", "suggest", term],
    queryFn: () => searchCustomers(term),
    // Two characters is where suggestions stop being the whole customer list.
    // `typed` keeps the menu shut when the field was pre-filled (editing an
    // order, or after picking someone) rather than popping open unbidden.
    enabled: open && typed && term.length >= 2,
  });

  // Any click outside closes the menu — without this it hangs over the rest of
  // the form after the field loses focus.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const rows = suggestions.data ?? [];

  return (
    <div className="customer-picker" ref={boxRef}>
      <input
        className="input"
        placeholder="Customer name *"
        value={name}
        autoComplete="off"
        onChange={(e) => {
          onNameChange(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onFocus={() => { if (typed) setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
      />

      {open && typed && term.length >= 2 && rows.length > 0 && (
        <div className="customer-suggest">
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              className="customer-suggest-row"
              onClick={() => {
                onPick(c);
                setOpen(false);
                setTyped(false);   // don't reopen on the refocus that follows
              }}
            >
              <span className="customer-suggest-name">{c.name}</span>
              {c.phone && <span className="muted"> · {c.phone}</span>}
            </button>
          ))}
          <div className="customer-suggest-hint muted">
            Keep typing to add someone new.
          </div>
        </div>
      )}
    </div>
  );
}
