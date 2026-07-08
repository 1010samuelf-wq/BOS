import type { ReactNode } from "react";

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="spacer" />
      {children}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}

export function ErrorMsg({ children }: { children: ReactNode }) {
  return <p className="error">{children}</p>;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.key} className={`tab${value === o.key ? " active" : ""}`} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function stockTone(quantity: string, isLow: boolean | null): string {
  if (parseFloat(quantity) < 0) return "tone-neg";
  if (isLow) return "tone-low";
  return "tone-ok";
}
