import { useEffect, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { UserPicker } from "../components/UserPicker";
import * as api from "../communicationApi";
import {
  communicationRevision,
  type ChatUser,
  type Conversation,
  type Message,
  type List,
} from "../communicationState";
import { errorMessage, setError, sessionState } from "../state";
import { t, localeState } from "../i18n";
export function ChatPage() {
  const owner = sessionState.value?.userId;
  if (!owner)
    return (
      <section class="panel">
        <h2>{t("users.authRequiredTitle")}</h2>
        <a href="/login">{t("users.goToLogin")}</a>
      </section>
    );
  return <ChatWorkspace key={owner} owner={owner} />;
}
function ChatWorkspace({ owner }: { owner: string }) {
  const { route, url } = useLocation();
  const selectedId =
    new URL(url, location.origin).searchParams.get("conversation") ?? "";
  const [list, setList] = useState<List<Conversation> | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [hasMore, setMore] = useState(false),
    [history, setHistory] = useState(false),
    [draft, setDraft] = useState(""),
    [users, setUsers] = useState<ChatUser[]>([]),
    [title, setTitle] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const retry = useRef<{ body: string; id: string; chat: string } | null>(null);
  const revision = communicationRevision.value;
  const [selected, setSelected] = useState<Conversation | null>(null);
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const controller = new AbortController();
    void api
      .fetchConversation(selectedId, controller.signal)
      .then((c) => {
        if (!controller.signal.aborted) setSelected(c);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setSelected(null);
          setError(errorMessage(e));
        }
      });
    return () => controller.abort();
  }, [selectedId, revision]);
  const chatTitle = (c: Conversation) =>
    c.title ||
    c.participants
      .filter((p) => p.id !== owner)
      .map((p) => p.username)
      .join(", ");
  useEffect(() => {
    const controller = new AbortController();
    void api
      .fetchChats(list?.page ?? 1, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setList(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    setMessages([]);
    setHistory(false);
    setDraft("");
    retry.current = null;
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || history) return;
    const controller = new AbortController();
    setLoading(true);
    void api
      .fetchMessages(selectedId, undefined, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        setMessages(result.items);
        setMore(result.hasMore);
        if (result.items.length)
          await api.readChat(selectedId, result.items.at(-1)!.id);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, revision, history]);
  useEffect(() => {
    if (!history) end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.at(-1)?.id, history]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function older() {
    if (!messages[0]) return;
    const result = await api.fetchMessages(selectedId, {
      before: messages[0].id,
    });
    setHistory(true);
    setMessages(result.items);
    setMore(result.hasMore);
  }
  async function newer() {
    if (!messages.length) return;
    const result = await api.fetchMessages(selectedId, {
      after: messages.at(-1)!.id,
    });
    if (result.items.length) {
      setMessages(result.items);
      if (!result.hasMore) setHistory(false);
    } else setHistory(false);
  }
  return (
    <section class="panel">
      <div class="row">
        <h2>{t("com.chat")}</h2>
        <button
          class="button"
          type="button"
          onClick={() => setCreating(!creating)}
        >
          {t("com.newChat")}
        </button>
      </div>
      <p class="muted">{t("com.recipientHint")}</p>
      {creating && (
        <form
          class="form chat-create"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const chat = await api.newChat(
                users.map((u) => u.id),
                title,
              );
              setCreating(false);
              setUsers([]);
              setTitle("");
              setList(await api.fetchChats());
              route("/chat?conversation=" + chat.id);
            });
          }}
        >
          <UserPicker
            selected={users}
            onChange={setUsers}
            max={19}
            disabled={busy}
          />
          <p class="muted">{t("com.chatLimit")}</p>
          {users.length > 1 && (
            <label>
              {t("com.groupTitle")}
              <input
                required
                maxLength={200}
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </label>
          )}
          <button class="button" disabled={busy || !users.length}>
            {t("com.newChat")}
          </button>
        </form>
      )}
      <div class="chat-layout">
        <aside class="chat-sidebar">
          {!list ? (
            <p>{t("detail.loading")}</p>
          ) : !list.items.length ? (
            <p>{t("com.noChats")}</p>
          ) : (
            list.items.map((chat) => (
              <button
                type="button"
                class={`chat-choice ${chat.id === selectedId ? "is-selected" : ""}`}
                key={chat.id}
                onClick={() => route("/chat?conversation=" + chat.id)}
              >
                <strong>{chatTitle(chat)}</strong>
                {chat.unread > 0 && <b class="unread-badge">{chat.unread}</b>}
                <p>{chat.lastMessage || t("com.noMessages")}</p>
                <small>
                  {chat.status === "closed"
                    ? t("com.closed")
                    : new Date(chat.updatedAt).toLocaleString(
                        localeState.value,
                      )}
                </small>
              </button>
            ))
          )}
          {list && (
            <div class="pagination">
              <button
                class="button ghost"
                disabled={busy || list.page <= 1}
                onClick={() =>
                  void run(async () =>
                    setList(await api.fetchChats(list.page - 1)),
                  )
                }
              >
                {t("users.prev")}
              </button>
              <button
                class="button ghost"
                disabled={busy || list.page * list.limit >= list.total}
                onClick={() =>
                  void run(async () =>
                    setList(await api.fetchChats(list.page + 1)),
                  )
                }
              >
                {t("users.next")}
              </button>
            </div>
          )}
        </aside>
        <section class="chat-main">
          {!selectedId ? (
            <p>{t("com.chooseChat")}</p>
          ) : (
            <>
              <div class="row">
                <h3>{selected ? chatTitle(selected) : t("com.chat")}</h3>
                {selected && (
                  <button
                    class="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.chatStatus(
                          selectedId,
                          selected.status === "open" ? "closed" : "open",
                        );
                        setList(await api.fetchChats(list?.page ?? 1));
                        setSelected(await api.fetchConversation(selectedId));
                      })
                    }
                  >
                    {t(
                      selected.status === "closed"
                        ? "com.reopenChat"
                        : "com.closeChat",
                    )}
                  </button>
                )}
              </div>
              <div class="rowactions">
                <button
                  type="button"
                  class="button ghost"
                  disabled={busy || !hasMore || !messages.length}
                  onClick={() => void run(older)}
                >
                  {t("com.older")}
                </button>
                {history && (
                  <>
                    <button
                      class="button ghost"
                      disabled={busy}
                      onClick={() => void run(newer)}
                    >
                      {t("com.newer")}
                    </button>
                    <button
                      class="button ghost"
                      type="button"
                      onClick={() => setHistory(false)}
                    >
                      {t("com.latest")}
                    </button>
                  </>
                )}
              </div>
              <div
                class="chat-messages"
                role="log"
                aria-label={t("com.chat")}
                aria-live="polite"
              >
                {loading && !messages.length ? (
                  <p>{t("detail.loading")}</p>
                ) : !messages.length ? (
                  <p>{t("com.noMessages")}</p>
                ) : (
                  messages.map((message) => (
                    <article
                      key={message.id}
                      class={`chat-message ${message.senderId === owner ? "own" : ""}`}
                    >
                      <strong>
                        {message.senderName || t("com.deletedUser")}
                      </strong>
                      <p>{message.body}</p>
                      <time>
                        {new Date(message.createdAt).toLocaleString(
                          localeState.value,
                        )}
                      </time>
                    </article>
                  ))
                )}
                <div ref={end} />
              </div>
              <form
                class="form chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    if (
                      !retry.current ||
                      retry.current.body !== draft ||
                      retry.current.chat !== selectedId
                    )
                      retry.current = {
                        body: draft,
                        id: crypto.randomUUID(),
                        chat: selectedId,
                      };
                    await api.sendMessage(selectedId, draft, retry.current.id);
                    setDraft("");
                    retry.current = null;
                    setHistory(false);
                    const result = await api.fetchMessages(selectedId);
                    setMessages(result.items);
                    setMore(result.hasMore);
                    setList(await api.fetchChats(list?.page ?? 1));
                    setSelected(await api.fetchConversation(selectedId));
                  });
                }}
              >
                <label>
                  {t("com.body")}
                  <textarea
                    required
                    maxLength={4000}
                    rows={3}
                    disabled={busy || selected?.status === "closed"}
                    value={draft}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                  />
                </label>
                <button
                  class="button"
                  disabled={
                    busy || !draft.trim() || selected?.status === "closed"
                  }
                >
                  {t("com.send")}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
