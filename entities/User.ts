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
} from "../server/errors";

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

type PublicUser = {
  id: string | null;
  username: string | null;
  email: string | null;
  role: UserRole | null;
  isActive: boolean | null;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  defaultCompanyId: string | null;
};

type PublicSession = {
  userId: string | null;
  expiresAt: Date | null;
};

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
  };
}

function serializeUserPayload(payload: unknown) {
  if (payload === null || payload === undefined) {
    return payload;
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

    const created = await sql.begin(async (tx) => {
      const rows = await tx`INSERT INTO users ${tx(userToInsert)} RETURNING *`;
      const createdRow = rows[0] as UserRecord;

      await tx`INSERT INTO companies ${tx({
        id: companyId,
        name: `Azienda ${input.username}`,
        owner_user_id: userId,
        created_at: new Date(),
        updated_at: new Date(),
      })}`;

      await tx`INSERT INTO company_users ${tx({
        id: Bun.randomUUIDv7(),
        company_id: companyId,
        user_id: userId,
        role: "owner",
        created_at: new Date(),
        updated_at: new Date(),
      })}`;

      await tx`UPDATE users SET default_company_id = ${companyId}, date_updated = ${new Date()} WHERE id = ${userId}`;

      return createdRow;
    });

    return new User({
      ...created,
      date_created: new Date(created.date_created),
      date_updated: created.date_updated ? new Date(created.date_updated) : null,
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
  static async requestPasswordReset(email: string): Promise<string> {
    const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (rows.length === 0) {
      throw new NotFoundError("Utente non trovato");
    }

    const token = Bun.randomUUIDv7();
    await sql`INSERT INTO password_resets ${sql({
      id: Bun.randomUUIDv7(),
      user_id: rows[0]!.id,
      token,
      expires_at: new Date(Date.now() + 1000 * 60 * 60),
      created_at: new Date(),
    })}`;

    return token;
  }

  @Route("POST", "/api/password-reset")
  @Args(BodyField("token"), BodyField("newPassword"))
  static async resetPassword(token: string, newPassword: string): Promise<void> {
    const rows = await sql`SELECT * FROM password_resets WHERE token = ${token}`;
    if (rows.length === 0) {
      throw new NotAuthorizedError("Token non valido o scaduto");
    }

    const reset = rows[0] as {
      id: string;
      user_id: string;
      expires_at: Date;
    };

    if (new Date(reset.expires_at).getTime() < Date.now()) {
      throw new NotAuthorizedError("Token non valido o scaduto");
    }

    const passwordHash = await Bun.password.hash(newPassword);
    await sql`UPDATE users SET password = ${passwordHash}, date_updated = ${new Date()} WHERE id = ${reset.user_id}`;
    await sql`DELETE FROM password_resets WHERE id = ${reset.id}`;
  }
}

export default User;
