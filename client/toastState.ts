import { signal } from "@preact/signals";
export type ToastKind = "success" | "error" | "info" | "warning" | "critical";
export type Toast = { id: number; kind: ToastKind; message: string };
export const toastsState = signal<Toast[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let sequence = 0;
export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toastsState.value = toastsState.value.filter((t) => t.id !== id);
}
export function pushToast(kind: ToastKind, message: string | null) {
  if (!message) {
    toastsState.value
      .filter((t) => t.kind === kind)
      .forEach((t) => dismissToast(t.id));
    return;
  }
  if (toastsState.value.some((t) => t.kind === kind && t.message === message))
    return;
  while (toastsState.value.length >= 8) dismissToast(toastsState.value[0]!.id);
  const id = ++sequence;
  toastsState.value = [...toastsState.value, { id, kind, message }];
  if (kind !== "error" && kind !== "critical")
    timers.set(
      id,
      setTimeout(() => dismissToast(id), kind === "success" ? 5000 : 8000),
    );
}
export function clearToasts() {
  for (const t of toastsState.value) dismissToast(t.id);
}
