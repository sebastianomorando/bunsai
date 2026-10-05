import { sql } from "bun";
import User from "./User";
import { requestClientAddress } from "../server/rateLimit";

export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: Date;
  user_agent: string;
  ip_address: string;
}

export function sessionCookieSecure(): boolean {
  const override = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  const publicOrigin = process.env.APP_URL?.trim();
  if (publicOrigin) {
    try {
      return new URL(publicOrigin).protocol === "https:";
    } catch {
      return false;
    }
  }

  return process.env.NODE_ENV === "production";
}

export function clearSessionCookie(req: Bun.BunRequest): void {
  req.cookies.set({
    name: "session_id",
    value: "",
    path: "/",
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
    expires: new Date(0),
  });
}

class Session {
  id: string;
  userId: string;
  expiresAt: Date;
  userAgent: string;
  ipAddress: string;

  constructor(record: SessionRecord) {
    this.id = record.id;
    this.userId = record.user_id;
    this.expiresAt = record.expires_at;
    this.userAgent = record.user_agent;
    this.ipAddress = record.ip_address;
  }

  static async initNewSession(
    userId: string,
    req?: Bun.BunRequest,
    server?: Bun.Server<unknown>
  ): Promise<Session> {
    const sessionRecord: SessionRecord = {
      id: Bun.randomUUIDv7(),
      user_id: userId,
      expires_at: new Date(Date.now() + SESSION_DURATION_MS),
      user_agent: (req?.headers.get("user-agent") || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255),
      ip_address: req && server ? requestClientAddress(req, server) : "",
    };

    await sql`INSERT INTO sessions ${sql(sessionRecord)}`;

    if (req) {
      req.cookies.set({
        name: "session_id",
        value: sessionRecord.id,
        path: "/",
        httpOnly: true,
        secure: sessionCookieSecure(),
        sameSite: "lax",
        expires: sessionRecord.expires_at,
      });
    }

    return new Session(sessionRecord);
  }

  static async getFromRequest(req: Bun.BunRequest): Promise<Session | null> {
    const sessionId = req.cookies.get("session_id");
    if (!sessionId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) {
      return null;
    }

    const rows = await sql`
      SELECT s.id, s.user_id, s.expires_at, s.user_agent, s.ip_address
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ${sessionId} AND s.expires_at > ${new Date()} AND u.is_active = true
    `;

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as SessionRecord;
    return new Session({
      ...row,
      expires_at: new Date(row.expires_at),
    });
  }

  async terminate(): Promise<void> {
    await sql`DELETE FROM sessions WHERE id = ${this.id}`;
  }

  async getUser() {
    return await User.getById(this.userId);
  }
}

export default Session;
