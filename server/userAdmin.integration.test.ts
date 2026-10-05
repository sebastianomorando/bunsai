import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { createInvitationToken, hashInvitationToken } from "./invitations";
const enabled = process.env.USER_ADMIN_INTEGRATION === "1";
let server: Bun.Server<unknown>,
  origin: string,
  actor: string,
  userId: string,
  adminCookie: string,
  userCookie: string,
  inactiveCookie: string;
const password = "TestPassword123!";
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  cookie = adminCookie,
  source = origin,
) =>
  fetch(origin + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: source,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const editData = (detail: any, changes: Record<string, unknown> = {}) => ({
  username: detail.user.username,
  email: detail.user.email,
  role: detail.user.role,
  isActive: detail.user.isActive,
  version: detail.version,
  ...changes,
});
async function fixture(role = "user", active = true) {
  const id = Bun.randomUUIDv7();
  await sql`INSERT INTO users (id,username,email,password,role,is_active) VALUES (${id},${id},${id + "@example.test"},${await Bun.password.hash(password)},${role},${active})`;
  const { default: Session } = await import("../entities/Session");
  const session = await Session.initNewSession(id);
  return { id, cookie: `session_id=${session.id}`, secret: session.id };
}
async function seededInvite(
  email = Bun.randomUUIDv7() + "@example.test",
  role = "user",
) {
  const id = Bun.randomUUIDv7(),
    token = createInvitationToken();
  await sql`INSERT INTO user_invitations (id,email,role,invited_by,token_hash,expires_at) VALUES (${id},${email},${role},${actor},${hashInvitationToken(token)},${new Date(Date.now() + 60000)})`;
  return { id, token, email };
}
async function emailToken(email: string) {
  const messages = await (
    await fetch("http://127.0.0.1:8025/api/v1/messages?limit=100")
  ).json();
  const message = messages.messages.find((m: any) =>
    m.To.some((to: any) => to.Address === email),
  );
  expect(message).toBeDefined();
  const detail = await (
    await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`)
  ).json();
  const token = String(detail.Text).match(/#token=([\w-]{43})/)?.[1];
  expect(token).toBeDefined();
  return token!;
}
describe.skipIf(!enabled)("PostgreSQL user management and Mailpit", () => {
  beforeAll(async () => {
    if (
      new URL(process.env.DATABASE_URL ?? "").pathname !==
        "/bunsai_user_admin_tests" ||
      process.env.NODE_ENV === "production"
    )
      throw new Error("Use only disposable bunsai_user_admin_tests");
    await sql`TRUNCATE user_invitations,password_resets,sessions,users,rate_limits CASCADE`;
    const { Bundana } = await import("../lib/Bundana");
    const { registerUserAdmin } = await import("./userAdmin");
    const { registerClassRoutes } = await import("./decorators");
    const { default: User } = await import("../entities/User");
    const app = new Bundana();
    registerClassRoutes(app, User);
    registerUserAdmin(app);
    const { registerDatabaseAdmin } = await import("./databaseAdmin");
    registerDatabaseAdmin(app);
    server = app.listen({ hostname: "127.0.0.1", port: 0 });
    origin = `http://127.0.0.1:${server.port}`;
    process.env.APP_URL = origin;
    process.env.TRUSTED_PROXY_IPS = "";
    process.env.MAIL_SERVER = "127.0.0.1";
    process.env.MAIL_PORT = "1025";
    process.env.MAIL_SECURE = "false";
    process.env.MAIL_FROM_EMAIL = "admin-tests@example.test";
    const a = await fixture("admin"),
      u = await fixture(),
      i = await fixture("admin", false);
    actor = a.id;
    adminCookie = a.cookie;
    userId = u.id;
    userCookie = u.cookie;
    inactiveCookie = i.cookie;
  });
  afterAll(async () => {
    server?.stop(true);
    await sql.close();
  });
  test("all management endpoints require an active administrator", async () => {
    for (const cookie of ["", userCookie, inactiveCookie])
      for (const [path, method] of [
        ["/api/admin/users", "POST"],
        [`/api/admin/users/${userId}`, "GET"],
        [`/api/admin/users/${userId}`, "PATCH"],
        [`/api/admin/users/${userId}/sessions`, "GET"],
        [`/api/admin/users/${userId}/sessions`, "DELETE"],
        [`/api/admin/users/${userId}/sessions/${userId}`, "DELETE"],
        [`/api/admin/users/${userId}/password-reset`, "POST"],
        ["/api/admin/invitations", "GET"],
        ["/api/admin/invitations", "POST"],
        [`/api/admin/invitations/${userId}/resend`, "POST"],
        [`/api/admin/invitations/${userId}`, "DELETE"],
      ] as const)
        expect(
          (
            await request(
              path,
              method,
              method === "GET" ? undefined : {},
              cookie,
            )
          ).status,
        ).toBe(cookie ? 403 : 401);
  });
  test("blocks CSRF, oversized bodies and privilege injection", async () => {
    expect(
      (
        await request(
          "/api/admin/users",
          "POST",
          {},
          adminCookie,
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/admin/users", "POST", {
          username: "x".repeat(9000),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/admin/users", "POST", {
          username: "user",
          email: "test@example.test",
          password,
          role: "root",
          isActive: true,
        })
      ).status,
    ).toBe(422);
  });
  test("creates accounts with safe DTOs, hashed passwords and collision checks", async () => {
    const response = await request("/api/admin/users", "POST", {
      username: "managed-user",
      email: "MANAGED@EXAMPLE.TEST",
      password,
      role: "user",
      isActive: true,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user.email).toBe("managed@example.test");
    expect(JSON.stringify(body)).not.toContain(password);
    expect(body.user.password).toBeUndefined();
    expect(body.version).toMatch(/^\d+$/);
    const [row] =
      await sql`SELECT password FROM users WHERE id=${body.user.id}`;
    expect(await Bun.password.verify(password, row.password)).toBe(true);
    expect(
      (
        await request("/api/admin/users", "POST", {
          username: "other-name",
          email: "managed@example.test",
          password,
          role: "admin",
          isActive: true,
        })
      ).status,
    ).toBe(409);
  });
  test("details return opaque session IDs and revoke only the selected session", async () => {
    const { default: Session } = await import("../entities/Session");
    const second = await Session.initNewSession(userId);
    const listing = await request(`/api/admin/users/${userId}/sessions`);
    const body = await listing.json();
    expect(body.total).toBe(2);
    expect(JSON.stringify(body)).not.toContain(userCookie.split("=")[1]!);
    expect(JSON.stringify(body)).not.toContain(second.id);
    expect(
      (
        await request(
          `/api/admin/users/${actor}/sessions/${body.items[0].id}`,
          "DELETE",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/api/admin/users/${userId}/sessions/${body.items[0].id}`,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await request(`/api/admin/users/${userId}/sessions`)).json())
        .total,
    ).toBe(1);
    const current = await (
      await request(`/api/admin/users/${actor}/sessions`)
    ).json();
    expect(current.items[0].current).toBe(true);
  });
  test("optimistic edits prevent lost updates and security edits end sessions", async () => {
    const target = await fixture(),
      path = `/api/admin/users/${target.id}`;
    const detail = await (await request(path)).json();
    const responses = await Promise.all(
      ["changed-one", "changed-two"].map((username) =>
        request(path, "PATCH", editData(detail, { username })),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await (await request(path + "/sessions")).json()).total).toBe(1);
    const fresh = await (await request(path)).json();
    expect(
      (
        await request(
          path,
          "PATCH",
          editData(fresh, { email: "new-email@example.test", role: "admin" }),
        )
      ).status,
    ).toBe(200);
    expect((await (await request(path + "/sessions")).json()).total).toBe(0);
    expect(
      (await request("/api/admin/invitations", "GET", undefined, target.cookie))
        .status,
    ).toBe(401);
    const self = await (await request(`/api/admin/users/${actor}`)).json();
    expect(
      (
        await request(
          `/api/admin/users/${actor}`,
          "PATCH",
          editData(self, { role: "user" }),
        )
      ).status,
    ).toBe(422);
  });
  test("preserves email confirmation on non-security edits and checks current privileges", async () => {
    const target = await fixture("user", false);
    await sql`UPDATE users SET activation_token='confirmation-hash',activation_token_expires_at=now()+interval '1 hour' WHERE id=${target.id}`;
    const detail = await (
      await request(`/api/admin/users/${target.id}`)
    ).json();
    expect(
      (
        await request(
          `/api/admin/users/${target.id}`,
          "PATCH",
          editData(detail, { username: "unconfirmed-renamed" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await sql`SELECT activation_token FROM users WHERE id=${target.id}`)[0]
        .activation_token,
    ).toBe("confirmation-hash");
    await sql`UPDATE users SET role='user' WHERE id=${actor}`;
    expect((await request("/api/admin/invitations")).status).toBe(403);
    await sql`UPDATE users SET role='admin' WHERE id=${actor}`;
  });
  test("sends usable reset email and reset invalidates sessions and reused tokens", async () => {
    const target = await fixture();
    const [user] = await sql`SELECT email FROM users WHERE id=${target.id}`;
    expect(
      (await request(`/api/admin/users/${target.id}/password-reset`, "POST"))
        .status,
    ).toBe(200);
    const token = await emailToken(user.email);
    const reset = await request(
      "/api/password-reset",
      "POST",
      { token, newPassword: "NewPassword123!" },
      "",
    );
    expect(reset.status).toBe(200);
    expect(
      (await sql`SELECT id FROM sessions WHERE user_id=${target.id}`).length,
    ).toBe(0);
    expect(
      (
        await request(
          "/api/password-reset",
          "POST",
          { token, newPassword: "OtherPassword123!" },
          "",
        )
      ).status,
    ).not.toBe(200);
  });
  test("invites via SMTP, rotates links on resend and accepts exactly once", async () => {
    const email = Bun.randomUUIDv7() + "@example.test";
    const created = await request("/api/admin/invitations", "POST", {
      email,
      role: "user",
      locale: "en",
    });
    expect(created.status).toBe(201);
    const invite = await created.json();
    expect(invite.token_hash).toBeUndefined();
    const oldToken = await emailToken(email);
    expect(
      (await request(`/api/admin/invitations/${invite.id}/resend`, "POST"))
        .status,
    ).toBe(200);
    const token = await emailToken(email);
    expect(token).not.toBe(oldToken);
    expect(
      (
        await request(
          "/api/invitations/inspect",
          "POST",
          { token: oldToken },
          "",
        )
      ).status,
    ).toBe(403);
    const inspection = await request(
      "/api/invitations/inspect",
      "POST",
      { token },
      "",
    );
    expect(inspection.status).toBe(200);
    expect((await inspection.json()).email).toBe(email);
    expect(
      (
        await request(
          "/api/invitations/accept",
          "POST",
          { token, username: "invited-test", password, role: "admin" },
          "",
        )
      ).status,
    ).toBe(422);
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(
          "/api/invitations/accept",
          "POST",
          { token, username: "invited-test", password },
          "",
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 403]);
    const [user] =
      await sql`SELECT role,is_active,password FROM users WHERE email=${email}`;
    expect(user.role).toBe("user");
    expect(user.is_active).toBe(true);
    expect(await Bun.password.verify(password, user.password)).toBe(true);
    expect(
      (await request("/api/invitations/inspect", "POST", { token }, "")).status,
    ).toBe(403);
  });
  test("rejects revoked, expired, existing-email and unauthorized-inviter invitations", async () => {
    const expired = await seededInvite();
    await sql`UPDATE user_invitations SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
    expect(
      (
        await request(
          "/api/invitations/inspect",
          "POST",
          { token: expired.token },
          "",
        )
      ).status,
    ).toBe(403);
    const revoked = await seededInvite();
    expect(
      (await request(`/api/admin/invitations/${revoked.id}`, "DELETE")).status,
    ).toBe(200);
    expect(
      (
        await request(
          "/api/invitations/inspect",
          "POST",
          { token: revoked.token },
          "",
        )
      ).status,
    ).toBe(403);
    const target = await fixture();
    const [user] = await sql`SELECT email FROM users WHERE id=${target.id}`;
    const existing = await seededInvite(user.email, "admin");
    expect(
      (
        await request(
          "/api/invitations/accept",
          "POST",
          { token: existing.token, username: "promoted-by-invite", password },
          "",
        )
      ).status,
    ).toBe(409);
    expect(
      (await sql`SELECT role FROM users WHERE id=${target.id}`)[0].role,
    ).toBe("user");
    const invite = await seededInvite();
    await sql`UPDATE users SET is_active=false WHERE id=${actor}`;
    expect(
      (
        await request(
          "/api/invitations/accept",
          "POST",
          { token: invite.token, username: "unauthorized-invite", password },
          "",
        )
      ).status,
    ).toBe(403);
    await sql`UPDATE users SET is_active=true WHERE id=${actor}`;
  });
  test("email recipient limit prevents repeated reset abuse", async () => {
    const target = await fixture();
    for (let i = 0; i < 3; i++)
      expect(
        (await request(`/api/admin/users/${target.id}/password-reset`, "POST"))
          .status,
      ).toBe(200);
    expect(
      (await request(`/api/admin/users/${target.id}/password-reset`, "POST"))
        .status,
    ).toBe(429);
  });
  test("expired and malformed cookies cannot authenticate", async () => {
    expect(
      (
        await request(
          "/api/admin/invitations",
          "GET",
          undefined,
          "session_id=invalid",
        )
      ).status,
    ).toBe(401);
    const expired = await fixture("admin");
    await sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=${expired.id}`;
    expect(
      (
        await request(
          "/api/admin/invitations",
          "GET",
          undefined,
          expired.cookie,
        )
      ).status,
    ).toBe(401);
  });
  test("SMTP failures invalidate only the newly generated credentials", async () => {
    const { adminSendPasswordReset, createUserInvitation } = await import(
      "./userAdmin"
    );
    const target = await fixture();
    const previous = process.env.MAIL_FROM_EMAIL;
    try {
      delete process.env.MAIL_FROM_EMAIL;
      await expect(
        adminSendPasswordReset(actor, target.id),
      ).rejects.toMatchObject({ status: 503, code: "MAIL_DELIVERY_FAILED" });
      expect(
        (await sql`SELECT id FROM password_resets WHERE user_id=${target.id}`)
          .length,
      ).toBe(0);
      const email = Bun.randomUUIDv7() + "@example.test";
      await expect(
        createUserInvitation(actor, { email, role: "user", locale: "it" }),
      ).rejects.toMatchObject({ status: 503, code: "MAIL_DELIVERY_FAILED" });
      const [row] =
        await sql`SELECT token_hash,revoked_at FROM user_invitations WHERE email=${email}`;
      expect(row.token_hash).toBeNull();
      expect(row.revoked_at).not.toBeNull();
    } finally {
      process.env.MAIL_FROM_EMAIL = previous;
    }
  });
  test("concurrent administrators cannot eliminate the last active admin", async () => {
    const { adminUserDetail, updateAdminManagedUser } = await import(
      "./userAdmin"
    );
    const first = await fixture("admin"),
      second = await fixture("admin");
    const original =
      await sql`SELECT id FROM users WHERE role='admin' AND id<>${first.id} AND id<>${second.id}`;
    try {
      await sql`UPDATE users SET role='user' WHERE role='admin' AND id<>${first.id} AND id<>${second.id}`;
      const a = await adminUserDetail(sql, first.id),
        b = await adminUserDetail(sql, second.id);
      const results = await Promise.allSettled([
        updateAdminManagedUser(
          first.id,
          second.id,
          editData(b, { role: "user" }),
        ),
        updateAdminManagedUser(
          second.id,
          first.id,
          editData(a, { role: "user" }),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      expect(
        (
          await sql`SELECT count(*)::int AS total FROM users WHERE role='admin' AND is_active=true`
        )[0].total,
      ).toBe(1);
      const winner = (
        await sql`SELECT id FROM users WHERE role='admin' AND is_active=true`
      )[0].id;
      const winnerCookie = winner === first.id ? first.cookie : second.cookie;
      expect(
        (
          await request(
            "/api/profile",
            "PATCH",
            {
              email: "only-admin-changed@example.test",
              currentPassword: password,
            },
            winnerCookie,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await sql`SELECT count(*)::int AS total FROM users WHERE role='admin' AND is_active=true`
        )[0].total,
      ).toBe(1);
    } finally {
      for (const row of original)
        await sql`UPDATE users SET role='admin' WHERE id=${row.id}`;
      await sql`DELETE FROM users WHERE id=${first.id} OR id=${second.id}`;
    }
  });
  test("in-flight profile edits cannot resurrect revoked credentials or disabled accounts", async () => {
    for (const disable of [false, true]) {
      const target = await fixture("admin");
      await sql`UPDATE users SET api_token=${target.id},activation_token='old-confirmation',activation_token_expires_at=now()+interval '1 hour' WHERE id=${target.id}`;
      let response: Promise<Response> | undefined;
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(1742268051)`;
        response = request(
          "/api/profile",
          "PATCH",
          { username: "racing-" + target.id },
          target.cookie,
        );
        let waiting = false;
        for (let i = 0; i < 100; i++) {
          const rows =
            await sql`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(1742268051)%'`;
          if (rows.length) {
            waiting = true;
            break;
          }
          await Bun.sleep(10);
        }
        expect(waiting).toBe(true);
        await tx`UPDATE users SET role='user',is_active=${!disable},api_token=NULL,activation_token=NULL,activation_token_expires_at=NULL WHERE id=${target.id}`;
        await tx`DELETE FROM sessions WHERE user_id=${target.id}`;
      });
      expect((await response!).status).toBe(disable ? 401 : 200);
      const [row] =
        await sql`SELECT api_token,activation_token,is_active FROM users WHERE id=${target.id}`;
      expect(row.api_token).toBeNull();
      expect(row.activation_token).toBeNull();
      expect(row.is_active).toBe(!disable);
    }
  });

  test("new sessions bound metadata and ignore untrusted forwarded IPs", async () => {
    const response = await fetch(origin + "/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Browser " + "a".repeat(500),
        "X-Forwarded-For": "203.0.113.25",
      },
      body: JSON.stringify({ username: userId, password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .get("Set-Cookie")
      ?.match(/session_id=([^;]+)/)?.[1];
    expect(cookie).toBeDefined();
    const [session] =
      await sql`SELECT management_id,user_agent,ip_address FROM sessions WHERE id=${cookie}`;
    expect(session.management_id).not.toBe(cookie);
    expect(session.user_agent.length).toBe(255);
    expect(session.ip_address).toBe("127.0.0.1");
  });
  test("revoking the current session clears the cookie and immediately ends access", async () => {
    const target = await fixture("admin");
    const list = await (
      await request(
        `/api/admin/users/${target.id}/sessions`,
        "GET",
        undefined,
        target.cookie,
      )
    ).json();
    expect(list.items[0].current).toBe(true);
    const revoked = await request(
      `/api/admin/users/${target.id}/sessions/${list.items[0].id}`,
      "DELETE",
      undefined,
      target.cookie,
    );
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).loggedOut).toBe(true);
    expect(revoked.headers.get("Set-Cookie")).toContain("session_id=;");
    expect(
      (await request("/api/admin/invitations", "GET", undefined, target.cookie))
        .status,
    ).toBe(401);
  });
  test("the generic database editor cannot expose tokens or bypass invitation lifecycle", async () => {
    expect(
      (
        await request("/api/database/tables/user_invitations/rows", "POST", {
          values: { email: "bypass@example.test", role: "admin" },
        })
      ).status,
    ).toBe(403);
    const response = await request(
      "/api/database/tables/user_invitations/rows",
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: any) => row.values.token_hash === null)).toBe(true);
  });
});
