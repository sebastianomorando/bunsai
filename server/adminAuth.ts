import { sql } from "bun";
import { NotAuthenticatedError, NotAuthorizedError } from "./errors";
export function requireUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  )
    throw new NotAuthorizedError("Identificativo non valido");
  return value;
}
export async function requireActiveAdmin(req: Bun.BunRequest): Promise<string> {
  const sessionId = req.cookies.get("session_id");
  if (
    !sessionId ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)
  )
    throw new NotAuthenticatedError();
  const [user] = await sql`
    SELECT u.id, u.role, u.is_active FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${sessionId} AND s.expires_at > now()
  `;
  if (!user) throw new NotAuthenticatedError();
  if (user.role !== "admin" || user.is_active !== true)
    throw new NotAuthorizedError();
  return String(user.id);
}
