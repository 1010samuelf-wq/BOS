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

/** What a page shows when its data couldn't be fetched.
 *
 * Worth a shared component because the alternative is worse than it looks:
 * a failed query leaves `isLoading` false and `data` undefined, so a page
 * that only branches on loading draws its empty shell and nothing else. The
 * person gets a blank card with no hint whether the list is genuinely empty
 * or the screen is broken — which is exactly how this was reported ("the
 * notifications dosent load at all"). Say so, and offer the retry.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div className="load-failed">
      <p className="error">Couldn't load {what}.</p>
      <p className="muted" style={{ fontSize: 13 }}>
        Nothing is lost — this is just this screen. Try again in a moment.
      </p>
      {onRetry && (
        <button className="btn neutral sm" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
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
