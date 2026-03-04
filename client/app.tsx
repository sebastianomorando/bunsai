import { signal } from "@preact/signals";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";

type SessionInfo = {
  userId: string | null;
  expiresAt: string | null;
};

type PublicUser = {
  id: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean | null;
  dateCreated: string | null;
  dateUpdated: string | null;
  defaultCompanyId: string | null;
};

type UserSortBy = "date_created" | "username" | "email" | "role" | "is_active";
type SortDirection = "asc" | "desc";
type Locale = "en" | "it";

type PaginatedUsers = {
  items: PublicUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: UserSortBy;
  sortDir: SortDirection;
};

type ApiJsonError = {
  error?: string;
  code?: string;
};

type ApiClientError = Error & {
  status?: number;
  code?: string;
};

const DEFAULT_USERS_LIMIT = 10;
const DEFAULT_USERS_SORT_BY: UserSortBy = "date_created";
const DEFAULT_USERS_SORT_DIR: SortDirection = "desc";
const DEFAULT_LOCALE: Locale = "en";
const LOCALE_STORAGE_KEY = "bunsai:frontend:locale";

const translations = {
  en: {
    "error.operationFailed": "Operation failed",
    "error.http": "HTTP error {status}",
    "error.badRequest": "Bad request",
    "error.notAuthenticated": "Authentication required",
    "error.notAuthorized": "Access denied",
    "error.notFound": "Resource not found",
    "error.conflict": "Conflict",
    "error.validation": "Validation failed",
    "error.rateLimited": "Too many requests",
    "error.internal": "Internal server error",
    "error.genericHttp": "Unexpected error",

    "notice.logoutSuccess": "Logged out",
    "notice.registerSuccess": "Registration completed and login successful",
    "notice.loginSuccess": "Login successful",

    "brand.title": "Bunsai Users",

    "nav.login": "Login",
    "nav.register": "Register",
    "nav.users": "Users",
    "nav.logout": "Logout",

    "language.label": "Language",
    "language.en": "English",
    "language.it": "Italiano",

    "home.title": "User management",
    "home.description": "Small app with registration, login, logout, user list and user details.",
    "home.gotoUsers": "Go to users list",
    "home.createAccount": "Create account",
    "home.signIn": "Sign in",

    "register.title": "Register",
    "register.submitLoading": "Submitting...",
    "register.submit": "Register",

    "login.title": "Login",
    "login.submitLoading": "Submitting...",
    "login.submit": "Login",

    "field.username": "Username",
    "field.email": "Email",
    "field.password": "Password",
    "field.usernameOrEmail": "Username or email",

    "users.authRequiredTitle": "Authentication required",
    "users.authRequiredText": "You must sign in before viewing users.",
    "users.goToLogin": "Go to login",
    "users.title": "Users list",
    "users.sortBy": "Sort by",
    "users.sortBy.date_created": "Created date",
    "users.sortBy.username": "Username",
    "users.sortBy.email": "Email",
    "users.sortBy.role": "Role",
    "users.sortBy.is_active": "Active status",
    "users.direction": "Direction",
    "users.direction.desc": "Descending",
    "users.direction.asc": "Ascending",
    "users.refresh": "Refresh",
    "users.pageSummary": "Page {page} of {totalPages} · Total visible users: {total}",
    "users.empty": "No users available for this account.",
    "users.unnamed": "Unnamed user",
    "users.noEmail": "Email not available",
    "users.detail": "Details",
    "users.prev": "Previous",
    "users.next": "Next",
    "users.perPage": "Per page",

    "detail.title": "User details",
    "detail.loading": "Loading user details...",
    "detail.id": "ID",
    "detail.username": "Username",
    "detail.email": "Email",
    "detail.role": "Role",
    "detail.active": "Active",
    "detail.createdAt": "Created on",
    "detail.activeYes": "Yes",
    "detail.activeNo": "No",
    "detail.backToList": "Back to list",

    "notfound.title": "Page not found",
    "notfound.backHome": "Back to home",

    "role.admin": "Admin",
    "role.user": "User",

    "common.na": "-",
  },
  it: {
    "error.operationFailed": "Operazione fallita",
    "error.http": "Errore HTTP {status}",
    "error.badRequest": "Richiesta non valida",
    "error.notAuthenticated": "Autenticazione richiesta",
    "error.notAuthorized": "Accesso negato",
    "error.notFound": "Risorsa non trovata",
    "error.conflict": "Conflitto",
    "error.validation": "Validazione fallita",
    "error.rateLimited": "Troppe richieste",
    "error.internal": "Errore interno del server",
    "error.genericHttp": "Errore imprevisto",

    "notice.logoutSuccess": "Logout effettuato",
    "notice.registerSuccess": "Registrazione completata e login effettuato",
    "notice.loginSuccess": "Accesso effettuato",

    "brand.title": "Bunsai Users",

    "nav.login": "Login",
    "nav.register": "Registrazione",
    "nav.users": "Utenti",
    "nav.logout": "Logout",

    "language.label": "Lingua",
    "language.en": "English",
    "language.it": "Italiano",

    "home.title": "Gestione utenti",
    "home.description": "Mini app con registrazione, login, logout, lista utenti e dettaglio utente.",
    "home.gotoUsers": "Vai alla lista utenti",
    "home.createAccount": "Crea account",
    "home.signIn": "Accedi",

    "register.title": "Registrazione",
    "register.submitLoading": "Invio...",
    "register.submit": "Registrati",

    "login.title": "Login",
    "login.submitLoading": "Invio...",
    "login.submit": "Accedi",

    "field.username": "Username",
    "field.email": "Email",
    "field.password": "Password",
    "field.usernameOrEmail": "Username o email",

    "users.authRequiredTitle": "Accesso richiesto",
    "users.authRequiredText": "Per vedere gli utenti devi prima autenticarti.",
    "users.goToLogin": "Vai al login",
    "users.title": "Lista utenti",
    "users.sortBy": "Ordina per",
    "users.sortBy.date_created": "Data creazione",
    "users.sortBy.username": "Username",
    "users.sortBy.email": "Email",
    "users.sortBy.role": "Ruolo",
    "users.sortBy.is_active": "Stato attivo",
    "users.direction": "Direzione",
    "users.direction.desc": "Discendente",
    "users.direction.asc": "Ascendente",
    "users.refresh": "Aggiorna",
    "users.pageSummary": "Pagina {page} di {totalPages} · Totale utenti visibili: {total}",
    "users.empty": "Nessun utente disponibile per questo account.",
    "users.unnamed": "Utente senza nome",
    "users.noEmail": "Email non disponibile",
    "users.detail": "Dettaglio",
    "users.prev": "Precedente",
    "users.next": "Successiva",
    "users.perPage": "Per pagina",

    "detail.title": "Dettaglio utente",
    "detail.loading": "Caricamento dettaglio...",
    "detail.id": "ID",
    "detail.username": "Username",
    "detail.email": "Email",
    "detail.role": "Ruolo",
    "detail.active": "Attivo",
    "detail.createdAt": "Creato il",
    "detail.activeYes": "Sì",
    "detail.activeNo": "No",
    "detail.backToList": "Torna alla lista",

    "notfound.title": "Pagina non trovata",
    "notfound.backHome": "Torna alla home",

    "role.admin": "Admin",
    "role.user": "Utente",

    "common.na": "-",
  },
} as const;

type TranslationKey = keyof (typeof translations)["en"];

const sessionState = signal<SessionInfo | null>(null);
const localeState = signal<Locale>(DEFAULT_LOCALE);
const usersState = signal<PaginatedUsers>({
  items: [],
  page: 1,
  limit: DEFAULT_USERS_LIMIT,
  total: 0,
  totalPages: 1,
  sortBy: DEFAULT_USERS_SORT_BY,
  sortDir: DEFAULT_USERS_SORT_DIR,
});
const detailState = signal<PublicUser | null>(null);
const pendingState = signal(false);
const noticeState = signal<string | null>(null);
const errorState = signal<string | null>(null);

function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {}
): string {
  const template = translations[locale][key] ?? translations[DEFAULT_LOCALE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = params[name];
    return value === undefined ? "" : String(value);
  });
}

function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(localeState.value, key, params);
}

function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "it";
}

function readStoredLocale(): Locale {
  if (typeof localStorage === "undefined") {
    return DEFAULT_LOCALE;
  }

  const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

function setLocale(nextLocale: Locale) {
  localeState.value = nextLocale;

  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
}

function formatRole(role: string | null) {
  if (role === "admin") {
    return t("role.admin");
  }
  if (role === "user") {
    return t("role.user");
  }
  return role ?? t("common.na");
}

function setNotice(message: string | null) {
  noticeState.value = message;
  if (message) errorState.value = null;
}

function setError(message: string | null) {
  errorState.value = message;
  if (message) noticeState.value = null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return t("error.operationFailed");
}

const apiCodeTranslations = {
  BAD_REQUEST: "error.badRequest",
  NOT_AUTHENTICATED: "error.notAuthenticated",
  NOT_AUTHORIZED: "error.notAuthorized",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  VALIDATION_ERROR: "error.validation",
  RATE_LIMITED: "error.rateLimited",
  INTERNAL_SERVER_ERROR: "error.internal",
  HTTP_ERROR: "error.genericHttp",
} as const satisfies Record<string, TranslationKey>;

function localizedApiErrorMessage(
  code: string | undefined,
  fallback: string | undefined,
  status: number
) {
  if (code && code in apiCodeTranslations) {
    const translationKey = apiCodeTranslations[code as keyof typeof apiCodeTranslations];
    return t(translationKey);
  }

  if (fallback) {
    return fallback;
  }

  return t("error.http", { status });
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    const json = payload as ApiJsonError | null;
    const code = json?.code;
    const fallback =
      (json && typeof json === "object" && json.error) ||
      (typeof payload === "string" && payload) ||
      undefined;
    const message = localizedApiErrorMessage(code, fallback, res.status);

    const err = new Error(message) as ApiClientError;
    err.status = res.status;
    err.code = code;
    throw err;
  }

  return payload as T;
}

function usersEndpoint(
  page: number,
  limit: number,
  sortBy: UserSortBy,
  sortDir: SortDirection
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
    sortDir,
  });
  return `/api/users?${params.toString()}`;
}

function normalizePaginatedUsers(payload: PaginatedUsers | PublicUser[]): PaginatedUsers {
  if (Array.isArray(payload)) {
    const total = payload.length;
    return {
      items: payload,
      page: 1,
      limit: total || DEFAULT_USERS_LIMIT,
      total,
      totalPages: 1,
      sortBy: DEFAULT_USERS_SORT_BY,
      sortDir: DEFAULT_USERS_SORT_DIR,
    };
  }

  const total = Number.isFinite(payload.total) ? payload.total : payload.items.length;
  const limit = payload.limit > 0 ? payload.limit : DEFAULT_USERS_LIMIT;
  const totalPages =
    payload.totalPages > 0 ? payload.totalPages : Math.max(1, Math.ceil(total / limit));

  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    page: payload.page > 0 ? payload.page : 1,
    limit,
    total,
    totalPages,
    sortBy:
      payload.sortBy === "username" ||
      payload.sortBy === "email" ||
      payload.sortBy === "role" ||
      payload.sortBy === "is_active" ||
      payload.sortBy === "date_created"
        ? payload.sortBy
        : DEFAULT_USERS_SORT_BY,
    sortDir:
      payload.sortDir === "asc" || payload.sortDir === "desc"
        ? payload.sortDir
        : DEFAULT_USERS_SORT_DIR,
  };
}

async function bootstrapFromCookie() {
  try {
    const payload = await apiRequest<PaginatedUsers | PublicUser[]>(
      usersEndpoint(1, DEFAULT_USERS_LIMIT, DEFAULT_USERS_SORT_BY, DEFAULT_USERS_SORT_DIR)
    );
    const users = normalizePaginatedUsers(payload);
    usersState.value = users;
    const first = users.items[0];
    sessionState.value = {
      userId: first?.id ?? "authenticated",
      expiresAt: null,
    };
  } catch {
    sessionState.value = null;
    usersState.value = {
      items: [],
      page: 1,
      limit: DEFAULT_USERS_LIMIT,
      total: 0,
      totalPages: 1,
      sortBy: DEFAULT_USERS_SORT_BY,
      sortDir: DEFAULT_USERS_SORT_DIR,
    };
    detailState.value = null;
  }
}

async function fetchUsers(
  page = usersState.value.page,
  limit = usersState.value.limit,
  sortBy = usersState.value.sortBy,
  sortDir = usersState.value.sortDir
) {
  pendingState.value = true;
  try {
    const payload = await apiRequest<PaginatedUsers | PublicUser[]>(
      usersEndpoint(page, limit, sortBy, sortDir)
    );
    const users = normalizePaginatedUsers(payload);
    usersState.value = users;
    detailState.value = null;
    return users;
  } finally {
    pendingState.value = false;
  }
}

async function fetchUserDetail(id: string) {
  pendingState.value = true;
  try {
    const user = await apiRequest<PublicUser>(`/api/users/${encodeURIComponent(id)}`);
    detailState.value = user;
    return user;
  } finally {
    pendingState.value = false;
  }
}

function AppLayout() {
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
    document.documentElement.lang = localeState.value;
  }, [localeState.value]);

  const onLogout = async () => {
    pendingState.value = true;
    try {
      await apiRequest("/api/logout", { method: "POST" });
      sessionState.value = null;
      usersState.value = {
        items: [],
        page: 1,
        limit: DEFAULT_USERS_LIMIT,
        total: 0,
        totalPages: 1,
        sortBy: DEFAULT_USERS_SORT_BY,
        sortDir: DEFAULT_USERS_SORT_DIR,
      };
      detailState.value = null;
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
          <Route path="/users" component={UsersPage} />
          <Route path="/users/:id" component={UserDetailPage} />
          <Route path="*" component={NotFoundPage} />
        </Router>
      </section>
    </main>
  );
}

function HomePage() {
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

function RegisterPage() {
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

function LoginPage() {
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

function UsersPage() {
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

function UserDetailPage(props: { id?: string; params?: { id?: string } }) {
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

function NotFoundPage() {
  return (
    <div class="panel">
      <h2>{t("notfound.title")}</h2>
      <a class="button" href="/">
        {t("notfound.backHome")}
      </a>
    </div>
  );
}

render(
  <LocationProvider>
    <AppLayout />
  </LocationProvider>,
  document.getElementById("app")!
);
