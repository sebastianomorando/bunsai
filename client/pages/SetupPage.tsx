import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { createAdmin, fetchSetupStatus } from "../api";
import { t } from "../i18n";
import { errorMessage, setError, setNotice } from "../state";
import type { ApiClientError } from "../types";

export function SetupPage() {
  const { route } = useLocation();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await createAdmin({ email, username, password });
      setPassword("");
      setNotice(t("setup.success"));
      route("/login", true);
    } catch (error) {
      setError(errorMessage(error));
      if ((error as ApiClientError).code === "SETUP_COMPLETED") {
        await fetchSetupStatus().catch(() => undefined);
      }
    } finally { setSubmitting(false); }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>{t("setup.title")}</h2>
      <p>{t("setup.description")}</p>
      <label>
        {t("field.email")}
        <input type="email" autoComplete="email" value={email} maxLength={255} required disabled={submitting}
          onInput={(event) => setEmail(event.currentTarget.value)} />
      </label>
      <label>
        {t("field.username")}
        <input autoComplete="username" value={username} minLength={3} maxLength={255} required disabled={submitting}
          onInput={(event) => setUsername(event.currentTarget.value)} />
      </label>
      <label>
        {t("field.password")}
        <input type="password" autoComplete="new-password" value={password} minLength={12} maxLength={128} required disabled={submitting}
          aria-describedby="setup-password-hint" onInput={(event) => setPassword(event.currentTarget.value)} />
      </label>
      <p id="setup-password-hint">{t("setup.passwordHint")}</p>
      <button class="button" type="submit" disabled={submitting}>
        {submitting ? t("setup.submitting") : t("setup.submit")}
      </button>
    </form>
  );
}
