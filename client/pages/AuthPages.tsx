import { useLocation } from "preact-iso";
import { useState } from "preact/hooks";
import { apiRequest, fetchUsers } from "../api.ts";
import { t } from "../i18n.ts";
import {
  errorMessage,
  pendingState,
  sessionState,
  setError,
  setNotice,
} from "../state.ts";
import type { SessionInfo } from "../types.ts";

export function RegisterPage() {
  const { route } = useLocation();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    setNotice(null);
    setError(null);
    pendingState.value = true;

    try {
      await apiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ username, email, password }),
      });

      const session = await apiRequest<SessionInfo>("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      sessionState.value = session;
      await fetchUsers();
      setNotice(t("notice.registerSuccess"));
      route("/users");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>{t("register.title")}</h2>
      <label>
        {t("field.username")}
        <input
          value={username}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("field.email")}
        <input
          type="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("field.password")}
        <input
          type="password"
          value={password}
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? t("register.submitLoading") : t("register.submit")}
      </button>
    </form>
  );
}

export function LoginPage() {
  const { route } = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    setNotice(null);
    setError(null);
    pendingState.value = true;

    try {
      const session = await apiRequest<SessionInfo>("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      sessionState.value = session;
      await fetchUsers();
      setNotice(t("notice.loginSuccess"));
      route("/users");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>{t("login.title")}</h2>
      <label>
        {t("field.usernameOrEmail")}
        <input
          value={username}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("field.password")}
        <input
          type="password"
          value={password}
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? t("login.submitLoading") : t("login.submit")}
      </button>
    </form>
  );
}
