import { signal } from "@preact/signals";
export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "critical";
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
};
export type List<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};
export type ChatUser = { id: string; username: string };
export type Conversation = {
  id: string;
  title: string;
  status: "open" | "closed";
  updatedAt: string;
  participants: (ChatUser & { isActive: boolean })[];
  unread: number;
  lastMessage: string | null;
};
export type Message = {
  id: string;
  body: string;
  senderId: string | null;
  senderName: string | null;
  createdAt: string;
};
export type Campaign = {
  id: string;
  title: string;
  body: string;
  channel: string;
  severity: string;
  actionUrl: string | null;
  recipientCount: number;
  createdAt: string;
  delivery: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    cancelled: number;
  };
};
export type Recipient = ChatUser & { email: string; isActive: boolean };
export type Group = { id: string; name: string; memberCount: number };
export const notificationState = signal<
  (List<Notification> & { unread: number }) | null
>(null);
export const communicationRevision = signal(0);
export const realtimeStatus = signal<"online" | "offline" | "connecting">(
  "offline",
);
export function resetCommunicationState() {
  notificationState.value = null;
  communicationRevision.value = 0;
  realtimeStatus.value = "offline";
}
