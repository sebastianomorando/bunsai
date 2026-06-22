import { t, type TranslationKey } from "./i18n.ts";
import {
  detailState,
  emptyUsersPage,
  pendingState,
  sessionState,
  usersState,
} from "./state.ts";
import {
  DEFAULT_USERS_LIMIT,
  DEFAULT_USERS_SORT_BY,
  DEFAULT_USERS_SORT_DIR,
  type ApiClientError,
  type ApiJsonError,
  type PaginatedUsers,
  type PublicUser,
  type SortDirection,
  type UserSortBy,
} from "./types.ts";

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

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export async function bootstrapFromCookie() {
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
    usersState.value = emptyUsersPage();
    detailState.value = null;
  }
}

export async function fetchUsers(
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

export async function fetchUserDetail(id: string) {
  pendingState.value = true;
  try {
    const user = await apiRequest<PublicUser>(`/api/users/${encodeURIComponent(id)}`);
    detailState.value = user;
    return user;
  } finally {
    pendingState.value = false;
  }
}
