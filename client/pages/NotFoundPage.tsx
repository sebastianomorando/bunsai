import { t } from "../i18n.ts";

export function NotFoundPage() {
  return (
    <div class="panel">
      <h2>{t("notfound.title")}</h2>
      <a class="button" href="/">
        {t("notfound.backHome")}
      </a>
    </div>
  );
}
