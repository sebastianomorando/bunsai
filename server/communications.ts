import { sql, type SQL } from "bun";
import { createHash } from "node:crypto";
import type { Bundana } from "../lib/Bundana";
import Session from "../entities/Session";
import { requireActiveAdmin, requireUuid } from "./adminAuth";
import { accountTransaction } from "./userAdmin";
import { safeDatabaseError } from "./databaseAdmin";
import {
  errorToResponse,
  NotAuthenticatedError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from "./errors";
import { validateSetupOrigin } from "./setup";
import {
  enforceRateLimit,
  enforceRequestRateLimit,
  type RateLimitPolicyName,
} from "./rateLimit";
import {
  audienceInput,
  campaignInput,
  fields,
  pageInput,
  readCommunicationJson,
  text,
  userIds,
  uuidArray,
} from "./communicationValidation";
import {
  communicationHint,
  configureCommunicationRealtime,
} from "./communicationRealtime";
type Actor = { id: string; session: string };
async function write<T>(
  actor: Actor,
  admin: boolean,
  run: (tx: SQL) => Promise<T>,
): Promise<T> {
  return accountTransaction(admin ? actor.id : null, async (tx) => {
    const [active] =
      await tx`SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=${actor.session} AND s.user_id=${actor.id} AND s.expires_at>now() AND u.is_active=true FOR SHARE OF s,u`;
    if (!active) throw new NotAuthenticatedError();
    return run(tx);
  });
}
async function audience(
  tx: SQL,
  input: ReturnType<typeof audienceInput>,
): Promise<string[]> {
  let rows: { id: string }[];
  if (input.mode === "all")
    rows =
      await tx`SELECT id FROM users WHERE is_active=true ORDER BY id LIMIT 5001`;
  else if (input.mode === "users")
    rows =
      await tx`SELECT id FROM users WHERE is_active=true AND id=ANY(${uuidArray(input.userIds)}::uuid[]) ORDER BY id`;
  else {
    const [group] =
      await tx`SELECT id FROM communication_groups WHERE id=${input.groupId}`;
    if (!group) throw new NotFoundError();
    rows =
      await tx`SELECT u.id FROM communication_group_members m JOIN users u ON u.id=m.user_id AND u.is_active=true WHERE m.group_id=${input.groupId} ORDER BY u.id LIMIT 5001`;
  }
  if (!rows.length || rows.length > 5000)
    throw new ValidationError("Seleziona da 1 a 5000 utenti attivi");
  return rows.map((r) => String(r.id));
}
const notificationProjection = sql`n.id,n.type,n.title,n.body,n.severity,n.action_url AS "actionUrl",n.created_at AS "createdAt",r.read_at AS "readAt"`;
async function listNotifications(id: string, req: Request) {
  const { page, limit, offset } = pageInput(req);
  const [count] =
    await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE read_at IS NULL)::int AS unread FROM notification_recipients WHERE user_id=${id} AND dismissed_at IS NULL`;
  const items =
    await sql`SELECT ${notificationProjection} FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE r.user_id=${id} AND r.dismissed_at IS NULL ORDER BY n.created_at DESC,n.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return { items, ...count, page, limit };
}
async function campaignSummary(tx: SQL, id: string) {
  const [row] =
    await tx`SELECT c.id,c.title,c.body,c.channel,c.severity,c.action_url AS "actionUrl",c.recipient_count AS "recipientCount",c.created_at AS "createdAt",(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'processing',count(*) FILTER(WHERE status='processing'),'sent',count(*) FILTER(WHERE status='sent'),'failed',count(*) FILTER(WHERE status='failed'),'cancelled',count(*) FILTER(WHERE status='cancelled')) FROM communication_email_jobs WHERE campaign_id=c.id) AS delivery FROM communication_campaigns c WHERE c.id=${id}`;
  if (!row) throw new NotFoundError();
  return row;
}
async function createCampaign(actor: Actor, input: unknown) {
  const data = campaignInput(input);
  const normalized = {
    ...data,
    audience:
      data.audience.mode === "users"
        ? { ...data.audience, userIds: [...data.audience.userIds].sort() }
        : data.audience,
  };
  const requestHash = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  return write(actor, true, async (tx) => {
    const [existing] =
      await tx`SELECT id,request_hash FROM communication_campaigns WHERE created_by=${actor.id} AND client_id=${data.clientId}`;
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new ConflictError("Identificativo già utilizzato");
      return {
        campaign: await campaignSummary(tx, existing.id),
        recipients: [],
      };
    }
    const recipients = await audience(tx, data.audience),
      id = Bun.randomUUIDv7();
    if (data.channel !== "notification") {
      const [queued] =
        await tx`SELECT count(*)::int AS total FROM communication_email_jobs WHERE status IN ('pending','processing')`;
      if (queued.total + recipients.length > 10000)
        throw new ConflictError("Coda email piena", {
          code: "COMMUNICATION_QUEUE_FULL",
        });
    }
    await tx`INSERT INTO communication_campaigns (id,created_by,client_id,request_hash,title,body,channel,severity,action_url,recipient_count) VALUES (${id},${actor.id},${data.clientId},${requestHash},${data.title},${data.body},${data.channel},${data.severity},${data.actionUrl},${recipients.length})`;
    if (data.channel !== "email") {
      const [notification] =
        await tx`INSERT INTO notifications (campaign_id,type,title,body,severity,action_url) VALUES (${id},'admin.custom',${data.title},${data.body},${data.severity},${data.actionUrl}) RETURNING id`;
      await tx`INSERT INTO notification_recipients (notification_id,user_id) SELECT ${notification.id},id FROM users WHERE id=ANY(${uuidArray(recipients)}::uuid[])`;
    }
    if (data.channel !== "notification")
      await tx`INSERT INTO communication_email_jobs (campaign_id,user_id,recipient_email) SELECT ${id},id,email FROM users WHERE id=ANY(${uuidArray(recipients)}::uuid[])`;
    return { campaign: await campaignSummary(tx, id), recipients };
  });
}
async function groupDetail(tx: SQL, id: string) {
  const [group] =
    await tx`SELECT id,name,xmin::text AS version FROM communication_groups WHERE id=${id}`;
  if (!group) throw new NotFoundError();
  const members =
    await tx`SELECT u.id,u.username,u.email,u.is_active AS "isActive" FROM communication_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=${id} ORDER BY u.username`;
  return { ...group, members };
}
async function saveGroup(actor: Actor, id: string | null, input: unknown) {
  const data = fields(input, ["name", "userIds", "version"]),
    name = text(data.name, 100),
    ids = userIds(data.userIds);
  if (
    id &&
    (typeof data.version !== "string" || !/^\d{1,10}$/.test(data.version))
  )
    throw new ValidationError("Versione richiesta");
  return write(actor, true, async (tx) => {
    const members =
      await tx`SELECT id FROM users WHERE id=ANY(${uuidArray(ids)}::uuid[])`;
    if (members.length !== ids.length)
      throw new ValidationError("Utente non trovato");
    const groupId = id ?? Bun.randomUUIDv7();
    if (id) {
      const rows =
        await tx`UPDATE communication_groups SET name=${name} WHERE id=${id} AND xmin::text=${data.version} RETURNING id`;
      if (!rows.length)
        throw new ConflictError("Il gruppo è cambiato, ricarica i dati", {
          code: "DATABASE_STALE_ROW",
        });
      await tx`DELETE FROM communication_group_members WHERE group_id=${id}`;
    } else
      await tx`INSERT INTO communication_groups (id,name,created_by) VALUES (${groupId},${name},${actor.id})`;
    await tx`INSERT INTO communication_group_members (group_id,user_id) SELECT ${groupId},unnest(${uuidArray(ids)}::uuid[])`;
    return groupDetail(tx, groupId);
  });
}
async function participant(tx: SQL, id: string, user: string) {
  const [row] =
    await tx`SELECT c.id,c.status,c.title FROM chat_conversations c JOIN chat_participants p ON p.conversation_id=c.id WHERE c.id=${id} AND p.user_id=${user}`;
  if (!row) throw new NotFoundError("Conversazione non trovata");
  return row;
}
const conversationProjection = sql`c.id,c.title,c.status,c.updated_at AS "updatedAt",
 (SELECT jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'isActive',u.is_active) ORDER BY u.username) FROM chat_participants p JOIN users u ON u.id=p.user_id WHERE p.conversation_id=c.id) AS participants,
 (SELECT count(*)::int FROM chat_messages m WHERE m.conversation_id=c.id AND m.sender_id IS DISTINCT FROM own.user_id AND (own.last_read_id IS NULL OR m.id>own.last_read_id)) AS unread,
 (SELECT body FROM chat_messages m WHERE m.conversation_id=c.id ORDER BY id DESC LIMIT 1) AS "lastMessage"`;
async function conversations(user: string, req: Request) {
  const { page, limit, offset } = pageInput(req);
  const [count] =
    await sql`SELECT count(*)::int AS total FROM chat_participants WHERE user_id=${user}`;
  const items =
    await sql`SELECT ${conversationProjection} FROM chat_conversations c JOIN chat_participants own ON own.conversation_id=c.id WHERE own.user_id=${user} ORDER BY c.updated_at DESC,c.id DESC LIMIT ${limit} OFFSET ${offset}`;
  return { items, total: count.total, page, limit };
}
async function createChat(actor: Actor, input: unknown) {
  const data = fields(input, ["userIds", "title"]),
    ids = userIds(data.userIds, 19).filter((id) => id !== actor.id);
  if (!ids.length) throw new ValidationError("Seleziona un altro utente");
  const title = ids.length > 1 ? text(data.title, 200) : "";
  return write(actor, false, async (tx) => {
    const active =
      await tx`SELECT id FROM users WHERE id=ANY(${uuidArray(ids)}::uuid[]) AND is_active=true`;
    if (active.length !== ids.length)
      throw new ValidationError("Utente non disponibile");
    const participants = [...ids, actor.id].sort(),
      key = ids.length === 1 ? participants.join(":") : null;
    if (key) {
      const [existing] =
        await tx`SELECT id FROM chat_conversations WHERE direct_key=${key}`;
      if (existing) return { id: existing.id };
    }
    const id = Bun.randomUUIDv7();
    await tx`INSERT INTO chat_conversations (id,title,direct_key) VALUES (${id},${title},${key})`;
    await tx`INSERT INTO chat_participants (conversation_id,user_id) SELECT ${id},unnest(${uuidArray(participants)}::uuid[])`;
    return { id };
  });
}
async function chatMessages(user: string, id: string, req: Request) {
  await participant(sql, id, user);
  const params = new URL(req.url).searchParams;
  const before = params.get("before"),
    after = params.get("after");
  if (before && after) throw new ValidationError("Cursor non valido");
  if (before) requireUuid(before);
  if (after) requireUuid(after);
  // Query construction only chooses fixed SQL templates; values remain bound.
  const projection = sql`m.id,m.body,m.sender_id AS "senderId",u.username AS "senderName",m.created_at AS "createdAt"`;
  const rows = after
    ? await sql`SELECT ${projection} FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=${id} AND m.id>${after} ORDER BY m.id LIMIT 51`
    : before
      ? await sql`SELECT ${projection} FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=${id} AND m.id<${before} ORDER BY m.id DESC LIMIT 51`
      : await sql`SELECT ${projection} FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=${id} ORDER BY m.id DESC LIMIT 51`;
  const hasMore = rows.length > 50,
    items = rows.slice(0, 50);
  if (!after) items.reverse();
  return { items, hasMore };
}
async function sendMessage(actor: Actor, id: string, input: unknown) {
  const data = fields(input, ["body", "clientId"]),
    body = text(data.body, 4000),
    clientId = requireUuid(data.clientId);
  return write(actor, false, async (tx) => {
    const conversation = await participant(tx, id, actor.id);
    const [old] =
      await tx`SELECT id,body,sender_id AS "senderId",created_at AS "createdAt" FROM chat_messages WHERE conversation_id=${id} AND sender_id=${actor.id} AND client_id=${clientId}`;
    if (old) {
      if (old.body !== body)
        throw new ConflictError("Identificativo già utilizzato");
      return { message: old, recipients: [] };
    }
    if (conversation.status !== "open")
      throw new ConflictError("Conversazione chiusa", { code: "CHAT_CLOSED" });
    const idMessage = Bun.randomUUIDv7();
    const [message] =
      await tx`INSERT INTO chat_messages (id,conversation_id,sender_id,client_id,body) VALUES (${idMessage},${id},${actor.id},${clientId},${body}) RETURNING id,body,sender_id AS "senderId",created_at AS "createdAt"`;
    await tx`UPDATE chat_conversations SET updated_at=now() WHERE id=${id}`;
    const recipients = (
      await tx`SELECT p.user_id FROM chat_participants p JOIN users u ON u.id=p.user_id AND u.is_active=true WHERE p.conversation_id=${id}`
    ).map((r: { user_id: string }) => String(r.user_id));
    const [sender] = await tx`SELECT username FROM users WHERE id=${actor.id}`;
    const targets = recipients.filter((user: string) => user !== actor.id);
    if (targets.length) {
      const [n] =
        await tx`INSERT INTO notifications (type,title,body,action_url) VALUES ('chat.message',${String(sender.username)},${body},${"/chat?conversation=" + id}) RETURNING id`;
      await tx`INSERT INTO notification_recipients (notification_id,user_id) SELECT ${n.id},unnest(${uuidArray(targets)}::uuid[])`;
    }
    return { message: { ...message, senderName: sender.username }, recipients };
  });
}
export function registerCommunications(app: Bundana<unknown>) {
  configureCommunicationRealtime(app);
  const route = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    admin: boolean,
    run: (
      actor: Actor,
      req: Bun.BunRequest,
      server: Bun.Server<unknown>,
    ) => Promise<unknown>,
    policy?: RateLimitPolicyName,
  ) => {
    app.add(method, path, async (req, server) => {
      try {
        let actor: Actor;
        if (admin) {
          const id = await requireActiveAdmin(req);
          actor = { id, session: req.cookies.get("session_id")! };
        } else {
          const session = await Session.getFromRequest(req);
          if (!session) throw new NotAuthenticatedError();
          actor = { id: session.userId, session: session.id };
        }
        if (method !== "GET") validateSetupOrigin(req);
        else if (req.headers.get("Sec-Fetch-Site") === "cross-site")
          validateSetupOrigin(req);
        await enforceRequestRateLimit(
          policy ??
            (method === "GET" ? "communicationRead" : "communicationWrite"),
          req,
          server,
          actor.id,
        );
        if (policy === "chatSend")
          await enforceRateLimit("chatDaily", "key", actor.id);
        const result = await run(actor, req, server);
        return Response.json(result, {
          status:
            method === "POST" &&
            (path === "/api/admin/communications" ||
              path === "/api/chat/conversations" ||
              path === "/api/admin/communication-groups")
              ? 201
              : 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch (e) {
        const response = errorToResponse(safeDatabaseError(e));
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
    });
  };
  const param = (req: Bun.BunRequest, key = "id") =>
    requireUuid(
      (req as Bun.BunRequest & { params: Record<string, string> }).params[key],
    );
  route("GET", "/api/chat/conversations/:id", false, async (a, r) => {
    const [conversation] =
      await sql`SELECT ${conversationProjection} FROM chat_conversations c JOIN chat_participants own ON own.conversation_id=c.id WHERE own.user_id=${a.id} AND c.id=${param(r)}`;
    if (!conversation) throw new NotFoundError();
    return conversation;
  });
  route("GET", "/api/notifications", false, (a, r) =>
    listNotifications(a.id, r),
  );
  route("POST", "/api/notifications/read-all", false, (a, _r, s) =>
    write(a, false, async (tx) => {
      await tx`UPDATE notification_recipients SET read_at=now() WHERE user_id=${a.id} AND read_at IS NULL AND dismissed_at IS NULL`;
      return { read: true };
    }).then((result) => {
      communicationHint(s, [a.id], "notifications");
      return result;
    }),
  );
  for (const [method, suffix] of [
    ["PATCH", "/read"],
    ["DELETE", ""],
  ] as const)
    route(method, "/api/notifications/:id" + suffix, false, (a, r, s) =>
      write(a, false, async (tx) => {
        const rows =
          method === "PATCH"
            ? await tx`UPDATE notification_recipients SET read_at=COALESCE(read_at,now()) WHERE user_id=${a.id} AND notification_id=${param(r)} AND dismissed_at IS NULL RETURNING notification_id`
            : await tx`UPDATE notification_recipients SET dismissed_at=now(),read_at=COALESCE(read_at,now()) WHERE user_id=${a.id} AND notification_id=${param(r)} AND dismissed_at IS NULL RETURNING notification_id`;
        if (!rows.length) throw new NotFoundError();
        return { saved: true };
      }).then((result) => {
        communicationHint(s, [a.id], "notifications");
        return result;
      }),
    );
  route("GET", "/api/chat/users", false, async (a, r) => {
    const q = new URL(r.url).searchParams.get("q") ?? "";
    if (q.length > 100) throw new ValidationError("Ricerca non valida");
    const { page, limit, offset } = pageInput(r);
    const items =
      await sql`SELECT id,username FROM users WHERE is_active=true AND id<>${a.id} AND strpos(lower(username),lower(${q}))>0 ORDER BY username,id LIMIT ${limit} OFFSET ${offset}`;
    return { items, page, limit };
  });
  route("GET", "/api/chat/conversations", false, (a, r) =>
    conversations(a.id, r),
  );
  route(
    "POST",
    "/api/chat/conversations",
    false,
    async (a, r, s) => {
      const result = await createChat(a, await readCommunicationJson(r));
      const users =
        await sql`SELECT user_id FROM chat_participants WHERE conversation_id=${result.id}`;
      communicationHint(
        s,
        users.map((u: { user_id: string }) => u.user_id),
        "chat",
      );
      return result;
    },
    "chatCreate",
  );
  route("GET", "/api/chat/conversations/:id/messages", false, (a, r) =>
    chatMessages(a.id, param(r), r),
  );
  route(
    "POST",
    "/api/chat/conversations/:id/messages",
    false,
    async (a, r, s) => {
      const result = await sendMessage(
        a,
        param(r),
        await readCommunicationJson(r),
      );
      communicationHint(s, result.recipients, "chat");
      communicationHint(s, result.recipients, "notifications");
      return result.message;
    },
    "chatSend",
  );
  route("PATCH", "/api/chat/conversations/:id/read", false, async (a, r, s) => {
    const data = fields(await readCommunicationJson(r), ["lastId"]),
      lastId = requireUuid(data.lastId),
      id = param(r);
    return write(a, false, async (tx) => {
      await participant(tx, id, a.id);
      const [message] =
        await tx`SELECT id FROM chat_messages WHERE id=${lastId} AND conversation_id=${id}`;
      if (!message) throw new NotFoundError();
      const changed =
        await tx`UPDATE chat_participants SET last_read_id=${lastId}::uuid WHERE conversation_id=${id} AND user_id=${a.id} AND (last_read_id IS NULL OR last_read_id<${lastId}::uuid) RETURNING user_id`;
      await tx`UPDATE notification_recipients r SET read_at=COALESCE(read_at,now()) FROM notifications n WHERE r.notification_id=n.id AND r.user_id=${a.id} AND r.read_at IS NULL AND n.type='chat.message' AND n.action_url=${"/chat?conversation=" + id} AND n.created_at<=(SELECT created_at FROM chat_messages WHERE id=${lastId})`;
      return { read: true, changed: changed.length > 0 };
    }).then((result) => {
      if (result.changed) communicationHint(s, [a.id], "notifications");
      return result;
    });
  });
  route(
    "PATCH",
    "/api/chat/conversations/:id/status",
    false,
    async (a, r, s) => {
      const data = fields(await readCommunicationJson(r), ["status"]);
      if (data.status !== "open" && data.status !== "closed")
        throw new ValidationError("Stato non valido");
      const id = param(r);
      return write(a, false, async (tx) => {
        await participant(tx, id, a.id);
        await tx`UPDATE chat_conversations SET status=${data.status},updated_at=now() WHERE id=${id}`;
        return { saved: true };
      }).then(async (result) => {
        const users =
          await sql`SELECT user_id FROM chat_participants WHERE conversation_id=${id}`;
        communicationHint(
          s,
          users.map((u: { user_id: string }) => u.user_id),
          "chat",
        );
        return result;
      });
    },
  );
  route("GET", "/api/admin/communication-users", true, async (_a, r) => {
    const q = new URL(r.url).searchParams.get("q") ?? "";
    if (q.length > 100) throw new ValidationError("Ricerca non valida");
    const { page, limit, offset } = pageInput(r);
    const items =
      await sql`SELECT id,username,email,is_active AS "isActive" FROM users WHERE strpos(lower(username||' '||email),lower(${q}))>0 ORDER BY username,id LIMIT ${limit} OFFSET ${offset}`;
    return { items, page, limit };
  });
  route("POST", "/api/admin/communications/preview", true, async (a, r) => {
    const data = audienceInput(await readCommunicationJson(r));
    return write(a, true, async (tx) => ({
      count: (await audience(tx, data)).length,
    }));
  });
  route(
    "POST",
    "/api/admin/communications",
    true,
    async (a, r, s) => {
      const result = await createCampaign(a, await readCommunicationJson(r));
      communicationHint(s, result.recipients, "notifications");
      return result.campaign;
    },
    "communicationCampaign",
  );
  route("GET", "/api/admin/communications", true, async (_a, r) => {
    const { page, limit, offset } = pageInput(r);
    const [count] =
      await sql`SELECT count(*)::int AS total FROM communication_campaigns`;
    const rows =
      await sql`SELECT id FROM communication_campaigns ORDER BY created_at DESC,id DESC LIMIT ${limit} OFFSET ${offset}`;
    return {
      items: await Promise.all(
        rows.map((row: { id: string }) => campaignSummary(sql, row.id)),
      ),
      page,
      limit,
      total: count.total,
    };
  });
  route(
    "GET",
    "/api/admin/communications/:id/deliveries",
    true,
    async (_a, r) => {
      const { page, limit, offset } = pageInput(r),
        id = param(r);
      await campaignSummary(sql, id);
      const [count] =
        await sql`SELECT count(*)::int AS total FROM communication_email_jobs WHERE campaign_id=${id}`;
      const items =
        await sql`SELECT id,recipient_email AS email,status,attempts,error_code AS "errorCode",sent_at AS "sentAt" FROM communication_email_jobs WHERE campaign_id=${id} ORDER BY created_at,id LIMIT ${limit} OFFSET ${offset}`;
      return { items, page, limit, total: count.total };
    },
  );
  route(
    "POST",
    "/api/admin/communications/:id/retry",
    true,
    (a, r) =>
      write(a, true, async (tx) => {
        await campaignSummary(tx, param(r));
        const [queue] =
          await tx`SELECT count(*)::int AS total FROM communication_email_jobs WHERE status IN ('pending','processing')`;
        const [failed] =
          await tx`SELECT count(*)::int AS total FROM communication_email_jobs WHERE campaign_id=${param(r)} AND status='failed' AND attempts<3`;
        if (queue.total + failed.total > 10000)
          throw new ConflictError("Coda email piena");
        const rows =
          await tx`UPDATE communication_email_jobs SET status='pending',error_code=NULL,started_at=NULL WHERE campaign_id=${param(r)} AND status='failed' AND attempts<3 RETURNING id`;
        return { queued: rows.length };
      }),
    "communicationCampaign",
  );
  route("DELETE", "/api/admin/communications/:id/queue", true, (a, r) =>
    write(a, true, async (tx) => {
      await campaignSummary(tx, param(r));
      const rows =
        await tx`UPDATE communication_email_jobs SET status='cancelled' WHERE campaign_id=${param(r)} AND status='pending' RETURNING id`;
      return { cancelled: rows.length };
    }),
  );
  route("GET", "/api/admin/communication-groups", true, async (_a, r) => {
    const { page, limit, offset } = pageInput(r);
    const [count] =
      await sql`SELECT count(*)::int AS total FROM communication_groups`;
    const items =
      await sql`SELECT g.id,g.name,(SELECT count(*)::int FROM communication_group_members m WHERE m.group_id=g.id) AS "memberCount" FROM communication_groups g ORDER BY name,id LIMIT ${limit} OFFSET ${offset}`;
    return { items, page, limit, total: count.total };
  });
  route("GET", "/api/admin/communication-groups/:id", true, (_a, r) =>
    groupDetail(sql, param(r)),
  );
  route("POST", "/api/admin/communication-groups", true, async (a, r) =>
    saveGroup(a, null, await readCommunicationJson(r)),
  );
  route("PATCH", "/api/admin/communication-groups/:id", true, async (a, r) =>
    saveGroup(a, param(r), await readCommunicationJson(r)),
  );
  route("DELETE", "/api/admin/communication-groups/:id", true, (a, r) =>
    write(a, true, async (tx) => {
      const rows =
        await tx`DELETE FROM communication_groups WHERE id=${param(r)} RETURNING id`;
      if (!rows.length) throw new NotFoundError();
      return { deleted: true };
    }),
  );
}
