import { useEffect, useState } from "preact/hooks";
import { communicationUsers, fetchChatUsers } from "../communicationApi";
import { t } from "../i18n";
import { errorMessage, setError } from "../state";
import type { ChatUser, Recipient } from "../communicationState";
export function UserPicker({
  selected,
  onChange,
  admin = false,
  max = 500,
  disabled = false,
}: {
  selected: ChatUser[];
  onChange: (users: ChatUser[]) => void;
  admin?: boolean;
  max?: number;
  disabled?: boolean;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [items, setItems] = useState<(ChatUser | Recipient)[]>([]),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void (
        admin
          ? communicationUsers(q, page, controller.signal)
          : fetchChatUsers(q, page, controller.signal)
      )
        .then((r) => {
          if (!controller.signal.aborted) setItems(r.items);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, page, admin]);
  return (
    <fieldset class="user-picker" disabled={disabled}>
      <legend>{t("com.selectUsers")}</legend>
      <label>
        {t("com.search")}
        <input
          type="search"
          maxLength={100}
          value={q}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setPage(1);
          }}
        />
      </label>
      <div class="picker-selected">
        <span>{t("com.selected", { count: selected.length })}</span>
        {selected.map((user) => (
          <button
            class="button ghost"
            type="button"
            key={user.id}
            onClick={() => onChange(selected.filter((u) => u.id !== user.id))}
          >
            {user.username} ×
          </button>
        ))}
        {selected.length > 0 && (
          <button
            class="button ghost"
            type="button"
            onClick={() => onChange([])}
          >
            {t("com.clear")}
          </button>
        )}
      </div>
      {loading ? (
        <p>{t("detail.loading")}</p>
      ) : items.length ? (
        items.map((user) => (
          <label class="picker-option" key={user.id}>
            <input
              type="checkbox"
              checked={selected.some((u) => u.id === user.id)}
              disabled={
                !selected.some((u) => u.id === user.id) &&
                selected.length >= max
              }
              onChange={(e) =>
                onChange(
                  e.currentTarget.checked
                    ? [...selected, user]
                    : selected.filter((u) => u.id !== user.id),
                )
              }
            />
            <span>
              {user.username}
              {"email" in user && (
                <small>
                  {user.email} ·{" "}
                  {user.isActive ? t("detail.activeYes") : t("detail.activeNo")}
                </small>
              )}
            </span>
          </label>
        ))
      ) : (
        <p>{t("com.emptyUsers")}</p>
      )}
      <div class="pagination">
        <button
          class="button ghost"
          type="button"
          disabled={loading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          {t("users.prev")}
        </button>
        <span>{page}</span>
        <button
          class="button ghost"
          type="button"
          disabled={loading || items.length < 30}
          onClick={() => setPage(page + 1)}
        >
          {t("users.next")}
        </button>
      </div>
    </fieldset>
  );
}
