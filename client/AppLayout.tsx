import { Route, Router, useLocation } from "preact-iso";
import { useEffect } from "preact/hooks";
import { apiRequest, bootstrapFromCookie } from "./api.ts";
import { localeState, readStoredLocale, setLocale, t } from "./i18n.ts";
import {
  ForgotPasswordPage,
  ConfirmEmailPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from "./pages/AuthPages.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { UserDetailPage } from "./pages/UserDetailPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { AssetsPage } from "./pages/AssetsPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import {
  errorMessage,
  errorState,
  noticeState,
  pendingState,
  resetUsersState,
  resetAssetsState,
  sessionState,
  setError,
  setNotice,
} from "./state.ts";

export function AppLayout() {
  const { route } = useLocation();
  const locale = localeState.value;

  useEffect(() => {
    setLocale(readStoredLocale());
    void bootstrapFromCookie();
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const onLogout = async () => {
    pendingState.value = true;
    try {
      await apiRequest("/api/logout", { method: "POST" });
      sessionState.value = null;
      resetUsersState();
      resetAssetsState();
      setNotice(t("notice.logoutSuccess"));
      route("/login");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <main class="page">
      <header class="topbar">
        <a class="brand" href="/">
          {t("brand.title")}
        </a>
        <nav class="menu">
          <label class="langswitch">
            <span>{t("language.label")}</span>
            <select
              value={locale}
              onChange={(event) => {
                const next = (event.target as HTMLSelectElement).value;
                if (next === "en" || next === "it") {
                  setLocale(next);
                }
              }}
            >
              <option value="en">{t("language.en")}</option>
              <option value="it">{t("language.it")}</option>
            </select>
          </label>
          {!sessionState.value ? (
            <>
              <a href="/login">{t("nav.login")}</a>
              <a href="/register">{t("nav.register")}</a>
            </>
          ) : (
            <>
              <a href="/users">{t("nav.users")}</a>
              <a href="/assets">{t("nav.assets")}</a>
              <a href="/profile">{t("nav.profile")}</a>
              <button type="button" class="linklike" onClick={onLogout}>
                {t("nav.logout")}
              </button>
            </>
          )}
        </nav>
      </header>

      {noticeState.value && <p class="banner success">{noticeState.value}</p>}
      {errorState.value && <p class="banner error">{errorState.value}</p>}

      <section class="content">
        <Router>
          <Route path="/" component={HomePage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/login" component={LoginPage} />
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/confirm-email" component={ConfirmEmailPage} />
          <Route path="/users" component={UsersPage} />
          <Route path="/users/:id" component={UserDetailPage} />
          <Route path="/assets" component={AssetsPage} />
          <Route path="/profile" component={ProfilePage} />
          <Route path="*" component={NotFoundPage} />
        </Router>
      </section>
    </main>
  );
}
