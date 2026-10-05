import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { t, localeState, formatRole } from "../i18n";
import {
  detailState,
  errorMessage,
  profileState,
  sessionState,
  resetUsersState,
  setError,
  setNotice,
} from "../state";
import * as api from "../userAdminApi";
import type {
  AccountInput,
  ManagedUser,
  ManagedSession,
  Invitation,
  Page,
} from "../userAdminApi";

const admin = () =>
  profileState.value?.role === "admin" && profileState.value.isActive;
const fail = (error: unknown) => setError(errorMessage(error));
const date = (value: string) =>
  new Date(value).toLocaleString(localeState.value);
function endSession() {
  sessionState.value = null;
  resetUsersState();
}
function AccountFields({
  value,
  change,
  self = false,
}: {
  value: AccountInput;
  change: (value: AccountInput) => void;
  self?: boolean;
}) {
  return (
    <>
      <label>
        {t("detail.username")}
        <input
          required
          minLength={3}
          maxLength={255}
          autoComplete="username"
          value={value.username}
          onInput={(e) => change({ ...value, username: e.currentTarget.value })}
        />
      </label>
      <label>
        {t("detail.email")}
        <input
          required
          type="email"
          maxLength={255}
          autoComplete="email"
          value={value.email}
          onInput={(e) => change({ ...value, email: e.currentTarget.value })}
        />
      </label>
      <label>
        {t("adminUsers.role")}
        <select
          disabled={self}
          value={value.role}
          onChange={(e) => change({ ...value, role: e.currentTarget.value })}
        >
          <option value="user">{formatRole("user")}</option>
          <option value="admin">{formatRole("admin")}</option>
        </select>
      </label>
      <label class="checklabel">
        <input
          type="checkbox"
          disabled={self}
          checked={value.isActive}
          onChange={(e) =>
            change({ ...value, isActive: e.currentTarget.checked })
          }
        />
        {t("adminUsers.active")}
      </label>
    </>
  );
}
export function CreateUserPage() {
  const { route } = useLocation();
  const [value, change] = useState<AccountInput>({
    username: "",
    email: "",
    role: "user",
    isActive: true,
  });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  if (!admin()) return <p class="panel">{t("database.adminOnly")}</p>;
  return (
    <section class="panel authpanel">
      <h2>{t("adminUsers.create")}</h2>
      <form
        class="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            const result = await api.createUser({ ...value, password });
            setPassword("");
            setNotice(t("adminUsers.saved"));
            route(`/users/${result.user.id}`);
          } catch (error) {
            fail(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        <AccountFields value={value} change={change} />
        <label>
          {t("adminUsers.password")}
          <input
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>
        <button class="button" disabled={busy}>
          {t("adminUsers.create")}
        </button>
        <a href="/users">{t("detail.backToList")}</a>
      </form>
    </section>
  );
}
export function AdminUserEditor({ id }: { id: string }) {
  const [detail, setDetail] = useState<ManagedUser | null>(null);
  const [value, change] = useState<AccountInput | null>(null);
  const [sessions, setSessions] = useState<Page<ManagedSession> | null>(null);
  const [busy, setBusy] = useState(false);
  const { route } = useLocation();
  const apply = (result: ManagedUser) => {
    setDetail(result);
    detailState.value = result.user;
    change({
      username: result.user.username ?? "",
      email: result.user.email ?? "",
      role: result.user.role ?? "user",
      isActive: result.user.isActive ?? false,
    });
  };
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.managedUser(id, controller.signal),
      api.userSessions(id, 1, controller.signal),
    ])
      .then(([user, list]) => {
        if (!controller.signal.aborted) {
          apply(user);
          setSessions(list);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      });
    return () => controller.abort();
  }, [id]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const revoke = (session?: string) => {
    if (!confirm(t("adminUsers.confirmRevoke"))) return;
    void run(async () => {
      const result = await api.revokeUserSessions(id, session);
      if (result.loggedOut) {
        endSession();
        route("/login");
      } else setSessions(await api.userSessions(id));
      setNotice(t("adminUsers.revoked"));
    });
  };
  if (!detail || !value) return <p>{t("detail.loading")}</p>;
  return (
    <div class="admin-user-grid">
      <section>
        <h3>{t("adminUsers.edit")}</h3>
        <p class="muted">{t("adminUsers.securityHint")}</p>
        <form
          class="form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api.editUser(id, {
                ...value,
                version: detail.version,
              });
              if (result.loggedOut) {
                endSession();
                route("/login");
              } else {
                apply(result);
                if (profileState.value?.id === id)
                  profileState.value = result.user;
                setSessions(await api.userSessions(id));
              }
              setNotice(t("adminUsers.saved"));
            });
          }}
        >
          <AccountFields
            value={value}
            change={change}
            self={profileState.value?.id === id}
          />
          <div class="rowactions">
            <button class="button" disabled={busy}>
              {t("adminUsers.save")}
            </button>
            <button
              type="button"
              class="button ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  apply(await api.managedUser(id));
                  setSessions(await api.userSessions(id));
                })
              }
            >
              {t("users.refresh")}
            </button>
          </div>
        </form>
        <button
          type="button"
          class="button ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.sendUserReset(id);
              setNotice(t("adminUsers.sent"));
            })
          }
        >
          {t("adminUsers.reset")}
        </button>
      </section>
      <section>
        <div class="row">
          <h3>
            {t("adminUsers.sessions")} ({sessions?.total ?? 0})
          </h3>
          <button
            type="button"
            class="button danger"
            disabled={busy || !sessions?.total}
            onClick={() => revoke()}
          >
            {t("adminUsers.revokeAll")}
          </button>
        </div>
        {!sessions?.items.length ? (
          <p>{t("adminUsers.emptySessions")}</p>
        ) : (
          <ul class="userlist">
            {sessions.items.map((session) => (
              <li class="session-card" key={session.id}>
                <div>
                  <strong>
                    {session.current
                      ? t("adminUsers.current")
                      : session.active
                        ? t("detail.activeYes")
                        : t("adminUsers.expired")}
                  </strong>
                  <dl class="details">
                    <dt>{t("detail.id")}</dt>
                    <dd>{session.id}</dd>
                    <dt>{t("adminUsers.created")}</dt>
                    <dd>{date(session.createdAt)}</dd>
                    <dt>{t("adminUsers.expires")}</dt>
                    <dd>{date(session.expiresAt)}</dd>
                    <dt>{t("adminUsers.ip")}</dt>
                    <dd>{session.ipAddress || t("common.na")}</dd>
                    <dt>{t("adminUsers.device")}</dt>
                    <dd>{session.userAgent || t("common.na")}</dd>
                  </dl>
                </div>
                <button
                  type="button"
                  class="button danger"
                  disabled={busy}
                  onClick={() => revoke(session.id)}
                >
                  {t("adminUsers.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {sessions && (
          <div class="pagination">
            <button
              class="button ghost"
              disabled={busy || sessions.page <= 1}
              onClick={() =>
                void run(async () =>
                  setSessions(await api.userSessions(id, sessions.page - 1)),
                )
              }
            >
              {t("users.prev")}
            </button>
            <span>
              {sessions.page} /{" "}
              {Math.max(1, Math.ceil(sessions.total / sessions.limit))}
            </span>
            <button
              class="button ghost"
              disabled={
                busy || sessions.page * sessions.limit >= sessions.total
              }
              onClick={() =>
                void run(async () =>
                  setSessions(await api.userSessions(id, sessions.page + 1)),
                )
              }
            >
              {t("users.next")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
export function InvitationsPage() {
  const [list, setList] = useState<Page<Invitation> | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [locale, setLocale] = useState<string>(localeState.value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!admin()) return;
    const controller = new AbortController();
    void api
      .invitations(1, controller.signal)
      .then(setList)
      .catch((e) => {
        if (!controller.signal.aborted) fail(e);
      });
    return () => controller.abort();
  }, [profileState.value?.id]);
  if (!admin()) return <p class="panel">{t("database.adminOnly")}</p>;
  async function run(action: () => Promise<unknown>, page = list?.page ?? 1) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setList(await api.invitations(page));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="panel">
      <h2>{t("adminUsers.invites")}</h2>
      <p>{t("adminUsers.inviteHint")}</p>
      <form
        class="form invitation-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.inviteUser({ email, role, locale });
            setEmail("");
            setNotice(t("adminUsers.sent"));
          });
        }}
      >
        <label>
          {t("detail.email")}
          <input
            type="email"
            required
            maxLength={255}
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>
        <label>
          {t("adminUsers.role")}
          <select value={role} onChange={(e) => setRole(e.currentTarget.value)}>
            <option value="user">{formatRole("user")}</option>
            <option value="admin">{formatRole("admin")}</option>
          </select>
        </label>
        <label>
          {t("adminUsers.language")}
          <select
            value={locale}
            onChange={(e) => setLocale(e.currentTarget.value)}
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>
        <button class="button" disabled={busy}>
          {t("adminUsers.invite")}
        </button>
      </form>
      {!list ? (
        <p>{t("detail.loading")}</p>
      ) : !list.items.length ? (
        <p>{t("adminUsers.emptyInvites")}</p>
      ) : (
        <ul class="userlist">
          {list.items.map((invite) => (
            <li class="userrow" key={invite.id}>
              <div>
                <strong>{invite.email}</strong>
                <p>
                  {formatRole(invite.role)} · {t(`adminUsers.${invite.status}`)}{" "}
                  · {t("adminUsers.expires")}: {date(invite.expiresAt)}
                </p>
              </div>
              <div class="rowactions">
                {invite.status !== "accepted" && (
                  <button
                    class="button ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.invitationAction(invite.id, "resend");
                        setNotice(t("adminUsers.sent"));
                      })
                    }
                  >
                    {t("adminUsers.resend")}
                  </button>
                )}
                {invite.status === "pending" && (
                  <button
                    class="button danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(t("adminUsers.revoke") + "?"))
                        void run(() =>
                          api.invitationAction(invite.id, "revoke"),
                        );
                    }}
                  >
                    {t("adminUsers.revoke")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && (
        <div class="pagination">
          <button
            class="button ghost"
            disabled={busy || list.page <= 1}
            onClick={() => void run(async () => {}, list.page - 1)}
          >
            {t("users.prev")}
          </button>
          <span>
            {list.page} / {Math.max(1, Math.ceil(list.total / list.limit))}
          </span>
          <button
            class="button ghost"
            disabled={busy || list.page * list.limit >= list.total}
            onClick={() => void run(async () => {}, list.page + 1)}
          >
            {t("users.next")}
          </button>
          <button
            class="button ghost"
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            {t("users.refresh")}
          </button>
        </div>
      )}
      <a href="/users">{t("detail.backToList")}</a>
    </section>
  );
}
export function AcceptInvitationPage() {
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("token") ?? "",
  );
  const [info, setInfo] = useState<{
    email: string;
    role: string;
    expiresAt: string;
  } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const { route } = useLocation();
  useEffect(() => {
    history.replaceState(null, "", location.pathname + location.search);
    const controller = new AbortController();
    void api
      .inspectInvitation(token, controller.signal)
      .then(setInfo)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setInvalid(true);
          fail(e);
        }
      });
    return () => controller.abort();
  }, [token]);
  return (
    <section class="panel authpanel">
      <h2>{t("adminUsers.accept")}</h2>
      {invalid ? (
        <p>{t("adminUsers.invalid")}</p>
      ) : !info ? (
        <p>{t("detail.loading")}</p>
      ) : (
        <>
          <p>
            {info.email} · {formatRole(info.role)}
          </p>
          <p>{t("adminUsers.acceptHint")}</p>
          <form
            class="form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (password !== confirmation) {
                setError(t("adminUsers.passwordMismatch"));
                return;
              }
              setBusy(true);
              try {
                await api.acceptInvitation(token, username, password);
                setPassword("");
                setConfirmation("");
                setNotice(t("adminUsers.acceptedNotice"));
                route("/login");
              } catch (e) {
                fail(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("detail.username")}
              <input
                required
                minLength={3}
                maxLength={255}
                autoComplete="username"
                value={username}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("adminUsers.password")}
              <input
                required
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("adminUsers.confirmPassword")}
              <input
                required
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={confirmation}
                onInput={(e) => setConfirmation(e.currentTarget.value)}
              />
            </label>
            <button class="button" disabled={busy}>
              {t("adminUsers.accept")}
            </button>
          </form>
        </>
      )}
      <a href="/login">{t("users.goToLogin")}</a>
    </section>
  );
}
