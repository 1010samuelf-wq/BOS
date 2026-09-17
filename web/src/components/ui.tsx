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

/** An on/off control that looks like one.
 *
 * The shop asked for this outright — "every switch should really look like a
 * switch". A pair of Activate/Deactivate buttons makes you read the label to
 * work out which way round you are; a switch shows the state itself, and the
 * label only names what it controls.
 *
 * `confirm` is for the ones with consequences beyond the screen — turning an
 * employee off signs them out of the shop — since a switch is easier to hit by
 * accident than a button you had to read first.
 */
export function Switch({
  checked, onChange, label, title, confirm, disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  title?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => {
          if (confirm && !window.confirm(confirm)) return;
          onChange(!checked);
        }}
      />
      <span className="switch-track"><span className="switch-thumb" /></span>
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}

/** A query with nothing to show that isn't doing anything about it.
 *
 * `isError` is not enough on its own. React Query pauses a retry whenever the
 * document is unfocused *or* its onlineManager thinks we're offline — in
 * retryer.ts the condition is
 *
 *   focusManager.isFocused() && (networkMode === "always" || onlineManager.isOnline())
 *
 * so `networkMode: "always"` only removes one of the two triggers. A paused
 * query reports status "pending" with fetchStatus "paused", which means
 * isLoading is false, isError is false, and data is undefined all at once. A
 * page branching on isLoading alone then draws an empty list, and an empty list
 * is indistinguishable from "you have nothing" — which is how this reached us,
 * as "the notifications dosent load at all".
 *
 * Only "paused" is treated as stalled, not any idle-with-no-data state: a query
 * can be idle for a frame before its first fetch starts, and flashing an error
 * there would be its own bug.
 */
export function isStalled(q: {
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  data: unknown;
}): boolean {
  return q.isError || (q.data === undefined && q.fetchStatus === "paused");
}

/** A switch between two named things, rather than on and off.
 *
 * Charge-or-payment is binary but neither side is "off", so a plain Switch
 * would be a riddle: which position means payment? This shows both words with
 * the thumb sliding under the chosen one — the same physical control, reading
 * as a choice instead of a state.
 */
export function SwitchChoice<T extends string>({
  value, options, onChange, title,
}: {
  value: T;
  options: readonly [{ key: T; label: string }, { key: T; label: string }];
  onChange: (next: T) => void;
  title?: string;
}) {
  const index = options.findIndex((o) => o.key === value);
  return (
    <div
      className="switch-choice"
      role="group"
      title={title}
      data-active={index === 1 ? "right" : "left"}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`switch-choice-opt${o.key === value ? " is-on" : ""}`}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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
