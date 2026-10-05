import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { notificationState, realtimeStatus } from "../communicationState";
import {
  fetchNotifications,
  notificationAction,
  startCommunicationUpdates,
} from "../communicationApi";
import { sessionState, setError, errorMessage } from "../state";
import { t, localeState } from "../i18n";
export function NotificationCenter() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { route } = useLocation();
  const owner = sessionState.value?.userId;
  useEffect(
    () => (owner ? startCommunicationUpdates(owner) : undefined),
    [owner],
  );
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const list = notificationState.value;
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="notification-center" ref={root}>
      <button
        type="button"
        class="notification-trigger"
        aria-label={t("com.notifications") + ` (${list?.unread ?? 0})`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4" />
        </svg>{" "}
        <span>
          {list?.unread
            ? Math.min(list.unread, 99) + (list.unread > 99 ? "+" : "")
            : ""}
        </span>
      </button>
      {open && (
        <section class="notification-panel" aria-label={t("com.notifications")}>
          <div class="row">
            <h2>{t("com.notifications")}</h2>
            <span class="muted">
              {t(realtimeStatus.value === "online" ? "com.live" : "com.sync")}
            </span>
            <button
              class="button ghost"
              type="button"
              disabled={busy || !list?.unread}
              onClick={() => void run(() => notificationAction(null, "all"))}
            >
              {t("com.readAll")}
            </button>
          </div>
          {!list ? (
            <p>{t("detail.loading")}</p>
          ) : !list.items.length ? (
            <p>{t("com.empty")}</p>
          ) : (
            list.items.map((n) => (
              <article
                key={n.id}
                class={`notification-item severity-${n.severity} ${n.readAt ? "is-read" : ""}`}
              >
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                  <time>
                    {new Date(n.createdAt).toLocaleString(localeState.value)}
                  </time>
                  <div class="rowactions">
                    {!n.readAt && (
                      <button
                        class="button ghost"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => notificationAction(n.id, "read"))
                        }
                      >
                        {t("com.read")}
                      </button>
                    )}
                    {n.actionUrl && (
                      <button
                        class="button ghost"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (!n.readAt)
                              await notificationAction(n.id, "read");
                            setOpen(false);
                            route(n.actionUrl!);
                          })
                        }
                      >
                        {t("com.open")}
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  class="linklike"
                  aria-label={t("com.dismiss")}
                  disabled={busy}
                  onClick={() =>
                    void run(() => notificationAction(n.id, "dismiss"))
                  }
                >
                  ×
                </button>
              </article>
            ))
          )}
          {list && (
            <div class="pagination">
              <button
                class="button ghost"
                disabled={busy || list.page <= 1}
                onClick={() =>
                  void run(() => fetchNotifications(list.page - 1))
                }
              >
                {t("users.prev")}
              </button>
              <span>
                {list.page} / {Math.max(1, Math.ceil(list.total / list.limit))}
              </span>
              <button
                class="button ghost"
                disabled={busy || list.page * list.limit >= list.total}
                onClick={() =>
                  void run(() => fetchNotifications(list.page + 1))
                }
              >
                {t("users.next")}
              </button>
            </div>
          )}
          <a href="/chat" onClick={() => setOpen(false)}>
            {t("com.chat")}
          </a>
        </section>
      )}
    </div>
  );
}
