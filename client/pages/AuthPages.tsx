import { useLocation } from "preact-iso";
import { useEffect, useState } from "preact/hooks";
import { apiRequest, fetchProfile, fetchUsers } from "../api.ts";
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

      setNotice(t("notice.registerSuccess"));
      route("/login");
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
          minLength={3}
          maxLength={255}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("field.email")}
        <input
          type="email"
          value={email}
          maxLength={255}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("field.password")}
        <input
          type="password"
          value={password}
          minLength={8}
          maxLength={1024}
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

export function ConfirmEmailPage() {
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("");
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.hash.slice(1)).get("token") || ""
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!token) {
      setStatus("error");
      setMessage(t("emailConfirmation.invalid"));
      return;
    }
    void apiRequest("/api/email-confirmation", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => {
        setStatus("success");
        setMessage(t("emailConfirmation.success"));
      })
      .catch((error) => {
        setStatus("error");
        setMessage(errorMessage(error));
      });
  }, [token]);

  return (
    <section class="panel">
      <h2>{t("emailConfirmation.title")}</h2>
      <p>{status === "pending" ? t("emailConfirmation.pending") : message}</p>
      {status !== "pending" && (
        <a class="button" href={status === "success" ? "/login" : "/register"}>
          {status === "success" ? t("emailConfirmation.login") : t("emailConfirmation.registerAgain")}
        </a>
      )}
    </section>
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
      await Promise.all([fetchUsers(), fetchProfile()]);
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
      <a href="/forgot-password">{t("passwordReset.forgotLink")}</a>
    </form>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    setNotice(null);
    setError(null);
    pendingState.value = true;

    try {
      await apiRequest("/api/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNotice(t("passwordReset.requestSuccess"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>{t("passwordReset.requestTitle")}</h2>
      <p>{t("passwordReset.requestDescription")}</p>
      <label>
        {t("field.email")}
        <input
          type="email"
          autoComplete="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? t("passwordReset.sending") : t("passwordReset.send")}
      </button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { route } = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.hash.slice(1)).get("token") || ""
  );

  useEffect(() => {
    if (token && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [token]);

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("passwordReset.passwordMismatch"));
      return;
    }

    pendingState.value = true;
    try {
      await apiRequest("/api/password-reset", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      setNotice(t("passwordReset.resetSuccess"));
      route("/login");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  if (!token) {
    return (
      <section class="panel">
        <h2>{t("passwordReset.invalidTitle")}</h2>
        <p>{t("passwordReset.invalidDescription")}</p>
        <a class="button" href="/forgot-password">{t("passwordReset.requestAgain")}</a>
      </section>
    );
  }

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>{t("passwordReset.resetTitle")}</h2>
      <label>
        {t("passwordReset.newPassword")}
        <input
          type="password"
          minLength={8}
          maxLength={1024}
          autoComplete="new-password"
          value={newPassword}
          onInput={(event) => setNewPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        {t("passwordReset.confirmPassword")}
        <input
          type="password"
          minLength={8}
          maxLength={1024}
          autoComplete="new-password"
          value={confirmPassword}
          onInput={(event) => setConfirmPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? t("passwordReset.resetting") : t("passwordReset.reset")}
      </button>
    </form>
  );
}
