export type SessionInfo = {
  userId: string | null;
  expiresAt: string | null;
};

export type PublicUser = {
  id: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean | null;
  dateCreated: string | null;
  dateUpdated: string | null;
  defaultCompanyId: string | null;
};

export type UserSortBy = "date_created" | "username" | "email" | "role" | "is_active";
export type SortDirection = "asc" | "desc";
export type Locale = "en" | "it";

export type PaginatedUsers = {
  items: PublicUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: UserSortBy;
  sortDir: SortDirection;
};

export type ApiJsonError = {
  error?: string;
  code?: string;
};

export type ApiClientError = Error & {
  status?: number;
  code?: string;
};

export type Asset = {
  id: string;
  filename: string;
  title: string | null;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  format: string | null;
  uploadedBy: string;
  dateCreated: string;
  dateUpdated: string | null;
  url: string;
};

export type AssetList = { items: Asset[] };

export const DEFAULT_USERS_LIMIT = 10;
export const DEFAULT_USERS_SORT_BY: UserSortBy = "date_created";
export const DEFAULT_USERS_SORT_DIR: SortDirection = "desc";
