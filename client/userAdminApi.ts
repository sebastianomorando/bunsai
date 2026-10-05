import { apiRequest } from "./api";
import type { PublicUser } from "./types";
export type AccountInput = {
  username: string;
  email: string;
  role: string;
  isActive: boolean;
};
export type ManagedUser = {
  user: PublicUser;
  version: string;
  loggedOut?: boolean;
};
export type ManagedSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string;
  ipAddress: string;
  current: boolean;
  active: boolean;
};
export type Invitation = {
  id: string;
  email: string;
  role: string;
  locale: string;
  status: "pending" | "expired" | "revoked" | "accepted";
  createdAt: string;
  expiresAt: string;
  lastSentAt: string | null;
};
export type Page<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};
const userPath = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;
export const managedUser = (id: string, signal?: AbortSignal) =>
  apiRequest<ManagedUser>(userPath(id), { signal });
export const createUser = (data: AccountInput & { password: string }) =>
  apiRequest<ManagedUser>("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const editUser = (
  id: string,
  data: AccountInput & { version: string },
) =>
  apiRequest<ManagedUser>(userPath(id), {
    method: "PATCH",
    body: JSON.stringify(data),
  });
export const userSessions = (id: string, page = 1, signal?: AbortSignal) =>
  apiRequest<Page<ManagedSession>>(`${userPath(id)}/sessions?page=${page}`, {
    signal,
  });
export const revokeUserSessions = (id: string, session?: string) =>
  apiRequest<{ revoked: number; loggedOut: boolean }>(
    `${userPath(id)}/sessions${session ? `/${encodeURIComponent(session)}` : ""}`,
    { method: "DELETE" },
  );
export const sendUserReset = (id: string) =>
  apiRequest(`${userPath(id)}/password-reset`, { method: "POST" });
export const invitations = (page = 1, signal?: AbortSignal) =>
  apiRequest<Page<Invitation>>(`/api/admin/invitations?page=${page}`, {
    signal,
  });
export const inviteUser = (data: {
  email: string;
  role: string;
  locale: string;
}) =>
  apiRequest<Invitation>("/api/admin/invitations", {
    method: "POST",
    body: JSON.stringify(data),
  });
export const invitationAction = (id: string, action: "resend" | "revoke") =>
  apiRequest(
    `/api/admin/invitations/${encodeURIComponent(id)}${action === "resend" ? "/resend" : ""}`,
    { method: action === "resend" ? "POST" : "DELETE" },
  );
export const inspectInvitation = (token: string, signal?: AbortSignal) =>
  apiRequest<{ email: string; role: string; expiresAt: string }>(
    "/api/invitations/inspect",
    { method: "POST", body: JSON.stringify({ token }), signal },
  );
export const acceptInvitation = (
  token: string,
  username: string,
  password: string,
) =>
  apiRequest("/api/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ token, username, password }),
  });
