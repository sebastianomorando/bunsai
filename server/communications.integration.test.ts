import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { processCommunicationMail } from "./communicationMail";
const enabled = process.env.COMMUNICATION_INTEGRATION === "1";
let server: Bun.Server<unknown>, origin: string;
type Fixture = { id: string; cookie: string; email: string };
let admin: Fixture,
  alice: Fixture,
  bob: Fixture,
  outsider: Fixture,
  inactive: Fixture;
let directId: string, notificationId: string, campaignId: string;
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  who: Fixture | null = admin,
  source = origin,
) =>
  fetch(origin + path, {
    method,
    headers: {
      Cookie: who?.cookie ?? "",
      Origin: source,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (path: string, who = admin) =>
  await (await request(path, "GET", undefined, who)).json();
const campaign = (
  audience: any = { mode: "users", userIds: [alice.id] },
  channel = "both",
) => ({
  clientId: Bun.randomUUIDv7(),
  title: "Test <safe> title",
  body: "Custom test message\nOnly registered users.",
  channel,
  severity: "warning",
  actionUrl: "/users",
  audience,
});
async function fixture(
  name: string,
  role = "user",
  active = true,
): Promise<Fixture> {
  const id = Bun.randomUUIDv7(),
    email = id + "@example.test";
  await sql`INSERT INTO users(id,username,email,password,role,is_active) VALUES(${id},${name},${email},'fixture-not-a-password',${role},${active})`;
  const { default: Session } = await import("../entities/Session");
  const s = await Session.initNewSession(id);
  return { id, email, cookie: "session_id=" + s.id };
}
describe.skipIf(!enabled)("PostgreSQL communications and Mailpit", () => {
  beforeAll(async () => {
    if (
      new URL(process.env.DATABASE_URL ?? "").pathname !==
        "/bunsai_communication_tests" ||
      process.env.NODE_ENV === "production"
    )
      throw new Error("Use only disposable bunsai_communication_tests");
    await sql`TRUNCATE users,rate_limits CASCADE`;
    process.env.TRUSTED_PROXY_IPS = "";
    process.env.MAIL_SERVER = "127.0.0.1";
    process.env.MAIL_PORT = "1025";
    process.env.MAIL_SECURE = "false";
    process.env.MAIL_FROM_EMAIL = "communication-tests@example.test";
    const { Bundana } = await import("../lib/Bundana");
    const { registerCommunications } = await import("./communications");
    const { registerDatabaseAdmin } = await import("./databaseAdmin");
    const app = new Bundana();
    registerCommunications(app);
    registerDatabaseAdmin(app);
    server = app.listen({ hostname: "127.0.0.1", port: 0 });
    origin = `http://127.0.0.1:${server.port}`;
    process.env.APP_URL = origin;
    admin = await fixture("administrator", "admin");
    alice = await fixture("alice");
    bob = await fixture("bob");
    outsider = await fixture("outsider");
    inactive = await fixture("inactive", "user", false);
  });
  afterAll(async () => {
    server?.stop(true);
    await sql.close();
  });
  test("private APIs reject anonymous/inactive sessions and management rejects normal users", async () => {
    for (const path of [
      "/api/notifications",
      "/api/chat/users",
      "/api/chat/conversations",
      `/api/chat/conversations/${alice.id}`,
      `/api/chat/conversations/${alice.id}/messages`,
    ])
      for (const who of [null, inactive])
        expect((await request(path, "GET", undefined, who)).status).toBe(401);
    for (const [path, method] of [
      ["/api/admin/communication-users", "GET"],
      ["/api/admin/communications", "GET"],
      ["/api/admin/communications", "POST"],
      ["/api/admin/communications/preview", "POST"],
      ["/api/admin/communication-groups", "GET"],
      ["/api/admin/communication-groups", "POST"],
      [`/api/admin/communication-groups/${alice.id}`, "PATCH"],
      [`/api/admin/communication-groups/${alice.id}`, "DELETE"],
      [`/api/admin/communications/${alice.id}/deliveries`, "GET"],
      [`/api/admin/communications/${alice.id}/retry`, "POST"],
      [`/api/admin/communications/${alice.id}/queue`, "DELETE"],
    ] as const)
      for (const who of [null, alice])
        expect(
          (await request(path, method, method === "GET" ? undefined : {}, who))
            .status,
        ).toBe(who ? 403 : 401);
  });
  test("blocks CSRF and oversized bodies before writes", async () => {
    expect(
      (
        await request(
          "/api/chat/conversations",
          "POST",
          { userIds: [bob.id] },
          alice,
          "https://attacker.test",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "/api/admin/communications",
          "POST",
          campaign(),
          admin,
          "null",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/admin/communications", "POST", {
          body: "a".repeat(33000),
        })
      ).status,
    ).toBe(400);
  });
  test("chat directory reveals no emails, tokens or inactive users", async () => {
    const body = await json("/api/chat/users", alice);
    expect(body.items.map((u: any) => u.id)).not.toContain(inactive.id);
    expect(body.items.map((u: any) => u.id)).not.toContain(alice.id);
    expect(JSON.stringify(body)).not.toContain("@example.test");
    expect(
      body.items.every(
        (u: any) => Object.keys(u).sort().join(",") === "id,username",
      ),
    ).toBe(true);
    expect(
      (
        await json(
          "/api/chat/users?q=" + encodeURIComponent("' OR true--"),
          alice,
        )
      ).items,
    ).toEqual([]);
  });
  test("direct conversations are deduplicated concurrently and only participants can access them", async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(
          "/api/chat/conversations",
          "POST",
          { userIds: [bob.id] },
          alice,
        ),
      ),
    );
    const ids = await Promise.all(responses.map((r) => r.json()));
    expect(ids[0].id).toBe(ids[1].id);
    directId = ids[0].id;
    for (const who of [admin, outsider]) {
      expect(
        (
          await request(
            `/api/chat/conversations/${directId}/messages`,
            "GET",
            undefined,
            who,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            `/api/chat/conversations/${directId}/messages`,
            "POST",
            { body: "private", clientId: Bun.randomUUIDv7() },
            who,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            `/api/chat/conversations/${directId}/status`,
            "PATCH",
            { status: "closed" },
            who,
          )
        ).status,
      ).toBe(404);
    }
    expect(
      (
        await request(
          "/api/chat/conversations",
          "POST",
          { userIds: [inactive.id] },
          alice,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await request(
          "/api/chat/conversations",
          "POST",
          { userIds: [alice.id] },
          alice,
        )
      ).status,
    ).toBe(422);
  });
  test("chat messages and notifications are idempotent and isolated", async () => {
    const input = {
      body: "<img src=x onerror=alert(1)> hello",
      clientId: Bun.randomUUIDv7(),
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(
          `/api/chat/conversations/${directId}/messages`,
          "POST",
          input,
          alice,
        ),
      ),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const messages = await Promise.all(responses.map((r) => r.json()));
    expect(messages[0].id).toBe(messages[1].id);
    expect(
      (await json(`/api/chat/conversations/${directId}/messages`, bob)).items,
    ).toHaveLength(1);
    const notifs = await json("/api/notifications", bob);
    expect(notifs.unread).toBe(1);
    notificationId = notifs.items[0].id;
    expect((await json("/api/notifications", outsider)).unread).toBe(0);
    expect(
      (
        await request(
          `/api/notifications/${notificationId}/read`,
          "PATCH",
          undefined,
          alice,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/notifications/${notificationId}`,
          "DELETE",
          undefined,
          admin,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/messages`,
          "POST",
          { ...input, body: "different" },
          alice,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/messages`,
          "POST",
          { ...input, senderId: admin.id },
          alice,
        )
      ).status,
    ).toBe(422);
    const last = messages[0].id;
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/read`,
          "PATCH",
          { lastId: last },
          bob,
        )
      ).status,
    ).toBe(200);
    expect((await json("/api/notifications", bob)).unread).toBe(0);
    expect((await json("/api/chat/conversations", bob)).items[0].unread).toBe(
      0,
    );
  });
  test("group conversations, closed status and read cursors enforce membership", async () => {
    const created = await request(
      "/api/chat/conversations",
      "POST",
      { userIds: [bob.id, outsider.id], title: "Private group" },
      alice,
    );
    expect(created.status).toBe(201);
    const id = (await created.json()).id;
    expect(
      (
        await request(
          `/api/chat/conversations/${id}/status`,
          "PATCH",
          { status: "closed" },
          bob,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/chat/conversations/${id}/messages`,
          "POST",
          { body: "closed", clientId: Bun.randomUUIDv7() },
          alice,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          `/api/chat/conversations/${id}/read`,
          "PATCH",
          {
            lastId: (
              await json(`/api/chat/conversations/${directId}/messages`, alice)
            ).items[0].id,
          },
          outsider,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/chat/conversations/${id}/status`,
          "PATCH",
          { status: "open" },
          outsider,
        )
      ).status,
    ).toBe(200);
  });
  test("message history pagination preserves all records with bounded responses", async () => {
    for (let i = 0; i < 105; i++)
      await sql`INSERT INTO chat_messages(id,conversation_id,sender_id,client_id,body) VALUES(${Bun.randomUUIDv7()},${directId},${alice.id},${Bun.randomUUIDv7()},${"History " + i})`;
    const recent = await json(
      `/api/chat/conversations/${directId}/messages`,
      alice,
    );
    expect(recent.items).toHaveLength(50);
    expect(recent.hasMore).toBe(true);
    const older = await json(
      `/api/chat/conversations/${directId}/messages?before=${recent.items[0].id}`,
      alice,
    );
    expect(older.items).toHaveLength(50);
    expect(older.items.every((m: any) => m.id < recent.items[0].id)).toBe(true);
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/messages?before=invalid`,
          "GET",
          undefined,
          alice,
        )
      ).status,
    ).toBe(403);
  });
  test("saved groups are editable, preview excludes inactive users, campaign replay does not duplicate", async () => {
    const created = await request("/api/admin/communication-groups", "POST", {
      name: "Fixture group",
      userIds: [alice.id, bob.id, inactive.id],
    });
    expect(created.status).toBe(201);
    const group = await created.json();
    expect(group.members).toHaveLength(3);
    const preview = await request("/api/admin/communications/preview", "POST", {
      mode: "group",
      groupId: group.id,
    });
    expect((await preview.json()).count).toBe(2);
    const input = campaign({ mode: "group", groupId: group.id });
    const first = await request("/api/admin/communications", "POST", input);
    expect(first.status).toBe(201);
    const sent = await first.json();
    campaignId = sent.id;
    expect(sent.recipientCount).toBe(2);
    expect(sent.delivery.pending).toBe(2);
    const replay = await request("/api/admin/communications", "POST", input);
    expect((await replay.json()).id).toBe(sent.id);
    expect(
      (
        await request("/api/admin/communications", "POST", {
          ...input,
          audience: { mode: "users", userIds: [outsider.id] },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await sql`SELECT id FROM communication_email_jobs WHERE campaign_id=${sent.id}`
      ).length,
    ).toBe(2);
    expect(
      (
        await request(`/api/admin/communication-groups/${group.id}`, "PATCH", {
          name: "Updated group",
          userIds: [alice.id],
          version: group.version,
        })
      ).status,
    ).toBe(200);
    const revision = (await json(`/api/admin/communication-groups/${group.id}`))
      .version;
    const concurrent = await Promise.all(
      ["one", "two"].map((name) =>
        request(`/api/admin/communication-groups/${group.id}`, "PATCH", {
          name,
          userIds: [alice.id],
          version: revision,
        }),
      ),
    );
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await request(`/api/admin/communication-groups/${group.id}`, "DELETE"))
        .status,
    ).toBe(200);
    expect(
      (await sql`SELECT id FROM communication_campaigns WHERE id=${sent.id}`)
        .length,
    ).toBe(1);
  });
  test("custom notifications are visible only to their recipients and support read/dismiss", async () => {
    const list = await json("/api/notifications", alice);
    const custom = list.items.find((n: any) => n.type === "admin.custom");
    expect(custom.body).toContain("Custom test message");
    expect(custom.actionUrl).toBe("/users");
    expect(
      (await json("/api/notifications", outsider)).items.some(
        (n: any) => n.id === custom.id,
      ),
    ).toBe(false);
    expect(
      (
        await request(
          `/api/notifications/${custom.id}`,
          "DELETE",
          undefined,
          outsider,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/notifications/${custom.id}/read`,
          "PATCH",
          undefined,
          alice,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/notifications/${custom.id}`,
          "DELETE",
          undefined,
          alice,
        )
      ).status,
    ).toBe(200);
    expect(
      (await json("/api/notifications", alice)).items.some(
        (n: any) => n.id === custom.id,
      ),
    ).toBe(false);
  });
  test("outbox delivers individually through Mailpit and records SMTP failures safely", async () => {
    expect(await processCommunicationMail()).toBe(2);
    const rows =
      await sql`SELECT status FROM communication_email_jobs WHERE campaign_id=${campaignId}`;
    expect(rows.every((r: any) => r.status === "sent")).toBe(true);
    const messages = await (
      await fetch("http://127.0.0.1:8025/api/v1/messages?limit=100")
    ).json();
    const own = messages.messages.filter(
      (m: any) => m.From.Address === "communication-tests@example.test",
    );
    expect(own.length).toBeGreaterThanOrEqual(2);
    expect(own.every((m: any) => m.To.length === 1)).toBe(true);
    const input = campaign({ mode: "users", userIds: [outsider.id] }, "email");
    const id = Bun.randomUUIDv7();
    await sql`INSERT INTO communication_campaigns(id,created_by,client_id,request_hash,title,body,channel,severity,recipient_count) VALUES(${id},${admin.id},${input.clientId},'fixture','Failure fixture','failure','email','info',1)`;
    await sql`INSERT INTO communication_email_jobs(campaign_id,user_id,recipient_email) VALUES(${id},${outsider.id},${outsider.email})`;
    await processCommunicationMail(async () => {
      throw new Error("secret SMTP credentials");
    });
    const [job] =
      await sql`SELECT status,error_code FROM communication_email_jobs WHERE campaign_id=${id}`;
    expect(job.status).toBe("failed");
    expect(job.error_code).toBe("MAIL_DELIVERY_FAILED");
    const details = await json(`/api/admin/communications/${id}/deliveries`);
    expect(JSON.stringify(details)).not.toContain("secret SMTP");
    expect(
      (await request(`/api/admin/communications/${id}/retry`, "POST")).status,
    ).toBe(200);
    expect(
      (await request(`/api/admin/communications/${id}/queue`, "DELETE")).status,
    ).toBe(200);
  });
  test("pending delivery is cancelled after recipient email/status changes", async () => {
    const id = Bun.randomUUIDv7();
    await sql`INSERT INTO communication_campaigns(id,created_by,client_id,request_hash,title,body,channel,severity,recipient_count) VALUES(${id},${admin.id},${Bun.randomUUIDv7()},'fixture','Change fixture','change','email','info',1)`;
    await sql`INSERT INTO communication_email_jobs(campaign_id,user_id,recipient_email) VALUES(${id},${bob.id},${bob.email})`;
    await sql`UPDATE users SET email='changed-recipient@example.test' WHERE id=${bob.id}`;
    let sent = false;
    await processCommunicationMail(async () => {
      sent = true;
    });
    expect(sent).toBe(false);
    expect(
      (
        await sql`SELECT status FROM communication_email_jobs WHERE campaign_id=${id}`
      )[0].status,
    ).toBe("cancelled");
    await sql`UPDATE users SET email=${bob.email} WHERE id=${bob.id}`;
  });
  test("generic database editor cannot mutate messaging tables or reveal outbox recipients", async () => {
    for (const table of [
      "notifications",
      "notification_recipients",
      "chat_conversations",
      "chat_participants",
      "chat_messages",
      "communication_groups",
      "communication_group_members",
      "communication_campaigns",
      "communication_email_jobs",
    ]) {
      expect(
        (
          await request(`/api/database/tables/${table}/rows`, "POST", {
            values: {},
          })
        ).status,
      ).toBe(404);
      expect((await request(`/api/database/tables/${table}/rows`)).status).toBe(
        404,
      );
    }
  });
  test("realtime upgrade rejects bad origins and unauthenticated users", async () => {
    expect(
      (await request("/api/realtime", "GET", undefined, null)).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/realtime",
          "GET",
          undefined,
          alice,
          "https://attacker.test",
        )
      ).status,
    ).toBe(403);
    const connect = (who: Fixture) =>
      new Promise<WebSocket>((resolve, reject) => {
        const BunSocket = WebSocket as unknown as {
          new (
            url: string,
            options: { headers: Record<string, string> },
          ): WebSocket;
        };
        const ws = new BunSocket(
          origin.replace("http:", "ws:") + "/api/realtime",
          { headers: { Cookie: who.cookie, Origin: origin } },
        );
        ws.onopen = () => resolve(ws);
        ws.onerror = reject;
      });
    const ws = await connect(alice);
    const hint = new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        if (String(e.data).includes("notifications")) resolve(String(e.data));
      };
    });
    const { communicationHint } = await import("./communicationRealtime");
    communicationHint(server, [alice.id], "notifications");
    const payload = await hint;
    expect(JSON.parse(payload)).toEqual({ type: "notifications" });
    ws.close();
  });

  test("single and broadcast notifications target precisely the active accounts", async () => {
    await sql`DELETE FROM rate_limits WHERE scope IN ('communications.campaign.ip', 'communications.campaign.key')`;
    const single = await request(
      "/api/admin/communications",
      "POST",
      campaign({ mode: "users", userIds: [bob.id] }, "notification"),
    );
    expect(single.status).toBe(201);
    expect((await single.json()).recipientCount).toBe(1);
    const all = await request(
      "/api/admin/communications",
      "POST",
      campaign({ mode: "all" }, "notification"),
    );
    expect(all.status).toBe(201);
    const data = await all.json();
    expect(data.recipientCount).toBe(4);
    const recipients =
      await sql`SELECT r.user_id FROM notification_recipients r JOIN notifications n ON n.id=r.notification_id WHERE n.campaign_id=${data.id}`;
    expect(recipients.map((r: any) => r.user_id).sort()).toEqual(
      [admin.id, alice.id, bob.id, outsider.id].sort(),
    );
    const before =
      await sql`SELECT count(*)::int AS total FROM communication_campaigns`;
    await sql`UPDATE rate_limits SET request_count=6 WHERE scope IN ('communications.campaign.ip', 'communications.campaign.key')`;
    expect(
      (
        await request(
          "/api/admin/communications",
          "POST",
          campaign({ mode: "all" }, "notification"),
        )
      ).status,
    ).toBe(429);
    const count =
      await sql`SELECT count(*)::int AS total FROM communication_campaigns`;
    expect(count[0].total).toBe(before[0].total);
  });
  test("daily chat limits stop processing before a new message is inserted", async () => {
    const { rateLimitKeyHash } = await import("./rateLimit");
    const hash = rateLimitKeyHash("chat.daily.key", bob.id);
    await sql`INSERT INTO rate_limits(scope,key_hash,window_started_at,request_count,expires_at) VALUES('chat.daily.key',${hash},now(),1000,now()+interval '1 day') ON CONFLICT(scope,key_hash) DO UPDATE SET request_count=1000`;
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/messages`,
          "POST",
          { body: "limited", clientId: Bun.randomUUIDv7() },
          bob,
        )
      ).status,
    ).toBe(429);
    await sql`DELETE FROM rate_limits WHERE scope='chat.daily.key' AND key_hash=${hash}`;
  });
  test("uncertain deliveries never auto-resend and worker calls cannot overlap", async () => {
    const id = Bun.randomUUIDv7();
    await sql`INSERT INTO communication_campaigns(id,created_by,client_id,request_hash,title,body,channel,severity,recipient_count) VALUES(${id},${admin.id},${Bun.randomUUIDv7()},'fixture','Uncertain fixture','uncertain','email','info',1)`;
    await sql`INSERT INTO communication_email_jobs(campaign_id,user_id,recipient_email,status,attempts,started_at) VALUES(${id},${outsider.id},${outsider.email},'processing',1,now()-interval '6 minutes')`;
    let sent = false;
    await processCommunicationMail(async () => {
      sent = true;
    });
    expect(sent).toBe(false);
    expect(
      (
        await sql`SELECT error_code FROM communication_email_jobs WHERE campaign_id=${id}`
      )[0].error_code,
    ).toBe("DELIVERY_UNCERTAIN");
    await sql`UPDATE communication_email_jobs SET status='pending' WHERE campaign_id=${id}`;
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const pending = processCommunicationMail(async () => {
      await wait;
    });
    await Bun.sleep(10);
    expect(
      await processCommunicationMail(async () => {
        throw new Error("Must not run");
      }),
    ).toBe(0);
    release();
    await pending;
  });
  test("retention cleans old personal records without discarding queued email", async () => {
    const { runMaintenance } = await import("./maintenance");
    const id = Bun.randomUUIDv7();
    await sql`INSERT INTO notifications(id,type,title,body,created_at) VALUES(${id},'test.old','Old','old',now()-interval '400 days')`;
    await sql`INSERT INTO notification_recipients(notification_id,user_id) VALUES(${id},${bob.id})`;
    const messageId = Bun.randomUUIDv7();
    await sql`INSERT INTO chat_messages(id,conversation_id,sender_id,client_id,body,created_at) VALUES(${messageId},${directId},${alice.id},${Bun.randomUUIDv7()},'old message',now()-interval '800 days')`;
    const campaignId = Bun.randomUUIDv7();
    await sql`INSERT INTO communication_campaigns(id,created_by,client_id,request_hash,title,body,channel,severity,recipient_count,created_at) VALUES(${campaignId},${admin.id},${Bun.randomUUIDv7()},'fixture','Keep queued','pending','email','info',1,now()-interval '400 days')`;
    await sql`INSERT INTO communication_email_jobs(campaign_id,user_id,recipient_email) VALUES(${campaignId},${bob.id},${bob.email})`;
    const result = await runMaintenance(new Date(), undefined, async () => ({
      filesRemoved: 0,
      bytesRemoved: 0,
      bytesRemaining: 0,
      quotaSatisfied: true,
    }));
    expect(result.notifications).toBe(1);
    expect(result.chatMessages).toBe(1);
    expect(
      (await sql`SELECT id FROM communication_campaigns WHERE id=${campaignId}`)
        .length,
    ).toBe(1);
    expect(
      (
        await sql`SELECT notification_id FROM notification_recipients WHERE notification_id=${id}`
      ).length,
    ).toBe(0);
    await sql`UPDATE communication_email_jobs SET status='cancelled' WHERE campaign_id=${campaignId}`;
  });
  test("current role and session revocations immediately deny HTTP communication access", async () => {
    await sql`UPDATE users SET role='user' WHERE id=${admin.id}`;
    expect((await request("/api/admin/communications")).status).toBe(403);
    await sql`UPDATE users SET role='admin' WHERE id=${admin.id}`;
    await sql`DELETE FROM sessions WHERE user_id=${alice.id}`;
    expect(
      (
        await request(
          `/api/chat/conversations/${directId}/messages`,
          "GET",
          undefined,
          alice,
        )
      ).status,
    ).toBe(401);
  });
});
