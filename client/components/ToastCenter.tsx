import { dismissToast, toastsState } from "../toastState";
import { t } from "../i18n";
export function ToastCenter() {
  return (
    <div class="toast-stack" aria-label={t("com.toasts")}>
      {toastsState.value.map((toast) => (
        <div
          key={toast.id}
          class={`toast toast-${toast.kind}`}
          role={
            toast.kind === "error" || toast.kind === "critical"
              ? "alert"
              : "status"
          }
        >
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label={t("com.dismiss")}
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
