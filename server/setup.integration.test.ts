import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";

const enabled = process.env.SETUP_INTEGRATION === "1";
let server: Bun.Server<unknown>;
let origin: string;
const userIds: string[] = [];
const password = "InitialAdministrator123!";

describe.skipIf(!enabled)("initial setup with PostgreSQL", () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/bunsai_setup_tests" || process.env.NODE_ENV === "production") {
      throw new Error("Setup integration tests require a disposable bunsai_setup_tests database");
    }
    const { default: app } = await import("./app");
    const { default: Setup } = await import("./setup");
    const { default: User } = await import("../entities/User");
    const { registerClassRoutes } = await import("./decorators");
    registerClassRoutes(app, Setup);
    registerClassRoutes(app, User);
    server = app.listen({ hostname: "127.0.0.1", port: 0 });
    origin = `http://127.0.0.1:${server.port}`;
    process.env.APP_URL = origin;
    const [state] = await sql`SELECT completed FROM app_setup WHERE singleton = true`;
    if (!state || state.completed) throw new Error("Use a fresh migrated database for setup tests");
  });

  function create(input: unknown, requestOrigin = origin) {
    return fetch(`${origin}/api/setup`, { method: "POST", headers: { "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(input) });
  }

  test("advertises pending setup without disclosing account information", async () => {
    const status = await fetch(`${origin}/api/setup`);
    expect(status.headers.get("Cache-Control")).toBe("no-store");
    expect(await status.json()).toEqual({ required: true });
    expect((await create({ username: "admin", email: "admin@example.test", password }, "https://attacker.example")).status).toBe(403);
    expect((await create({ username: "admin", email: "admin@example.test", password: "short" })).status).toBe(422);
    expect((await sql`SELECT id FROM users WHERE role = 'admin'`).length).toBe(0);
  });

  test("does not promote existing users and rolls back failed setup", async () => {
    const id = Bun.randomUUIDv7();
    userIds.push(id);
    await sql`INSERT INTO users (id, username, email, password) VALUES (${id}, 'existinguser', 'existing@example.test', 'unused')`;
    const collision = await create({ username: "existinguser", email: "new@example.test", password });
    expect(collision.status).toBe(409);
    expect((await collision.json()).code).toBe("SETUP_ACCOUNT_EXISTS");
    const emailCollision = await create({ username: "newuser", email: "EXISTING@EXAMPLE.TEST", password });
    expect(emailCollision.status).toBe(409);
    expect((await (await fetch(`${origin}/api/setup`)).json()).required).toBe(true);
    const [user] = await sql`SELECT role FROM users WHERE id = ${id}`;
    expect(user.role).toBe("user");
  });

  test("rate limits setup before parsing or hashing credentials", async () => {
    await sql`UPDATE rate_limits SET request_count = 100000 WHERE scope = 'auth.initial-setup.ip'`;
    try {
      const response = await create({});
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect((await sql`SELECT id FROM users WHERE role = 'admin'`).length).toBe(0);
    } finally { await sql`DELETE FROM rate_limits WHERE scope = 'auth.initial-setup.ip'`; }
  });

  test("creates exactly one active admin across concurrent requests and allows login", async () => {
    const responses = await Promise.all([
      create({ username: "firstadmin", email: "first@example.test", password }),
      create({ username: "secondadmin", email: "second@example.test", password }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await responses.find((response) => response.status === 201)!.json()).toEqual({ created: true });
    const admins = await sql`SELECT * FROM users WHERE role = 'admin'`;
    expect(admins.length).toBe(1);
    const admin = admins[0];
    userIds.push(admin.id);
    expect(admin.is_active).toBe(true);
    expect(admin.activation_token).toBeNull();
    expect(admin.password).not.toBe(password);
    expect(await Bun.password.verify(password, admin.password)).toBe(true);
    const login = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password }) });
    expect(login.status).toBe(200);
    expect(login.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(await (await fetch(`${origin}/api/setup`)).json()).toEqual({ required: false });
    const closed = await create({ username: "anotheradmin", email: "another@example.test", password });
    expect(closed.status).toBe(409);
    expect((await closed.json()).code).toBe("SETUP_COMPLETED");
  });

  test("never reopens setup after the last admin is deleted", async () => {
    await sql`DELETE FROM users WHERE role = 'admin'`;
    expect(await (await fetch(`${origin}/api/setup`)).json()).toEqual({ required: false });
    expect((await create({ username: "attacker", email: "attacker@example.test", password })).status).toBe(409);
  });

  test("legacy CLI or seed admin creation also closes setup permanently", async () => {
    // Reset only the disposable control row to exercise the database trigger.
    await sql`UPDATE app_setup SET completed = false WHERE singleton = true`;
    const id = Bun.randomUUIDv7();
    userIds.push(id);
    await sql`INSERT INTO users (id, username, email, password, role, is_active) VALUES (${id}, 'cliadmin', 'cliadmin@example.test', 'unused', 'user', false)`;
    await sql`UPDATE users SET role = 'admin' WHERE id = ${id}`;
    const [state] = await sql`SELECT completed FROM app_setup WHERE singleton = true`;
    expect(state.completed).toBe(true);
    await sql`DELETE FROM users WHERE id = ${id}`;
    expect(await (await fetch(`${origin}/api/setup`)).json()).toEqual({ required: false });
  });
});

afterAll(async () => {
  if (!enabled) return;
  server?.stop(true);
  for (const id of userIds) await sql`DELETE FROM users WHERE id = ${id}`;
  await sql.close();
});
