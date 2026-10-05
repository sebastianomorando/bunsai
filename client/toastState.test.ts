import { afterEach, describe, expect, test } from "bun:test";
import {
  clearToasts,
  dismissToast,
  pushToast,
  toastsState,
} from "./toastState";
afterEach(clearToasts);
describe("bounded toast state", () => {
  test("deduplicates errors, bounds the queue and supports manual dismissal", () => {
    pushToast("error", "same");
    pushToast("error", "same");
    expect(toastsState.value.length).toBe(1);
    for (let i = 0; i < 20; i++) pushToast("info", "notice " + i);
    expect(toastsState.value.length).toBe(8);
    const id = toastsState.value[0]!.id;
    dismissToast(id);
    expect(toastsState.value.some((t) => t.id === id)).toBe(false);
  });
  test("null clears only its kind and logout can clear all kinds", () => {
    pushToast("success", "saved");
    pushToast("error", "failed");
    pushToast("success", null);
    expect(toastsState.value.map((t) => t.kind)).toEqual(["error"]);
    clearToasts();
    expect(toastsState.value).toEqual([]);
  });
});
