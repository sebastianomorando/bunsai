import { t } from "../i18n.ts";
import { sessionState } from "../state.ts";

export function HomePage() {
  return (
    <div class="panel">
      <h1>{t("home.title")}</h1>
      <p>{t("home.description")}</p>
      {sessionState.value ? (
        <a class="button" href="/users">
          {t("home.gotoUsers")}
        </a>
      ) : (
        <div class="actions">
          <a class="button" href="/register">
            {t("home.createAccount")}
          </a>
          <a class="button ghost" href="/login">
            {t("home.signIn")}
          </a>
        </div>
      )}
    </div>
  );
}
