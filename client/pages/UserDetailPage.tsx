import { useEffect } from "preact/hooks";
import { fetchUserDetail } from "../api.ts";
import { formatRole, t } from "../i18n.ts";
import { detailState, errorMessage, sessionState, setError } from "../state.ts";

type UserDetailPageProps = {
  id?: string;
  params?: {
    id?: string;
  };
};

export function UserDetailPage(props: UserDetailPageProps) {
  const userId = props.id ?? props.params?.id ?? "";

  useEffect(() => {
    if (!sessionState.value || !userId) return;
    void fetchUserDetail(userId).catch((error) => {
      detailState.value = null;
      setError(errorMessage(error));
    });
  }, [userId, sessionState.value?.userId]);

  if (!sessionState.value) {
    return (
      <div class="panel">
        <h2>{t("users.authRequiredTitle")}</h2>
        <a class="button" href="/login">
          {t("users.goToLogin")}
        </a>
      </div>
    );
  }

  return (
    <div class="panel">
      <h2>{t("detail.title")}</h2>
      {!detailState.value ? (
        <p>{t("detail.loading")}</p>
      ) : (
        <dl class="details">
          <dt>{t("detail.id")}</dt>
          <dd>{detailState.value.id}</dd>
          <dt>{t("detail.username")}</dt>
          <dd>{detailState.value.username}</dd>
          <dt>{t("detail.email")}</dt>
          <dd>{detailState.value.email}</dd>
          <dt>{t("detail.role")}</dt>
          <dd>{formatRole(detailState.value.role)}</dd>
          <dt>{t("detail.active")}</dt>
          <dd>{detailState.value.isActive ? t("detail.activeYes") : t("detail.activeNo")}</dd>
          <dt>{t("detail.createdAt")}</dt>
          <dd>{detailState.value.dateCreated || t("common.na")}</dd>
        </dl>
      )}
      <a class="button ghost" href="/users">
        {t("detail.backToList")}
      </a>
    </div>
  );
}
