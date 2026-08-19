import { randomBytes } from "node:crypto";
import { sql } from "bun";
import Session from "./Session";
import {
  Args,
  Body,
  BodyField,
  Param,
  Query,
  Req,
  RequireAuth,
  RequireOwner,
  Route,
  Serialize,
} from "../server/decorators";
import {
  ConflictError,
  NotAuthenticatedError,
  NotAuthorizedError,
  NotFoundError,
  ValidationError,
} from "../server/errors";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  PASSWORD_RESET_REQUEST_MESSAGE,
  PASSWORD_RESET_TTL_MS,
  sendPasswordResetEmail,
} from "../server/passwordReset";

export type UserRole = "user" | "admin";

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  password: string;
  date_created: Date;
  date_updated: Date | null;
  role: UserRole;
  is_active: boolean;
  activation_token: string | null;
  api_token: string | null;
  default_company_id?: string | null;
  profile_asset_id?: string | null;
}

interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

interface LoginInput {
  username: string;
  password: string;
}

interface UpdateProfileInput {
  username?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
  profileAssetId?: string | null;
}

type PublicUser = {
  id: string | null;
  username: string | null;
  email: string | null;
  role: UserRole | null;
  isActive: boolean | null;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  defaultCompanyId: string | null;
  profileAssetId: string | null;
  profileImageUrl: string | null;
};

type PublicSession = {
  userId: string | null;
  expiresAt: Date | null;
};

type PaginatedUsers<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: UserSortBy;
  sortDir: SortDirection;
};

type UserSortBy = "date_created" | "username" | "email" | "role" | "is_active";
type SortDirection = "asc" | "desc";

const DEFAULT_USERS_PAGE = 1;
const DEFAULT_USERS_LIMIT = 10;
const MAX_USERS_LIMIT = 100;
const DEFAULT_USERS_SORT_BY: UserSortBy = "date_created";
const DEFAULT_USERS_SORT_DIR: SortDirection = "desc";

function toPublicUser(value: unknown): PublicUser | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  return {
    id: (row.id as string) ?? null,
    username: (row.username as string) ?? null,
    email: (row.email as string) ?? null,
    role: (row.role as UserRole) ?? null,
    isActive: (row.isActive as boolean) ?? (row.is_active as boolean) ?? null,
    dateCreated: (row.dateCreated as Date) ?? (row.date_created as Date) ?? null,
    dateUpdated: (row.dateUpdated as Date) ?? (row.date_updated as Date) ?? null,
    defaultCompanyId:
      (row.defaultCompanyId as string) ?? (row.default_company_id as string) ?? null,
    profileAssetId:
      (row.profileAssetId as string) ?? (row.profile_asset_id as string) ?? null,
    profileImageUrl:
      ((row.profileAssetId as string) ?? (row.profile_asset_id as string))
        ? `/assets/${(row.profileAssetId as string) ?? (row.profile_asset_id as string)}?width=256&height=256&fit=fill&format=webp`
        : null,
  };
}

function toNumber(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function toPositiveInt(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const int = Math.floor(parsed);
  return int > 0 ? int : fallback;
}

function parseUsersListPagination(req: Bun.BunRequest) {
  const url = new URL(req.url);
  const page = toPositiveInt(url.searchParams.get("page"), DEFAULT_USERS_PAGE);
  const requestedLimit = toPositiveInt(url.searchParams.get("limit"), DEFAULT_USERS_LIMIT);
  const limit = Math.min(requestedLimit, MAX_USERS_LIMIT);

  const rawSortBy = url.searchParams.get("sortBy");
  const sortBy: UserSortBy =
    rawSortBy === "username" ||
    rawSortBy === "email" ||
    rawSortBy === "role" ||
    rawSortBy === "is_active" ||
    rawSortBy === "date_created"
      ? rawSortBy
      : DEFAULT_USERS_SORT_BY;

  const rawSortDir = url.searchParams.get("sortDir");
  const sortDir: SortDirection =
    rawSortDir === "asc" || rawSortDir === "desc" ? rawSortDir : DEFAULT_USERS_SORT_DIR;

  return { page, limit, sortBy, sortDir };
}

function serializeUserPayload(payload: unknown) {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload === "object" && payload !== null && "items" in payload) {
    const row = payload as Record<string, unknown>;
    const items = Array.isArray(row.items) ? row.items.map(toPublicUser) : [];
    const page = toNumber(row.page, DEFAULT_USERS_PAGE);
    const limit = toNumber(row.limit, DEFAULT_USERS_LIMIT);
    const total = toNumber(row.total, items.length);
    const totalPages = toNumber(
      row.totalPages,
      Math.max(1, Math.ceil(total / Math.max(1, limit)))
    );
    const sortBy =
      (row.sortBy as UserSortBy | undefined) ??
      (row.sort_by as UserSortBy | undefined) ??
      DEFAULT_USERS_SORT_BY;
    const sortDir =
      (row.sortDir as SortDirection | undefined) ??
      (row.sort_dir as SortDirection | undefined) ??
      DEFAULT_USERS_SORT_DIR;

    return {
      items,
      page,
      limit,
      total,
      totalPages,
      sortBy,
      sortDir,
    };
  }

  if (Array.isArray(payload)) {
    return payload.map(toPublicUser);
  }
  return toPublicUser(payload);
}

function serializeSessionPayload(payload: unknown): PublicSession | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload as Record<string, unknown>;
  return {
    userId: (row.userId as string) ?? (row.user_id as string) ?? null,
    expiresAt: (row.expiresAt as Date) ?? (row.expires_at as Date) ?? null,
  };
}

class User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  dateCreated: Date;
  dateUpdated: Date | null;
  role: UserRole;
  isActive: boolean;
  activationToken: string | null;
  apiToken: string | null;
  profileAssetId: string | null;

  constructor(record: UserRecord) {
    this.id = record.id;
    this.username = record.username;
    this.email = record.email;
    this.passwordHash = record.password;
    this.dateCreated = record.date_created;
    this.dateUpdated = record.date_updated;
    this.role = record.role;
    this.isActive = record.is_active;
    this.activationToken = record.activation_token;
    this.apiToken = record.api_token;
    this.profileAssetId = record.profile_asset_id ?? null;
  }

  async updateUsername(newUsername: string): Promise<void> {
    const rows = await sql`SELECT id FROM users WHERE username = ${newUsername} AND id != ${this.id}`;
    if (rows.length > 0) {
      throw new ConflictError("Username gia in uso");
    }

    const now = new Date();
    await sql`UPDATE users SET username = ${newUsername}, date_updated = ${now} WHERE id = ${this.id}`;
    this.username = newUsername;
    this.dateUpdated = now;
  }

  async updatePassword(newPassword: string): Promise<void> {
    const passwordHash = await Bun.password.hash(newPassword);
    await sql`UPDATE users SET password = ${passwordHash}, date_updated = ${new Date()} WHERE id = ${this.id}`;
    this.passwordHash = passwordHash;
  }

  async verifyPassword(password: string): Promise<boolean> {
    return Bun.password.verify(password, this.passwordHash);
  }

  async delete(): Promise<void> {
    await sql`DELETE FROM users WHERE id = ${this.id}`;
  }

  async generateNewApiToken(): Promise<string> {
    const token = User.generateApiToken();
    await sql`UPDATE users SET api_token = ${token}, date_updated = ${new Date()} WHERE id = ${this.id}`;
    this.apiToken = token;
    return token;
  }

  async revokeApiToken(): Promise<void> {
    await sql`UPDATE users SET api_token = NULL, date_updated = ${new Date()} WHERE id = ${this.id}`;
    this.apiToken = null;
  }

  static generateApiToken(): string {
    return randomBytes(32).toString("hex");
  }

  @Route("GET", "/api/profile")
  @RequireAuth()
  @Serialize(serializeUserPayload)
  @Args(Req())
  static async profile(req: Bun.BunRequest): Promise<User> {
    const session = await Session.getFromRequest(req);
    if (!session) throw new NotAuthenticatedError("Sessione non trovata");
    const user = await User.getById(session.userId);
    if (!user) throw new NotFoundError("Utente non trovato");
    return user;
  }

  @Route("PATCH", "/api/profile")
  @RequireAuth()
  @Serialize(serializeUserPayload)
  @Args(Body(), Req())
  static async updateProfile(input: UpdateProfileInput, req: Bun.BunRequest): Promise<User> {
    if (!input || typeof input !== "object") throw new ValidationError("Dati profilo non validi");
    const session = await Session.getFromRequest(req);
    if (!session) throw new NotAuthenticatedError("Sessione non trovata");
    const user = await User.getById(session.userId);
    if (!user) throw new NotFoundError("Utente non trovato");

    const username = input.username?.trim();
    const email = input.email?.trim().toLowerCase();
    if (username !== undefined && (username.length < 3 || username.length > 255)) {
      throw new ValidationError("Lo username deve contenere da 3 a 255 caratteri");
    }
    if (email !== undefined && (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new ValidationError("Email non valida");
    }
    if (username && username !== user.username) {
      const rows = await sql`SELECT id FROM users WHERE username = ${username} AND id != ${user.id}`;
      if (rows.length) throw new ConflictError("Username gia in uso");
    }
    if (email && email !== user.email) {
      const rows = await sql`SELECT id FROM users WHERE email = ${email} AND id != ${user.id}`;
      if (rows.length) throw new ConflictError("Email gia in uso");
    }

    if (input.newPassword) {
      if (input.newPassword.length < 8) throw new ValidationError("La password deve contenere almeno 8 caratteri");
      if (!input.currentPassword || !await user.verifyPassword(input.currentPassword)) {
        throw new NotAuthenticatedError("Password corrente non valida");
      }
    }

    if (input.profileAssetId) {
      const assets = await sql`SELECT id FROM assets WHERE id = ${input.profileAssetId} AND uploaded_by = ${user.id} AND image_format IS NOT NULL`;
      if (!assets.length) throw new NotFoundError("Foto profilo non valida");
    }

    const now = new Date();
    const nextUsername = username || user.username;
    const nextEmail = email || user.email;
    const nextProfileAssetId = input.profileAssetId === undefined ? user.profileAssetId : input.profileAssetId;
    await sql`UPDATE users SET username = ${nextUsername}, email = ${nextEmail}, profile_asset_id = ${nextProfileAssetId}, date_updated = ${now} WHERE id = ${user.id}`;
    if (input.newPassword) await user.updatePassword(input.newPassword);
    const updated = await User.getById(user.id);
    if (!updated) throw new NotFoundError("Utente non trovato");
    return updated;
  }

  @Route("POST", "/api/register")
  @Serialize(serializeUserPayload)
  @Args(Body())
  static async register(input: RegisterInput): Promise<User> {
    const userId = Bun.randomUUIDv7();
    const companyId = Bun.randomUUIDv7();
    const userToInsert = {
      id: userId,
      username: input.username,
      email: input.email,
      password: await Bun.password.hash(input.password),
      role: "user" as UserRole,
      is_active: false,
      activation_token: Bun.randomUUIDv7(),
      date_created: new Date(),
    };

    const rows = await sql`INSERT INTO users ${sql(userToInsert)} RETURNING *`;
     const createdRow = rows[0] as UserRecord;

    return new User({
      ...createdRow,
      date_created: new Date(createdRow.date_created),
      date_updated: createdRow.date_updated ? new Date(createdRow.date_updated) : null,
    });
  }

  @Route("POST", "/api/login")
  @Serialize(serializeSessionPayload)
  @Args(Body(), Req())
  static async login(input: LoginInput, req?: Bun.BunRequest): Promise<Session> {
    const rows = await sql`SELECT * FROM users WHERE username = ${input.username} OR email = ${input.username}`;
    if (rows.length === 0) {
      throw new NotAuthenticatedError("Credenziali non valide");
    }

    const row = rows[0] as UserRecord;
    const valid = await Bun.password.verify(input.password, row.password);
    if (!valid) {
      throw new NotAuthenticatedError("Credenziali non valide");
    }

    return Session.initNewSession(row.id, req);
  }

  @Route("POST", "/api/logout")
  @RequireAuth()
  @Args(Req())
  static async logout(req: Bun.BunRequest): Promise<void> {
    const session = await Session.getFromRequest(req);
    if (!session) {
      throw new NotAuthenticatedError("Sessione non trovata");
    }
    await session.terminate();
    req.cookies.set({
      name: "session_id",
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expires: new Date(0),
    });
  }

  @Route("GET", "/api/users/:id")
  @RequireAuth()
  @RequireOwner("id")
  @Serialize(serializeUserPayload)
  @Args(Param("id"))
  static async getById(id: string): Promise<User | null> {
    const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as UserRecord;
    return new User({
      ...row,
      date_created: new Date(row.date_created),
      date_updated: row.date_updated ? new Date(row.date_updated) : null,
    });
  }

  @Route("GET", "/api/users")
  @RequireAuth()
  @Serialize(serializeUserPayload)
  @Args(Req())
  static async list(req: Bun.BunRequest): Promise<PaginatedUsers<User>> {
    const session = await Session.getFromRequest(req);
    if (!session) {
      throw new NotAuthenticatedError("Sessione non trovata");
    }

    const currentUser = await User.getById(session.userId);
    if (!currentUser) {
      throw new NotAuthenticatedError("Utente sessione non trovato");
    }

    const { page: requestedPage, limit, sortBy, sortDir } = parseUsersListPagination(req);

    if (currentUser.role === "admin") {
      const totalRows = await sql`SELECT COUNT(*)::int AS total FROM users`;
      const total = toNumber((totalRows[0] as { total?: unknown } | undefined)?.total, 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, totalPages);
      const offset = (page - 1) * limit;
      const rows = await sql`
        SELECT *
        FROM users
        ORDER BY
          CASE WHEN ${sortBy} = 'username' AND ${sortDir} = 'asc' THEN username END ASC,
          CASE WHEN ${sortBy} = 'username' AND ${sortDir} = 'desc' THEN username END DESC,
          CASE WHEN ${sortBy} = 'email' AND ${sortDir} = 'asc' THEN email END ASC,
          CASE WHEN ${sortBy} = 'email' AND ${sortDir} = 'desc' THEN email END DESC,
          CASE WHEN ${sortBy} = 'role' AND ${sortDir} = 'asc' THEN role END ASC,
          CASE WHEN ${sortBy} = 'role' AND ${sortDir} = 'desc' THEN role END DESC,
          CASE WHEN ${sortBy} = 'is_active' AND ${sortDir} = 'asc' THEN is_active END ASC,
          CASE WHEN ${sortBy} = 'is_active' AND ${sortDir} = 'desc' THEN is_active END DESC,
          CASE WHEN ${sortBy} = 'date_created' AND ${sortDir} = 'asc' THEN date_created END ASC,
          CASE WHEN ${sortBy} = 'date_created' AND ${sortDir} = 'desc' THEN date_created END DESC,
          id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const items = (rows as UserRecord[]).map((row) => {
        return new User({
          ...row,
          date_created: new Date(row.date_created),
          date_updated: row.date_updated ? new Date(row.date_updated) : null,
        });
      });

      return {
        items,
        page,
        limit,
        total,
        totalPages,
        sortBy,
        sortDir,
      };
    }

    const visible = [currentUser];
    const total = visible.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * limit;
    const items = visible.slice(offset, offset + limit);

    return {
      items,
      page,
      limit,
      total,
      totalPages,
      sortBy,
      sortDir,
    };
  }

  @Route("GET", "/api/users/by-identifier")
  @RequireAuth()
  @RequireOwner({
    resolve: async (req) => {
      const identifier = new URL(req.url).searchParams.get("identifier");
      if (!identifier) return undefined;
      const user = await User.getByUsernameOrEmail(identifier);
      return user?.id;
    },
  })
  @Serialize(serializeUserPayload)
  @Args(Query("identifier"))
  static async getByUsernameOrEmail(identifier: string): Promise<User | null> {
    const rows = await sql`SELECT * FROM users WHERE username = ${identifier} OR email = ${identifier}`;
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as UserRecord;
    return new User({
      ...row,
      date_created: new Date(row.date_created),
      date_updated: row.date_updated ? new Date(row.date_updated) : null,
    });
  }

  @Route("GET", "/api/users/by-token")
  @RequireAuth()
  @RequireOwner({
    resolve: async (req) => {
      const apiToken = new URL(req.url).searchParams.get("apiToken");
      if (!apiToken) return undefined;
      const user = await User.getUserByApiToken(apiToken);
      return user?.id;
    },
  })
  @Serialize(serializeUserPayload)
  @Args(Query("apiToken"))
  static async getUserByApiToken(apiToken: string): Promise<User | null> {
    const rows = await sql`SELECT * FROM users WHERE api_token = ${apiToken}`;
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as UserRecord;
    return new User({
      ...row,
      date_created: new Date(row.date_created),
      date_updated: row.date_updated ? new Date(row.date_updated) : null,
    });
  }

  @Route("POST", "/api/password-reset/request")
  @Args(BodyField("email"))
  static async requestPasswordReset(email: string): Promise<{ message: string }> {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 255) {
      throw new ValidationError("Email non valida");
    }

    const rows = await sql`SELECT id FROM users WHERE LOWER(email) = ${normalizedEmail}`;
    if (rows.length === 0) {
      return { message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const userId = String(rows[0]!.id);
    const cooldown = new Date(Date.now() - 60 * 1000);
    const recent = await sql`SELECT id FROM password_resets WHERE user_id = ${userId} AND created_at > ${cooldown} LIMIT 1`;
    if (recent.length > 0) {
      return { message: PASSWORD_RESET_REQUEST_MESSAGE };
    }

    const token = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const createdAt = new Date();

    await sql.begin(async (tx) => {
      await tx`DELETE FROM password_resets WHERE user_id = ${userId}`;
      await tx`
        INSERT INTO password_resets (id, user_id, token, expires_at, created_at)
        VALUES (${Bun.randomUUIDv7()}, ${userId}, ${tokenHash}, ${expiresAt}, ${createdAt})
      `;
    });

    void sendPasswordResetEmail(normalizedEmail, token).catch(async (error) => {
      console.error(
        "Invio email di reset password fallito:",
        error instanceof Error ? error.message : "errore sconosciuto"
      );
      try {
        await sql`DELETE FROM password_resets WHERE token = ${tokenHash}`;
      } catch (cleanupError) {
        console.error("Pulizia token di reset password fallita", cleanupError);
      }
    });

    return { message: PASSWORD_RESET_REQUEST_MESSAGE };
  }

  @Route("POST", "/api/password-reset")
  @Args(BodyField("token"), BodyField("newPassword"))
  static async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    if (typeof token !== "string" || token.length < 32 || token.length > 512) {
      throw new NotAuthorizedError("Token non valido o scaduto");
    }
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 1024) {
      throw new ValidationError("La password deve contenere almeno 8 caratteri");
    }

    const tokenHash = hashPasswordResetToken(token);
    const now = new Date();
    const rows = await sql`
      SELECT id
      FROM password_resets
      WHERE token = ${tokenHash} AND expires_at > ${now}
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotAuthorizedError("Token non valido o scaduto");
    }

    const passwordHash = await Bun.password.hash(newPassword);
    await sql.begin(async (tx) => {
      const resets = await tx`
        DELETE FROM password_resets
        WHERE id = ${rows[0]!.id} AND token = ${tokenHash} AND expires_at > ${new Date()}
        RETURNING user_id
      `;
      if (resets.length === 0) {
        throw new NotAuthorizedError("Token non valido o scaduto");
      }

      const userId = String(resets[0]!.user_id);
      await tx`
        UPDATE users
        SET password = ${passwordHash}, api_token = NULL, date_updated = ${new Date()}
        WHERE id = ${userId}
      `;
      await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
      await tx`DELETE FROM password_resets WHERE user_id = ${userId}`;
    });

    return { message: "Password aggiornata" };
  }
}

export default User;
