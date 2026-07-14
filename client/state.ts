import { signal } from "@preact/signals";
import { t } from "./i18n.ts";
import {
  DEFAULT_USERS_LIMIT,
  DEFAULT_USERS_SORT_BY,
  DEFAULT_USERS_SORT_DIR,
  type PaginatedUsers,
  type PublicUser,
  type SessionInfo,
  type Asset,
} from "./types.ts";

export const sessionState = signal<SessionInfo | null>(null);
export const usersState = signal<PaginatedUsers>(emptyUsersPage());
export const detailState = signal<PublicUser | null>(null);
export const pendingState = signal(false);
export const noticeState = signal<string | null>(null);
export const errorState = signal<string | null>(null);
export const assetsState = signal<Asset[]>([]);

export function emptyUsersPage(): PaginatedUsers {
  return {
    items: [],
    page: 1,
    limit: DEFAULT_USERS_LIMIT,
    total: 0,
    totalPages: 1,
    sortBy: DEFAULT_USERS_SORT_BY,
    sortDir: DEFAULT_USERS_SORT_DIR,
  };
}

export function resetUsersState() {
  usersState.value = emptyUsersPage();
  detailState.value = null;
}

export function resetAssetsState() {
  assetsState.value = [];
}

export function setNotice(message: string | null) {
  noticeState.value = message;
  if (message) errorState.value = null;
}

export function setError(message: string | null) {
  errorState.value = message;
  if (message) noticeState.value = null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return t("error.operationFailed");
}
