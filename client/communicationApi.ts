import { apiRequest } from "./api";
import { sessionState } from "./state";
import {
  notificationState,
  communicationRevision,
  realtimeStatus,
  type List,
  type Notification,
  type Conversation,
  type ChatUser,
  type Message,
  type Campaign,
  type Recipient,
  type Group,
} from "./communicationState";
import { pushToast } from "./toastState";
export async function fetchNotifications(
  page = 1,
  signal?: AbortSignal,
  announce = false,
) {
  const owner = sessionState.value?.userId;
  const previous = notificationState.value;
  const result = await apiRequest<List<Notification> & { unread: number }>(
    `/api/notifications?page=${page}`,
    { signal },
  );
  if (owner && sessionState.value?.userId === owner && !signal?.aborted) {
    if (announce && previous && page === 1 && previous.page === 1) {
      const known = new Set(previous.items.map((n) => n.id));
      for (const n of result.items
        .filter((n) => !n.readAt && !known.has(n.id))
        .slice(0, 3))
        pushToast(n.severity, n.title);
    }
    notificationState.value = result;
  }
  return result;
}
export async function notificationAction(
  id: string | null,
  action: "read" | "dismiss" | "all",
) {
  await apiRequest(
    action === "all"
      ? "/api/notifications/read-all"
      : `/api/notifications/${encodeURIComponent(id!)}${action === "read" ? "/read" : ""}`,
    {
      method:
        action === "all" ? "POST" : action === "read" ? "PATCH" : "DELETE",
    },
  );
  return fetchNotifications(notificationState.value?.page ?? 1);
}
const chatPath = (id: string) =>
  `/api/chat/conversations/${encodeURIComponent(id)}`;
export const fetchChatUsers = (q = "", page = 1, signal?: AbortSignal) =>
  apiRequest<{ items: ChatUser[]; page: number; limit: number }>(
    `/api/chat/users?q=${encodeURIComponent(q)}&page=${page}`,
    { signal },
  );
export const fetchChats = (page = 1, signal?: AbortSignal) =>
  apiRequest<List<Conversation>>(`/api/chat/conversations?page=${page}`, {
    signal,
  });
export const fetchConversation = (id: string, signal?: AbortSignal) =>
  apiRequest<Conversation>(chatPath(id), { signal });
export const newChat = (userIds: string[], title: string) =>
  apiRequest<{ id: string }>("/api/chat/conversations", {
    method: "POST",
    body: JSON.stringify({ userIds, title }),
  });
export const fetchMessages = (
  id: string,
  cursor?: { before?: string; after?: string },
  signal?: AbortSignal,
) =>
  apiRequest<{ items: Message[]; hasMore: boolean }>(
    `${chatPath(id)}/messages${cursor ? "?" + new URLSearchParams(cursor).toString() : ""}`,
    { signal },
  );
export const sendMessage = (id: string, body: string, clientId: string) =>
  apiRequest<Message>(chatPath(id) + "/messages", {
    method: "POST",
    body: JSON.stringify({ body, clientId }),
  });
export const readChat = (id: string, lastId: string) =>
  apiRequest(chatPath(id) + "/read", {
    method: "PATCH",
    body: JSON.stringify({ lastId }),
  });
export const chatStatus = (id: string, status: string) =>
  apiRequest(chatPath(id) + "/status", {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
export type Audience =
  | { mode: "all" }
  | { mode: "users"; userIds: string[] }
  | { mode: "group"; groupId: string };
export type CampaignInput = {
  clientId: string;
  title: string;
  body: string;
  channel: string;
  severity: string;
  actionUrl: string;
  audience: Audience;
};
export const communicationUsers = (q = "", page = 1, signal?: AbortSignal) =>
  apiRequest<{ items: Recipient[]; page: number; limit: number }>(
    `/api/admin/communication-users?q=${encodeURIComponent(q)}&page=${page}`,
    { signal },
  );
export const previewAudience = (audience: Audience) =>
  apiRequest<{ count: number }>("/api/admin/communications/preview", {
    method: "POST",
    body: JSON.stringify(audience),
  });
export const sendCampaign = (input: CampaignInput) =>
  apiRequest<Campaign>("/api/admin/communications", {
    method: "POST",
    body: JSON.stringify(input),
  });
export const fetchCampaigns = (page = 1, signal?: AbortSignal) =>
  apiRequest<List<Campaign>>(`/api/admin/communications?page=${page}`, {
    signal,
  });
export const campaignAction = (id: string, action: "retry" | "cancel") =>
  apiRequest(
    `/api/admin/communications/${encodeURIComponent(id)}/${action === "retry" ? "retry" : "queue"}`,
    { method: action === "retry" ? "POST" : "DELETE" },
  );
export const fetchDeliveries = (id: string, page = 1, signal?: AbortSignal) =>
  apiRequest<
    List<{
      id: string;
      email: string;
      status: string;
      attempts: number;
      errorCode: string | null;
      sentAt: string | null;
    }>
  >(
    `/api/admin/communications/${encodeURIComponent(id)}/deliveries?page=${page}`,
    { signal },
  );
export const fetchGroups = (page = 1, signal?: AbortSignal) =>
  apiRequest<List<Group>>(`/api/admin/communication-groups?page=${page}`, {
    signal,
  });
export const fetchGroup = (id: string) =>
  apiRequest<{
    id: string;
    name: string;
    version: string;
    members: Recipient[];
  }>(`/api/admin/communication-groups/${encodeURIComponent(id)}`);
export const saveGroup = (
  id: string | null,
  name: string,
  userIds: string[],
  version?: string,
) =>
  apiRequest(
    `/api/admin/communication-groups${id ? "/" + encodeURIComponent(id) : ""}`,
    {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({ name, userIds, ...(id ? { version } : {}) }),
    },
  );
export const deleteGroup = (id: string) =>
  apiRequest(`/api/admin/communication-groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
export function startCommunicationUpdates(owner: string): () => void {
  let stopped = false,
    socket: WebSocket | null = null,
    retry: ReturnType<typeof setTimeout> | null = null,
    poll: ReturnType<typeof setTimeout> | null = null,
    refreshing = false,
    delay = 1000;
  const controller = new AbortController();
  const valid = () => !stopped && sessionState.value?.userId === owner;
  const refresh = async (announce = true) => {
    if (!valid() || refreshing || document.hidden) return;
    refreshing = true;
    try {
      await fetchNotifications(
        notificationState.value?.page ?? 1,
        controller.signal,
        announce,
      );
      if (valid()) communicationRevision.value++;
    } catch {
      /* polling failures don't flood toasts */
    } finally {
      refreshing = false;
    }
  };
  const tick = () => {
    if (!valid()) return;
    void refresh();
    poll = setTimeout(tick, 15000);
  };
  const connect = () => {
    if (!valid()) return;
    realtimeStatus.value = "connecting";
    socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/realtime`,
    );
    socket.onopen = () => {
      if (!valid()) {
        socket?.close();
        return;
      }
      delay = 1000;
      realtimeStatus.value = "online";
      void refresh(false);
    };
    socket.onmessage = (e) => {
      if (!valid()) return;
      try {
        const event = JSON.parse(String(e.data));
        if (["notifications", "chat", "ready"].includes(event.type))
          void refresh(event.type !== "ready");
      } catch {}
    };
    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      socket = null;
      if (!valid()) return;
      realtimeStatus.value = "offline";
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };
  };
  const focus = () => void refresh(false);
  document.addEventListener("visibilitychange", focus);
  void refresh(false);
  poll = setTimeout(tick, 15000);
  connect();
  return () => {
    stopped = true;
    controller.abort();
    if (retry) clearTimeout(retry);
    if (poll) clearTimeout(poll);
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    document.removeEventListener("visibilitychange", focus);
    realtimeStatus.value = "offline";
  };
}
