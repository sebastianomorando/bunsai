import { sql, type SQL } from "bun";
import type { Bundana } from "../lib/Bundana";
import { clearSessionCookie } from "../entities/Session";
import { toPublicUser } from "../entities/User";
import { requireActiveAdmin, requireUuid } from "./adminAuth";
import {
  ConflictError,
  errorToResponse,
  HttpError,
  NotAuthorizedError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { safeDatabaseError } from "./databaseAdmin";
import { enforceRateLimit, enforceRequestRateLimit } from "./rateLimit";
import {
  readSetupInput,
  validateSetupInput,
  validateSetupOrigin,
} from "./setup";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
  sendPasswordResetEmail,
} from "./passwordReset";
import {
  createInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_MS,
  sendInvitationEmail,
} from "./invitations";

type Fields = Record<string, unknown>;
export function userAdminFields(input: unknown, allowed: string[]): Fields {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.includes(k))
  )
    throw new ValidationError("Dati non validi");
  return input as Fields;
}
export function accountFields(input: Fields) {
  const { username, email } = validateSetupInput({
    ...input,
    password: "PlaceholderPassword123!",
  });
  const role = input.role ?? "user";
  if (role !== "user" && role !== "admin")
    throw new ValidationError("Ruolo non valido");
  if (typeof input.isActive !== "boolean")
    throw new ValidationError("Stato non valido");
  return { username, email, role, isActive: input.isActive };
}
export function inviteFields(input: Fields) {
  const { email } = validateSetupInput({
    username: "invited-user",
    email: input.email,
    password: "PlaceholderPassword123!",
  });
  const role = input.role ?? "user",
    locale = input.locale ?? "it";
  if (
    (role !== "user" && role !== "admin") ||
    (locale !== "it" && locale !== "en")
  )
    throw new ValidationError("Invito non valido");
  return { email, role, locale };
}
export function invitationToken(input: unknown): string {
  if (typeof input !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input))
    throw invalidInvitation();
  return input;
}
const invalidInvitation = () =>
  new NotAuthorizedError("Invito non valido, scaduto o già utilizzato", {
    code: "INVITATION_INVALID",
  });
let activeHashes = 0;
async function passwordHash(password: string) {
  if (activeHashes >= 2)
    throw new HttpError(503, "Operazione in corso, riprova", {
      code: "DATABASE_BUSY",
    });
  activeHashes++;
  try {
    return await Bun.password.hash(password);
  } finally {
    activeHashes--;
  }
}
export async function accountTransaction<T>(
  actor: string | null,
  run: (tx: SQL) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '3s'`;
    await tx`SET LOCAL lock_timeout = '2s'`;
    // All management writes and invitation acceptance share this transaction
    // lock: last-admin and invitation-authority checks cannot race each other.
    await tx`SELECT pg_advisory_xact_lock(1742268051)`;
    if (actor) {
      const [admin] =
        await tx`SELECT role,is_active FROM users WHERE id=${actor} FOR UPDATE`;
      if (!admin || admin.role !== "admin" || !admin.is_active)
        throw new NotAuthorizedError();
    }
    return run(tx);
  });
}
const userProjection = sql`id, username, email, role, is_active, date_created, date_updated, profile_asset_id`;
export async function adminUserDetail(tx: SQL, id: string) {
  const [row] =
    await tx`SELECT ${userProjection}, xmin::text AS revision FROM users WHERE id=${id}`;
  if (!row) throw new NotFoundError("Utente non trovato");
  return { user: toPublicUser(row)!, version: String(row.revision) };
}
async function checkAccountCollision(
  tx: SQL,
  username: string,
  email: string,
  id: string | null = null,
) {
  const rows =
    await tx`SELECT id FROM users WHERE (username=${username} OR LOWER(email)=${email}) AND (${id}::uuid IS NULL OR id<>${id}::uuid) LIMIT 1`;
  if (rows.length)
    throw new ConflictError("Username o email già in uso", {
      code: "ADMIN_ACCOUNT_EXISTS",
    });
}
export async function createAdminManagedUser(actor: string, input: unknown) {
  const fields = userAdminFields(input, [
    "username",
    "email",
    "password",
    "role",
    "isActive",
  ]);
  const account = accountFields(fields);
  const { password } = validateSetupInput(fields);
  const hash = await passwordHash(password);
  return accountTransaction(actor, async (tx) => {
    await checkAccountCollision(tx, account.username, account.email);
    const id = Bun.randomUUIDv7();
    await tx`INSERT INTO users (id,username,email,password,role,is_active) VALUES (${id},${account.username},${account.email},${hash},${account.role},${account.isActive})`;
    return adminUserDetail(tx, id);
  });
}
export async function updateAdminManagedUser(
  actor: string,
  id: string,
  input: unknown,
) {
  const fields = userAdminFields(input, [
    "username",
    "email",
    "role",
    "isActive",
    "version",
  ]);
  const account = accountFields(fields);
  if (typeof fields.version !== "string" || !/^\d{1,10}$/.test(fields.version))
    throw new ValidationError("Versione richiesta");
  return accountTransaction(actor, async (tx) => {
    const [old] =
      await tx`SELECT id,role,is_active,email,xmin::text AS revision FROM users WHERE id=${id} FOR UPDATE`;
    if (!old) throw new NotFoundError("Utente non trovato");
    if (old.revision !== fields.version)
      throw new ConflictError("Il record è cambiato, aggiorna la pagina", {
        code: "DATABASE_STALE_ROW",
      });
    if (id === actor && (account.role !== "admin" || !account.isActive))
      throw new ValidationError(
        "Non puoi disattivare o demotare il tuo account",
        { code: "ADMIN_SELF_PROTECTED" },
      );
    if (
      old.role === "admin" &&
      old.is_active &&
      (account.role !== "admin" || !account.isActive)
    ) {
      const [count] =
        await tx`SELECT count(*)::int AS total FROM users WHERE role='admin' AND is_active=true`;
      if (count.total <= 1)
        throw new ValidationError("Deve restare un amministratore attivo", {
          code: "ADMIN_LAST_PROTECTED",
        });
    }
    await checkAccountCollision(tx, account.username, account.email, id);
    const revoke =
      old.email !== account.email ||
      old.role !== account.role ||
      old.is_active !== account.isActive;
    await tx`UPDATE users SET username=${account.username},email=${account.email},role=${account.role},is_active=${account.isActive},date_updated=now(),
      activation_token=CASE WHEN ${revoke} THEN NULL ELSE activation_token END,activation_token_expires_at=CASE WHEN ${revoke} THEN NULL ELSE activation_token_expires_at END,api_token=CASE WHEN ${revoke} THEN NULL ELSE api_token END WHERE id=${id}`;
    if (revoke) {
      await tx`DELETE FROM sessions WHERE user_id=${id}`;
      await tx`DELETE FROM password_resets WHERE user_id=${id}`;
    }
    return {
      ...(await adminUserDetail(tx, id)),
      loggedOut: revoke && id === actor,
    };
  });
}
function paging(req: Request) {
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") || 1),
    limit = Number(params.get("limit") || 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ValidationError("Paginazione non valida");
  return { page, limit, offset: (page - 1) * limit };
}
export async function listUserSessions(id: string, req: Bun.BunRequest) {
  const { page, limit, offset } = paging(req);
  const [exists] = await sql`SELECT id FROM users WHERE id=${id}`;
  if (!exists) throw new NotFoundError("Utente non trovato");
  const [count] =
    await sql`SELECT count(*)::int AS total FROM sessions WHERE user_id=${id}`;
  const rows =
    await sql`SELECT management_id AS id,created_at AS "createdAt",expires_at AS "expiresAt",user_agent AS "userAgent",ip_address AS "ipAddress",
    id=${req.cookies.get("session_id") ?? null}::uuid AS current,expires_at>now() AS active
    FROM sessions WHERE user_id=${id} ORDER BY created_at DESC,management_id LIMIT ${limit} OFFSET ${offset}`;
  return { items: rows, page, limit, total: count.total };
}
async function revokeSessions(
  actor: string,
  id: string,
  managementId: string | null,
  req: Bun.BunRequest,
) {
  return accountTransaction(actor, async (tx) => {
    const cookie = req.cookies.get("session_id");
    const rows = managementId
      ? await tx`DELETE FROM sessions WHERE user_id=${id} AND management_id=${managementId} RETURNING id`
      : await tx`DELETE FROM sessions WHERE user_id=${id} RETURNING id`;
    if (managementId && !rows.length)
      throw new NotFoundError("Sessione non trovata");
    return {
      revoked: rows.length,
      loggedOut: rows.some((s: { id: string }) => s.id === cookie),
    };
  });
}
async function emailLimit(
  req: Bun.BunRequest,
  server: Bun.Server<unknown>,
  email: string,
) {
  await enforceRequestRateLimit("adminEmail", req, server);
  await enforceRateLimit("adminEmailRecipient", "key", email.toLowerCase());
}
export async function adminSendPasswordReset(actor: string, id: string) {
  const token = createPasswordResetToken(),
    hash = hashPasswordResetToken(token),
    resetId = Bun.randomUUIDv7();
  const email = await accountTransaction(actor, async (tx) => {
    const [user] = await tx`SELECT email FROM users WHERE id=${id} FOR UPDATE`;
    if (!user) throw new NotFoundError("Utente non trovato");
    await tx`DELETE FROM password_resets WHERE user_id=${id}`;
    await tx`INSERT INTO password_resets (id,user_id,token,expires_at,created_at) VALUES (${resetId},${id},${hash},${new Date(Date.now() + PASSWORD_RESET_TTL_MS)},now())`;
    return String(user.email);
  });
  try {
    await sendPasswordResetEmail(email, token);
  } catch {
    await sql`DELETE FROM password_resets WHERE id=${resetId} AND token=${hash}`;
    throw new HttpError(503, "Invio email non riuscito", {
      code: "MAIL_DELIVERY_FAILED",
    });
  }
  return { sent: true };
}
const inviteProjection = sql`id,email,role,locale,invited_by AS "invitedBy",created_at AS "createdAt",expires_at AS "expiresAt",last_sent_at AS "lastSentAt",accepted_at AS "acceptedAt",revoked_at AS "revokedAt"`;
function invitationPublic(row: Fields) {
  return {
    ...row,
    status: row.acceptedAt
      ? "accepted"
      : row.revokedAt
        ? "revoked"
        : new Date(String(row.expiresAt)).getTime() <= Date.now()
          ? "expired"
          : "pending",
  };
}
async function dispatchInvitation(
  id: string,
  email: string,
  token: string,
  locale: "it" | "en",
) {
  const hash = hashInvitationToken(token);
  try {
    await sendInvitationEmail(email, token, locale);
    await sql`UPDATE user_invitations SET last_sent_at=now() WHERE id=${id} AND token_hash=${hash}`;
  } catch {
    await sql`UPDATE user_invitations SET revoked_at=now(),token_hash=NULL WHERE id=${id} AND token_hash=${hash} AND accepted_at IS NULL`;
    throw new HttpError(503, "Invio email non riuscito", {
      code: "MAIL_DELIVERY_FAILED",
    });
  }
  const [row] =
    await sql`SELECT ${inviteProjection} FROM user_invitations WHERE id=${id}`;
  return invitationPublic(row);
}
export async function createUserInvitation(actor: string, input: unknown) {
  const data = inviteFields(
    userAdminFields(input, ["email", "role", "locale"]),
  );
  const token = createInvitationToken(),
    id = Bun.randomUUIDv7();
  await accountTransaction(actor, async (tx) => {
    const existing =
      await tx`SELECT id FROM users WHERE LOWER(email)=${data.email} LIMIT 1`;
    if (existing.length)
      throw new ConflictError("Email già in uso", {
        code: "ADMIN_ACCOUNT_EXISTS",
      });
    await tx`UPDATE user_invitations SET revoked_at=now(),token_hash=NULL WHERE LOWER(email)=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()`;
    const pending =
      await tx`SELECT id FROM user_invitations WHERE LOWER(email)=${data.email} AND accepted_at IS NULL AND revoked_at IS NULL LIMIT 1`;
    if (pending.length)
      throw new ConflictError("Esiste già un invito in attesa", {
        code: "INVITATION_PENDING",
      });
    await tx`INSERT INTO user_invitations (id,email,role,locale,invited_by,token_hash,expires_at) VALUES (${id},${data.email},${data.role},${data.locale},${actor},${hashInvitationToken(token)},${new Date(Date.now() + INVITATION_TTL_MS)})`;
  });
  return dispatchInvitation(id, data.email, token, data.locale as "it" | "en");
}
export async function resendUserInvitation(actor: string, id: string) {
  const token = createInvitationToken();
  const data = await accountTransaction(actor, async (tx) => {
    const [invite] =
      await tx`SELECT * FROM user_invitations WHERE id=${id} FOR UPDATE`;
    if (!invite) throw new NotFoundError();
    if (invite.accepted_at) throw invalidInvitation();
    const existing =
      await tx`SELECT id FROM users WHERE LOWER(email)=${invite.email} LIMIT 1`;
    if (existing.length)
      throw new ConflictError("Email già in uso", {
        code: "ADMIN_ACCOUNT_EXISTS",
      });
    const other =
      await tx`SELECT id FROM user_invitations WHERE LOWER(email)=${invite.email} AND id<>${id} AND accepted_at IS NULL AND revoked_at IS NULL LIMIT 1`;
    if (other.length)
      throw new ConflictError("Esiste già un invito in attesa", {
        code: "INVITATION_PENDING",
      });
    await tx`UPDATE user_invitations SET token_hash=${hashInvitationToken(token)},expires_at=${new Date(Date.now() + INVITATION_TTL_MS)},revoked_at=NULL,last_sent_at=NULL,invited_by=${actor} WHERE id=${id}`;
    return invite;
  });
  return dispatchInvitation(id, String(data.email), token, data.locale);
}
async function validInvitation(tx: SQL, token: string) {
  const [invite] =
    await tx`SELECT i.id,i.email,i.role,i.locale,i.expires_at,i.invited_by FROM user_invitations i JOIN users u ON u.id=i.invited_by
    WHERE i.token_hash=${hashInvitationToken(token)} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND u.role='admin' AND u.is_active=true`;
  if (!invite) throw invalidInvitation();
  return invite;
}
export async function inspectUserInvitation(input: unknown) {
  const data = userAdminFields(input, ["token"]);
  const token = invitationToken(data.token);
  const invite = await validInvitation(sql, token);
  return {
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
  };
}
export async function acceptUserInvitation(input: unknown) {
  const data = userAdminFields(input, ["token", "username", "password"]);
  const token = invitationToken(data.token);
  const invite = await validInvitation(sql, token);
  const fields = validateSetupInput({
    username: data.username,
    email: invite.email,
    password: data.password,
  });
  const hash = await passwordHash(fields.password);
  return accountTransaction(null, async (tx) => {
    const current = await validInvitation(tx, token);
    await checkAccountCollision(tx, fields.username, String(current.email));
    const id = Bun.randomUUIDv7();
    await tx`INSERT INTO users (id,username,email,password,role,is_active) VALUES (${id},${fields.username},${current.email},${hash},${current.role},true)`;
    await tx`UPDATE user_invitations SET accepted_at=now(),token_hash=NULL WHERE id=${current.id}`;
    return { created: true };
  });
}

export function registerUserAdmin(app: Bundana<unknown>) {
  const route = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    action: (
      actor: string,
      req: Bun.BunRequest,
      server: Bun.Server<unknown>,
    ) => Promise<unknown>,
    publicAccess = false,
  ) => {
    app.add(method, path, async (req, server) => {
      try {
        const actor = publicAccess ? "" : await requireActiveAdmin(req);
        if (method !== "GET") validateSetupOrigin(req);
        else if (req.headers.get("sec-fetch-site") === "cross-site")
          throw new NotAuthorizedError();
        await enforceRequestRateLimit(
          publicAccess
            ? path.endsWith("/accept")
              ? "invitationAccept"
              : "invitationInspect"
            : method === "GET"
              ? "adminUsersRead"
              : "adminUsersWrite",
          req,
          server,
        );
        const output = await action(actor, req, server);
        if ((output as { loggedOut?: boolean })?.loggedOut)
          clearSessionCookie(req);
        return Response.json(output, {
          status:
            method === "POST" &&
            (path === "/api/admin/users" ||
              path === "/api/admin/invitations" ||
              path.endsWith("/accept"))
              ? 201
              : 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        let safe = safeDatabaseError(error);
        if ((error as { errno?: string })?.errno === "23505")
          safe = new ConflictError("Username, email o invito già in uso", {
            code: "ADMIN_ACCOUNT_EXISTS",
          });
        const response = errorToResponse(safe);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
    });
  };
  const param = (req: Bun.BunRequest, name: string) =>
    requireUuid(
      (req as Bun.BunRequest & { params: Record<string, string> }).params[name],
    );
  route("POST", "/api/admin/users", (actor, req) =>
    readSetupInput(req).then((input) => createAdminManagedUser(actor, input)),
  );
  route("GET", "/api/admin/users/:id", (_actor, req) =>
    adminUserDetail(sql, param(req, "id")),
  );
  route("PATCH", "/api/admin/users/:id", (actor, req) =>
    readSetupInput(req).then((input) =>
      updateAdminManagedUser(actor, param(req, "id"), input),
    ),
  );
  route("GET", "/api/admin/users/:id/sessions", (_actor, req) =>
    listUserSessions(param(req, "id"), req),
  );
  route("DELETE", "/api/admin/users/:id/sessions", (actor, req) =>
    revokeSessions(actor, param(req, "id"), null, req),
  );
  route("DELETE", "/api/admin/users/:id/sessions/:sessionId", (actor, req) =>
    revokeSessions(actor, param(req, "id"), param(req, "sessionId"), req),
  );
  route(
    "POST",
    "/api/admin/users/:id/password-reset",
    async (actor, req, server) => {
      const id = param(req, "id");
      const [user] = await sql`SELECT email FROM users WHERE id=${id}`;
      if (!user) throw new NotFoundError();
      await emailLimit(req, server, String(user.email));
      return adminSendPasswordReset(actor, id);
    },
  );
  route("GET", "/api/admin/invitations", async (_actor, req) => {
    const { page, limit, offset } = paging(req);
    const [count] =
      await sql`SELECT count(*)::int AS total FROM user_invitations`;
    const rows =
      await sql`SELECT ${inviteProjection} FROM user_invitations ORDER BY created_at DESC,id LIMIT ${limit} OFFSET ${offset}`;
    return {
      items: rows.map(invitationPublic),
      page,
      limit,
      total: count.total,
    };
  });
  route("POST", "/api/admin/invitations", async (actor, req, server) => {
    const input = await readSetupInput(req);
    const data = inviteFields(
      userAdminFields(input, ["email", "role", "locale"]),
    );
    await emailLimit(req, server, data.email);
    return createUserInvitation(actor, input);
  });
  route(
    "POST",
    "/api/admin/invitations/:id/resend",
    async (actor, req, server) => {
      const id = param(req, "id");
      const [row] =
        await sql`SELECT email FROM user_invitations WHERE id=${id}`;
      if (!row) throw new NotFoundError();
      await emailLimit(req, server, String(row.email));
      return resendUserInvitation(actor, id);
    },
  );
  route("DELETE", "/api/admin/invitations/:id", (actor, req) =>
    accountTransaction(actor, async (tx) => {
      const rows =
        await tx`UPDATE user_invitations SET revoked_at=now(),token_hash=NULL WHERE id=${param(req, "id")} AND accepted_at IS NULL RETURNING id`;
      if (!rows.length) throw new NotFoundError();
      return { revoked: true };
    }),
  );
  route(
    "POST",
    "/api/invitations/inspect",
    (_actor, req) => readSetupInput(req).then(inspectUserInvitation),
    true,
  );
  route(
    "POST",
    "/api/invitations/accept",
    (_actor, req) => readSetupInput(req).then(acceptUserInvitation),
    true,
  );
}
