import { useCallback, useSyncExternalStore } from "react";

export type OrderFormView = "classic" | "new";

const KEY = "bos.orderFormView";
// Everyone starts on the form they already know. The new one is opt-in, and
// stays chosen once someone picks it.
const DEFAULT: OrderFormView = "classic";

/** Subscribers in *this* tab.
 *
 * localStorage's `storage` event only fires in OTHER tabs, so a plain
 * useState-per-hook version leaves two components in the same page disagreeing:
 * the switch writes the new value, and the component deciding which form to
 * render never hears about it. This is exactly that bug, fixed by keeping one
 * source of truth everything subscribes to.
 */
const listeners = new Set<() => void>();

function read(): OrderFormView {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "new" || saved === "classic" ? saved : DEFAULT;
  } catch {
    return DEFAULT; // private mode / storage disabled
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Other tabs still count — switching on one screen shouldn't leave a second
  // one showing the other form.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setOrderFormView(view: OrderFormView): void {
  try { localStorage.setItem(KEY, view); } catch { /* preference just won't persist */ }
  for (const notify of listeners) notify();
}

/** Which order form this device uses.
 *
 * Kept in localStorage rather than on the user record on purpose: it's a
 * preference about *this screen*, and the counter tablet and the office laptop
 * can reasonably want different answers. Switching is instant, with no request
 * to wait on.
 */
export function useOrderFormView(): [OrderFormView, (v: OrderFormView) => void] {
  const view = useSyncExternalStore(subscribe, read, () => DEFAULT);
  const choose = useCallback((v: OrderFormView) => setOrderFormView(v), []);
  return [view, choose];
}
