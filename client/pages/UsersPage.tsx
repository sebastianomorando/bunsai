import { useLocation } from "preact-iso";
import { useEffect } from "preact/hooks";
import { fetchUsers } from "../api.ts";
import { t } from "../i18n.ts";
import { errorMessage, pendingState, sessionState, setError, usersState } from "../state.ts";
import type { SortDirection, UserSortBy } from "../types.ts";

export function UsersPage() {
  const { route } = useLocation();

  useEffect(() => {
    if (!sessionState.value) return;
    void fetchUsers(1, usersState.value.limit).catch((error) => setError(errorMessage(error)));
  }, [sessionState.value?.userId]);

  if (!sessionState.value) {
    return (
      <div class="panel">
        <h2>{t("users.authRequiredTitle")}</h2>
        <p>{t("users.authRequiredText")}</p>
        <a class="button" href="/login">
          {t("users.goToLogin")}
        </a>
      </div>
    );
  }

  const usersPage = usersState.value;

  return (
    <div class="panel">
      <div class="row">
        <h2>{t("users.title")}</h2>
        <div class="rowactions">
          <label class="limitcontrol">
            {t("users.sortBy")}
            <select
              value={usersPage.sortBy}
              onChange={(event) => {
                const nextSortBy = (event.target as HTMLSelectElement).value as UserSortBy;
                void fetchUsers(1, usersPage.limit, nextSortBy, usersPage.sortDir).catch(
                  (error) => setError(errorMessage(error))
                );
              }}
            >
              <option value="date_created">{t("users.sortBy.date_created")}</option>
              <option value="username">{t("users.sortBy.username")}</option>
              <option value="email">{t("users.sortBy.email")}</option>
              <option value="role">{t("users.sortBy.role")}</option>
              <option value="is_active">{t("users.sortBy.is_active")}</option>
            </select>
          </label>
          <label class="limitcontrol">
            {t("users.direction")}
            <select
              value={usersPage.sortDir}
              onChange={(event) => {
                const nextSortDir = (event.target as HTMLSelectElement).value as SortDirection;
                void fetchUsers(1, usersPage.limit, usersPage.sortBy, nextSortDir).catch(
                  (error) => setError(errorMessage(error))
                );
              }}
            >
              <option value="desc">{t("users.direction.desc")}</option>
              <option value="asc">{t("users.direction.asc")}</option>
            </select>
          </label>
          <button
            type="button"
            class="button ghost"
            onClick={() => {
              void fetchUsers(
                usersPage.page,
                usersPage.limit,
                usersPage.sortBy,
                usersPage.sortDir
              ).catch((error) => setError(errorMessage(error)));
            }}
          >
            {t("users.refresh")}
          </button>
        </div>
      </div>
      <p class="muted">
        {t("users.pageSummary", {
          page: usersPage.page,
          totalPages: usersPage.totalPages,
          total: usersPage.total,
        })}
      </p>

      {usersPage.items.length === 0 ? (
        <p>{t("users.empty")}</p>
      ) : (
        <ul class="userlist">
          {usersPage.items.map((user) => (
            <li key={user.id ?? `${user.username}-row`} class="userrow">
              <div>
                <strong>{user.username || t("users.unnamed")}</strong>
                <p>{user.email || t("users.noEmail")}</p>
              </div>
              <button
                type="button"
                class="button"
                onClick={() => {
                  if (user.id) route(`/users/${user.id}`);
                }}
                disabled={!user.id}
              >
                {t("users.detail")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div class="pagination">
        <button
          type="button"
          class="button ghost"
          disabled={pendingState.value || usersPage.page <= 1}
          onClick={() => {
            void fetchUsers(
              usersPage.page - 1,
              usersPage.limit,
              usersPage.sortBy,
              usersPage.sortDir
            ).catch((error) => setError(errorMessage(error)));
          }}
        >
          {t("users.prev")}
        </button>
        <button
          type="button"
          class="button ghost"
          disabled={pendingState.value || usersPage.page >= usersPage.totalPages}
          onClick={() => {
            void fetchUsers(
              usersPage.page + 1,
              usersPage.limit,
              usersPage.sortBy,
              usersPage.sortDir
            ).catch((error) => setError(errorMessage(error)));
          }}
        >
          {t("users.next")}
        </button>
        <label class="limitcontrol">
          {t("users.perPage")}
          <select
            value={String(usersPage.limit)}
            onChange={(event) => {
              const nextLimit = Number((event.target as HTMLSelectElement).value);
              void fetchUsers(1, nextLimit, usersPage.sortBy, usersPage.sortDir).catch((error) =>
                setError(errorMessage(error))
              );
            }}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
          </select>
        </label>
      </div>
    </div>
  );
}
