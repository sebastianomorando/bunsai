import { db } from "../../db/client";
import Session from "../../entities/Session";
import app from "../app";

interface ProfileResponse {
  id: string;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  default_company_id: string | null;
  default_company_name: string | null;
}

const loadProfile = async (userId: string): Promise<ProfileResponse | null> => {
  const rows = await db<ProfileResponse[]>`
    SELECT
      u.id,
      u.username,
      u.email,
      u.role,
      u.is_active,
      u.default_company_id,
      c.name AS default_company_name
    FROM users u
    LEFT JOIN companies c ON c.id = u.default_company_id
    WHERE u.id = ${userId}::uuid
    LIMIT 1
  `;

  return rows[0] || null;
};

app.get("/api/profile", async (req: Bun.BunRequest<"/api/profile">) => {
  const session = await Session.getFromRequest(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await loadProfile(session.userId);
  if (!profile) {
    return Response.json({ error: "Utente non trovato" }, { status: 404 });
  }

  return Response.json(profile);
});

app.put("/api/profile", async (req: Bun.BunRequest<"/api/profile">) => {
  const session = await Session.getFromRequest(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      username?: string;
      email?: string;
    };

    const updates: Record<string, unknown> = {};

    if (body.username !== undefined) {
      const username = body.username.trim();
      if (!username) {
        return Response.json({ error: "Username non valido" }, { status: 400 });
      }
      updates.username = username;
    }

    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      if (!email.includes("@")) {
        return Response.json({ error: "Email non valida" }, { status: 400 });
      }
      updates.email = email;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "Nessun dato da aggiornare" }, { status: 400 });
    }

    updates.date_updated = new Date();

    await db`
      UPDATE users
      SET ${db(updates)}
      WHERE id = ${session.userId}::uuid
    `;

    const profile = await loadProfile(session.userId);
    return Response.json(profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aggiornamento profilo fallito";
    return Response.json({ error: message }, { status: 400 });
  }
});
