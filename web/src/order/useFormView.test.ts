import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setOrderFormView, useOrderFormView } from "./useFormView";

const KEY = "bos.orderFormView";

describe("order form view preference", () => {
  beforeEach(() => localStorage.clear());

  it("starts on the form people already know", () => {
    const { result } = renderHook(() => useOrderFormView());
    expect(result.current[0]).toBe("classic");
  });

  it("remembers a choice", () => {
    const { result } = renderHook(() => useOrderFormView());
    act(() => result.current[1]("new"));
    expect(result.current[0]).toBe("new");
    expect(localStorage.getItem(KEY)).toBe("new");
  });

  it("reads a saved choice on first render", () => {
    localStorage.setItem(KEY, "new");
    const { result } = renderHook(() => useOrderFormView());
    expect(result.current[0]).toBe("new");
  });

  it("ignores a junk value rather than rendering nothing", () => {
    localStorage.setItem(KEY, "sideways");
    const { result } = renderHook(() => useOrderFormView());
    expect(result.current[0]).toBe("classic");
  });

  /** The bug this file exists for.
   *
   * The first version held the value in a per-hook useState, so the switch in
   * the page header and the component deciding which form to render each had
   * their own copy. Flipping the switch wrote "new" to storage and the chooser
   * never heard about it — the control moved and the form didn't. */
  it("keeps every caller in the same tab in step", () => {
    const chooser = renderHook(() => useOrderFormView());
    const theSwitch = renderHook(() => useOrderFormView());

    act(() => theSwitch.result.current[1]("new"));

    expect(theSwitch.result.current[0]).toBe("new");
    expect(chooser.result.current[0]).toBe("new");
  });

  it("updates callers when the value is set outside React", () => {
    const { result } = renderHook(() => useOrderFormView());
    act(() => setOrderFormView("new"));
    expect(result.current[0]).toBe("new");
  });

  it("switches back", () => {
    const { result } = renderHook(() => useOrderFormView());
    act(() => result.current[1]("new"));
    act(() => result.current[1]("classic"));
    expect(result.current[0]).toBe("classic");
    expect(localStorage.getItem(KEY)).toBe("classic");
  });
});
