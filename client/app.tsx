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

const sessionState = signal<SessionInfo | null>(null);
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
  return "Operazione fallita";
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
    const message =
      (json && typeof json === "object" && json.error) ||
      (typeof payload === "string" && payload) ||
      `Errore HTTP ${res.status}`;

    const err = new Error(message) as ApiClientError;
    err.status = res.status;
    err.code = json?.code;
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
    sortDir: payload.sortDir === "asc" || payload.sortDir === "desc"
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

  useEffect(() => {
    void bootstrapFromCookie();
  }, []);

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
      setNotice("Logout effettuato");
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
          Bunsai Users
        </a>
        <nav class="menu">
          {!sessionState.value ? (
            <>
              <a href="/login">Login</a>
              <a href="/register">Registrazione</a>
            </>
          ) : (
            <>
              <a href="/users">Utenti</a>
              <button type="button" class="linklike" onClick={onLogout}>
                Logout
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
      <h1>Gestione utenti</h1>
      <p>
        Mini app con registrazione, login, logout, lista utenti e dettaglio utente.
      </p>
      {sessionState.value ? (
        <a class="button" href="/users">
          Vai alla lista utenti
        </a>
      ) : (
        <div class="actions">
          <a class="button" href="/register">
            Crea account
          </a>
          <a class="button ghost" href="/login">
            Accedi
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
      setNotice("Registrazione completata e login effettuato");
      route("/users");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>Registrazione</h2>
      <label>
        Username
        <input
          value={username}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? "Invio..." : "Registrati"}
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
      setNotice("Accesso effettuato");
      route("/users");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      pendingState.value = false;
    }
  };

  return (
    <form class="panel form" onSubmit={onSubmit}>
      <h2>Login</h2>
      <label>
        Username o email
        <input
          value={username}
          onInput={(event) => setUsername((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onInput={(event) => setPassword((event.target as HTMLInputElement).value)}
          required
        />
      </label>
      <button class="button" type="submit" disabled={pendingState.value}>
        {pendingState.value ? "Invio..." : "Accedi"}
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
        <h2>Accesso richiesto</h2>
        <p>Per vedere gli utenti devi prima autenticarti.</p>
        <a class="button" href="/login">
          Vai al login
        </a>
      </div>
    );
  }

  const usersPage = usersState.value;

  return (
    <div class="panel">
      <div class="row">
        <h2>Lista utenti</h2>
        <div class="rowactions">
          <label class="limitcontrol">
            Ordina per
            <select
              value={usersPage.sortBy}
              onChange={(event) => {
                const nextSortBy = (event.target as HTMLSelectElement).value as UserSortBy;
                void fetchUsers(1, usersPage.limit, nextSortBy, usersPage.sortDir).catch(
                  (error) => setError(errorMessage(error))
                );
              }}
            >
              <option value="date_created">Data creazione</option>
              <option value="username">Username</option>
              <option value="email">Email</option>
              <option value="role">Ruolo</option>
              <option value="is_active">Stato attivo</option>
            </select>
          </label>
          <label class="limitcontrol">
            Direzione
            <select
              value={usersPage.sortDir}
              onChange={(event) => {
                const nextSortDir = (event.target as HTMLSelectElement).value as SortDirection;
                void fetchUsers(1, usersPage.limit, usersPage.sortBy, nextSortDir).catch(
                  (error) => setError(errorMessage(error))
                );
              }}
            >
              <option value="desc">Discendente</option>
              <option value="asc">Ascendente</option>
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
            Aggiorna
          </button>
        </div>
      </div>
      <p class="muted">
        Pagina {usersPage.page} di {usersPage.totalPages} · Totale utenti visibili:{" "}
        {usersPage.total}
      </p>

      {usersPage.items.length === 0 ? (
        <p>Nessun utente disponibile per questo account.</p>
      ) : (
        <ul class="userlist">
          {usersPage.items.map((user) => (
            <li key={user.id ?? `${user.username}-row`} class="userrow">
              <div>
                <strong>{user.username || "Utente senza nome"}</strong>
                <p>{user.email || "Email non disponibile"}</p>
              </div>
              <button
                type="button"
                class="button"
                onClick={() => {
                  if (user.id) route(`/users/${user.id}`);
                }}
                disabled={!user.id}
              >
                Dettaglio
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
          Precedente
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
          Successiva
        </button>
        <label class="limitcontrol">
          Per pagina
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
        <h2>Accesso richiesto</h2>
        <a class="button" href="/login">
          Vai al login
        </a>
      </div>
    );
  }

  return (
    <div class="panel">
      <h2>Dettaglio utente</h2>
      {!detailState.value ? (
        <p>Caricamento dettaglio...</p>
      ) : (
        <dl class="details">
          <dt>ID</dt>
          <dd>{detailState.value.id}</dd>
          <dt>Username</dt>
          <dd>{detailState.value.username}</dd>
          <dt>Email</dt>
          <dd>{detailState.value.email}</dd>
          <dt>Ruolo</dt>
          <dd>{detailState.value.role}</dd>
          <dt>Attivo</dt>
          <dd>{detailState.value.isActive ? "Sì" : "No"}</dd>
          <dt>Creato il</dt>
          <dd>{detailState.value.dateCreated || "-"}</dd>
        </dl>
      )}
      <a class="button ghost" href="/users">
        Torna alla lista
      </a>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div class="panel">
      <h2>Pagina non trovata</h2>
      <a class="button" href="/">
        Torna alla home
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
