import { sql } from "bun";
import User from "./User";

export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: Date;
  user_agent: string;
  ip_address: string;
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
    req?: Bun.BunRequest
  ): Promise<Session> {
    const sessionRecord: SessionRecord = {
      id: Bun.randomUUIDv7(),
      user_id: userId,
      expires_at: new Date(Date.now() + SESSION_DURATION_MS),
      user_agent: req?.headers.get("user-agent") || "",
      ip_address: req?.headers.get("x-forwarded-for") || "",
    };

    await sql`INSERT INTO sessions ${sql(sessionRecord)}`;

    if (req) {
      req.cookies.set({
        name: "session_id",
        value: sessionRecord.id,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        expires: sessionRecord.expires_at,
      });
    }

    return new Session(sessionRecord);
  }

  static async getFromRequest(req: Bun.BunRequest): Promise<Session | null> {
    const sessionId = req.cookies.get("session_id");
    if (!sessionId) {
      return null;
    }

    const rows = await sql`
      SELECT id, user_id, expires_at, user_agent, ip_address
      FROM sessions
      WHERE id = ${sessionId} AND expires_at > ${new Date()}
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
