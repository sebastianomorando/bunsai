import { useEffect, useRef, useState } from "preact/hooks";
import { UserPicker } from "../components/UserPicker";
import * as api from "../communicationApi";
import type { Audience, CampaignInput } from "../communicationApi";
import type { Campaign, ChatUser, Group, List } from "../communicationState";
import {
  errorMessage,
  profileState,
  setError,
  setNotice,
  sessionState,
} from "../state";
import { t, localeState } from "../i18n";
const isAdmin = () =>
  profileState.value?.role === "admin" && profileState.value.isActive;
export function CommunicationsPage() {
  const owner = sessionState.value?.userId;
  if (!owner || !isAdmin())
    return (
      <section class="panel">
        <p>{t("database.adminOnly")}</p>
      </section>
    );
  return <CommunicationWorkspace key={owner} />;
}
function ReviewDialog({
  review,
  busy,
  close,
  send,
}: {
  review: CampaignInput & { count: number };
  busy: boolean;
  close: () => void;
  send: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      class="communication-review"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <h2>{t("com.review")}</h2>
      <p>{t("com.previewCount", { count: review.count })}</p>
      <p>
        {t("com.channel")}:{" "}
        {t(
          review.channel === "both"
            ? "com.both"
            : review.channel === "email"
              ? "com.email"
              : "com.notification",
        )}
      </p>
      <strong>{review.title}</strong>
      <p class="preserve-text">{review.body}</p>
      {review.actionUrl && <p>{review.actionUrl}</p>}
      <div class="rowactions">
        <button class="button ghost" disabled={busy} onClick={close}>
          {t("com.cancel")}
        </button>
        <button class="button" disabled={busy} onClick={send}>
          {t("com.confirmSend")}
        </button>
      </div>
    </dialog>
  );
}
function CommunicationWorkspace() {
  const [tab, setTab] = useState<"compose" | "groups" | "history">("compose");
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [channel, setChannel] = useState("notification"),
    [severity, setSeverity] = useState("info"),
    [actionUrl, setUrl] = useState(""),
    [mode, setMode] = useState<"all" | "users" | "group">("users"),
    [recipients, setRecipients] = useState<ChatUser[]>([]),
    [groupId, setGroupId] = useState(""),
    [groups, setGroups] = useState<List<Group> | null>(null),
    [history, setHistory] = useState<List<Campaign> | null>(null),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<(CampaignInput & { count: number }) | null>(
      null,
    ),
    [groupEdit, setGroupEdit] = useState<string | null>(null),
    [groupName, setGroupName] = useState(""),
    [groupMembers, setGroupMembers] = useState<ChatUser[]>([]),
    [deliveries, setDeliveries] = useState<Awaited<
      ReturnType<typeof api.fetchDeliveries>
    > | null>(null),
    [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [groupVersion, setGroupVersion] = useState<string | undefined>();
  const retry = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.fetchGroups(1, controller.signal),
      api.fetchCampaigns(1, controller.signal),
    ])
      .then(([g, h]) => {
        if (!controller.signal.aborted) {
          setGroups(g);
          setHistory(h);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (tab !== "history" || busy) return;
    const controller = new AbortController();
    let active = false;
    const timer = setInterval(async () => {
      if (document.hidden || active) return;
      active = true;
      try {
        const next = await api.fetchCampaigns(
          history?.page ?? 1,
          controller.signal,
        );
        if (!controller.signal.aborted) setHistory(next);
        if (deliveryId) {
          const details = await api.fetchDeliveries(
            deliveryId,
            deliveries?.page ?? 1,
            controller.signal,
          );
          if (!controller.signal.aborted) setDeliveries(details);
        }
      } catch {
        /* transient refresh errors don't flood toasts */
      } finally {
        active = false;
      }
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [tab, busy, history?.page, deliveryId, deliveries?.page]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const audience = (): Audience =>
    mode === "all"
      ? { mode: "all" }
      : mode === "group"
        ? { mode: "group", groupId }
        : { mode: "users", userIds: recipients.map((r) => r.id) };
  const errorLabel = (code: string | null) =>
    code === "DELIVERY_UNCERTAIN"
      ? t("com.uncertain")
      : code === "RECIPIENT_CHANGED"
        ? t("com.recipientChanged")
        : code
          ? t("com.unknownError")
          : "";
  return (
    <section class="panel">
      <h2>{t("com.communications")}</h2>
      <p class="muted">{t("com.adminHint")}</p>
      <div class="rowactions communication-tabs">
        {(["compose", "groups", "history"] as const).map((next) => (
          <button
            type="button"
            class={`button ${tab === next ? "" : "ghost"}`}
            onClick={() => setTab(next)}
          >
            {t(
              next === "compose"
                ? "com.send"
                : next === "groups"
                  ? "com.groups"
                  : "com.history",
            )}
          </button>
        ))}
      </div>
      {tab === "compose" && (
        <form
          class="form communication-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const target = audience(),
                preview = await api.previewAudience(target);
              const input = {
                title,
                body,
                channel,
                severity,
                actionUrl,
                audience: target,
              };
              const fingerprint = JSON.stringify(input);
              if (!retry.current || retry.current.fingerprint !== fingerprint)
                retry.current = { fingerprint, id: crypto.randomUUID() };
              setReview({
                ...input,
                clientId: retry.current.id,
                count: preview.count,
              });
            });
          }}
        >
          <fieldset disabled={busy}>
            <label>
              {t("com.channel")}
              <select
                aria-label={t("com.channel")}
                value={channel}
                onChange={(e) => setChannel(e.currentTarget.value)}
              >
                <option value="notification">{t("com.notification")}</option>
                <option value="email">{t("com.email")}</option>
                <option value="both">{t("com.both")}</option>
              </select>
            </label>
            <label>
              {t("com.audience")}
              <select
                aria-label={t("com.audience")}
                value={mode}
                onChange={(e) => setMode(e.currentTarget.value as typeof mode)}
              >
                <option value="users">{t("com.users")}</option>
                <option value="all">{t("com.all")}</option>
                <option value="group">{t("com.group")}</option>
              </select>
            </label>
            {mode === "users" && (
              <UserPicker
                admin
                selected={recipients}
                onChange={setRecipients}
              />
            )}{" "}
            {mode === "group" && (
              <>
                <label>
                  {t("com.group")}
                  <select
                    required
                    aria-label={t("com.group")}
                    value={groupId}
                    onChange={(e) => setGroupId(e.currentTarget.value)}
                  >
                    <option value="">—</option>
                    {groupId &&
                      !groups?.items.some((g) => g.id === groupId) && (
                        <option aria-label={t("com.group")} value={groupId}>
                          {groupId}
                        </option>
                      )}
                    {groups?.items.map((g) => (
                      <option value={g.id}>
                        {g.name} ({g.memberCount})
                      </option>
                    ))}
                  </select>
                </label>
                {groups && (
                  <div class="pagination">
                    <button
                      class="button ghost"
                      type="button"
                      disabled={groups.page <= 1}
                      onClick={() =>
                        void run(async () =>
                          setGroups(await api.fetchGroups(groups.page - 1)),
                        )
                      }
                    >
                      {t("users.prev")}
                    </button>
                    <span>{groups.page}</span>
                    <button
                      class="button ghost"
                      type="button"
                      disabled={groups.page * groups.limit >= groups.total}
                      onClick={() =>
                        void run(async () =>
                          setGroups(await api.fetchGroups(groups.page + 1)),
                        )
                      }
                    >
                      {t("users.next")}
                    </button>
                  </div>
                )}
              </>
            )}
            <label>
              {t("com.title")}
              <input
                required
                maxLength={200}
                value={title}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("com.body")}
              <textarea
                required
                maxLength={4000}
                rows={8}
                value={body}
                onInput={(e) => setBody(e.currentTarget.value)}
              />
            </label>
            {channel !== "email" && (
              <>
                <label>
                  {t("com.severity")}
                  <select
                    aria-label={t("com.severity")}
                    value={severity}
                    onChange={(e) => setSeverity(e.currentTarget.value)}
                  >
                    {(["info", "success", "warning", "critical"] as const).map(
                      (s) => (
                        <option value={s}>{t(`com.${s}`)}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {t("com.actionUrl")}
                  <input
                    placeholder="/users"
                    maxLength={1000}
                    value={actionUrl}
                    onInput={(e) => setUrl(e.currentTarget.value)}
                  />
                </label>
              </>
            )}
            <button
              class="button"
              disabled={
                busy ||
                (mode === "users" && !recipients.length) ||
                (mode === "group" && !groupId)
              }
            >
              {t("com.review")}
            </button>
          </fieldset>
        </form>
      )}
      {review && (
        <ReviewDialog
          review={review}
          busy={busy}
          close={() => setReview(null)}
          send={() =>
            void run(async () => {
              const { count, ...input } = review;
              await api.sendCampaign(input);
              setReview(null);
              setTitle("");
              setBody("");
              setUrl("");
              retry.current = null;
              setNotice(t("com.queued"));
              setHistory(await api.fetchCampaigns());
              setTab("history");
            })
          }
        />
      )}
      {tab === "groups" && (
        <div class="communications-grid">
          <form
            class="form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api.saveGroup(
                  groupEdit,
                  groupName,
                  groupMembers.map((u) => u.id),
                  groupVersion,
                );
                setGroups(await api.fetchGroups(groups?.page ?? 1));
                setGroupEdit(null);
                setGroupName("");
                setGroupMembers([]);
                setNotice(t("com.groupSaved"));
              });
            }}
          >
            <h3>{t(groupEdit ? "com.editGroup" : "com.newGroup")}</h3>
            <p>{t("com.groupHint")}</p>
            <label>
              {t("com.groupName")}
              <input
                required
                maxLength={100}
                value={groupName}
                disabled={busy}
                onInput={(e) => setGroupName(e.currentTarget.value)}
              />
            </label>
            <UserPicker
              admin
              selected={groupMembers}
              onChange={setGroupMembers}
              disabled={busy}
            />
            <button class="button" disabled={busy || !groupMembers.length}>
              {t("com.saveGroup")}
            </button>
            {groupEdit && (
              <button
                type="button"
                class="button ghost"
                disabled={busy}
                onClick={() => {
                  setGroupEdit(null);
                  setGroupName("");
                  setGroupMembers([]);
                }}
              >
                {t("com.cancel")}
              </button>
            )}
          </form>
          <section>
            <h3>{t("com.groups")}</h3>
            {groups?.items.map((g) => (
              <article class="userrow" key={g.id}>
                <div>
                  <strong>{g.name}</strong>
                  <p>{t("com.selected", { count: g.memberCount })}</p>
                </div>
                <div class="rowactions">
                  <button
                    class="button ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const detail = await api.fetchGroup(g.id);
                        setGroupEdit(g.id);
                        setGroupName(detail.name);
                        setGroupVersion(detail.version);
                        setGroupMembers(detail.members);
                      })
                    }
                  >
                    {t("com.editGroup")}
                  </button>
                  <button
                    class="button danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(t("com.confirmDelete")))
                        void run(async () => {
                          await api.deleteGroup(g.id);
                          setGroups(await api.fetchGroups(groups?.page ?? 1));
                          if (groupId === g.id) setGroupId("");
                          if (groupEdit === g.id) {
                            setGroupEdit(null);
                            setGroupName("");
                            setGroupMembers([]);
                          }
                        });
                    }}
                  >
                    {t("com.deleteGroup")}
                  </button>
                </div>
              </article>
            ))}
            {groups && (
              <div class="pagination">
                <button
                  class="button ghost"
                  disabled={busy || groups.page <= 1}
                  onClick={() =>
                    void run(async () =>
                      setGroups(await api.fetchGroups(groups.page - 1)),
                    )
                  }
                >
                  {t("users.prev")}
                </button>
                <span>{groups.page}</span>
                <button
                  class="button ghost"
                  disabled={busy || groups.page * groups.limit >= groups.total}
                  onClick={() =>
                    void run(async () =>
                      setGroups(await api.fetchGroups(groups.page + 1)),
                    )
                  }
                >
                  {t("users.next")}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "history" && (
        <section>
          <div class="row">
            <h3>{t("com.history")}</h3>
            <button
              class="button ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setHistory(await api.fetchCampaigns(history?.page ?? 1));
                  if (deliveryId)
                    setDeliveries(
                      await api.fetchDeliveries(
                        deliveryId,
                        deliveries?.page ?? 1,
                      ),
                    );
                })
              }
            >
              {t("com.refresh")}
            </button>
          </div>
          {!history ? (
            <p>{t("detail.loading")}</p>
          ) : !history.items.length ? (
            <p>{t("com.emptyHistory")}</p>
          ) : (
            history.items.map((c) => (
              <article class="campaign-card" key={c.id}>
                <h4>{c.title}</h4>
                <p class="preserve-text">{c.body}</p>
                <p>
                  {new Date(c.createdAt).toLocaleString(localeState.value)} ·{" "}
                  {t("com.previewCount", { count: c.recipientCount })}
                </p>
                <p>
                  {t("com.pending")}: {c.delivery.pending} ·{" "}
                  {t("com.processing")}: {c.delivery.processing} ·{" "}
                  {t("com.delivered")}: {c.delivery.sent} · {t("com.failed")}:{" "}
                  {c.delivery.failed} · {t("com.cancelled")}:{" "}
                  {c.delivery.cancelled}
                </p>
                {c.channel !== "notification" && (
                  <div class="rowactions">
                    <button
                      class="button ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setDeliveries(await api.fetchDeliveries(c.id));
                          setDeliveryId(c.id);
                        })
                      }
                    >
                      {t("com.delivery")}
                    </button>
                    <button
                      class="button ghost"
                      disabled={busy || !c.delivery.failed}
                      onClick={() => {
                        if (confirm(t("com.confirmRetry")))
                          void run(async () => {
                            await api.campaignAction(c.id, "retry");
                            setHistory(await api.fetchCampaigns(history.page));
                          });
                      }}
                    >
                      {t("com.retry")}
                    </button>
                    <button
                      class="button danger"
                      disabled={busy || !c.delivery.pending}
                      onClick={() => {
                        if (confirm(t("com.confirmCancel")))
                          void run(async () => {
                            await api.campaignAction(c.id, "cancel");
                            setHistory(await api.fetchCampaigns(history.page));
                          });
                      }}
                    >
                      {t("com.cancelQueue")}
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
          {history && (
            <div class="pagination">
              <button
                class="button ghost"
                disabled={busy || history.page <= 1}
                onClick={() =>
                  void run(async () =>
                    setHistory(await api.fetchCampaigns(history.page - 1)),
                  )
                }
              >
                {t("users.prev")}
              </button>
              <span>{history.page}</span>
              <button
                class="button ghost"
                disabled={busy || history.page * history.limit >= history.total}
                onClick={() =>
                  void run(async () =>
                    setHistory(await api.fetchCampaigns(history.page + 1)),
                  )
                }
              >
                {t("users.next")}
              </button>
            </div>
          )}
          {deliveryId && deliveries && (
            <section class="delivery-panel">
              <h3>{t("com.delivery")}</h3>
              {!deliveries.items.length ? (
                <p>{t("com.noDeliveries")}</p>
              ) : (
                deliveries.items.map((d) => (
                  <article class="userrow" key={d.id}>
                    <strong>{d.email}</strong>
                    <span>
                      {t(
                        d.status === "sent"
                          ? "com.delivered"
                          : d.status === "pending"
                            ? "com.pending"
                            : d.status === "processing"
                              ? "com.processing"
                              : d.status === "failed"
                                ? "com.failed"
                                : "com.cancelled",
                      )}{" "}
                      · {t("com.attempts")}: {d.attempts}
                      {d.errorCode && <> · {errorLabel(d.errorCode)}</>}
                    </span>
                  </article>
                ))
              )}
              <div class="pagination">
                <button
                  class="button ghost"
                  disabled={busy || deliveries.page <= 1}
                  onClick={() =>
                    void run(async () =>
                      setDeliveries(
                        await api.fetchDeliveries(
                          deliveryId,
                          deliveries.page - 1,
                        ),
                      ),
                    )
                  }
                >
                  {t("users.prev")}
                </button>
                <button
                  class="button ghost"
                  disabled={
                    busy ||
                    deliveries.page * deliveries.limit >= deliveries.total
                  }
                  onClick={() =>
                    void run(async () =>
                      setDeliveries(
                        await api.fetchDeliveries(
                          deliveryId,
                          deliveries.page + 1,
                        ),
                      ),
                    )
                  }
                >
                  {t("users.next")}
                </button>
                <button
                  class="button ghost"
                  onClick={() => {
                    setDeliveryId(null);
                    setDeliveries(null);
                  }}
                >
                  {t("com.dismiss")}
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </section>
  );
}
