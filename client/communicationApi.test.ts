import { afterEach, expect, test } from "bun:test";
import { apiRequest } from "./api";
import { fetchNotifications } from "./communicationApi";
import { notificationState } from "./communicationState";
import { sessionState, profileState } from "./state";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  sessionState.value = null;
  profileState.value = null;
  notificationState.value = null;
});
test("a stale notification response cannot populate a different session", async () => {
  let complete!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((r) => (complete = r))) as unknown as typeof fetch;
  sessionState.value = { userId: "old", expiresAt: null };
  const pending = fetchNotifications();
  sessionState.value = { userId: "new", expiresAt: null };
  complete(
    Response.json({
      items: [{ id: "old-private" }],
      unread: 1,
      page: 1,
      limit: 30,
      total: 1,
    }),
  );
  await pending;
  expect(notificationState.value).toBeNull();
});
test("a stale unauthorized request does not log out a new session", async () => {
  let complete!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((r) => (complete = r))) as unknown as typeof fetch;
  sessionState.value = { userId: "old", expiresAt: null };
  const pending = apiRequest("/api/notifications");
  sessionState.value = { userId: "new", expiresAt: null };
  complete(
    Response.json(
      { error: "Authentication required", code: "NOT_AUTHENTICATED" },
      { status: 401 },
    ),
  );
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(sessionState.value?.userId).toBe("new");
});
