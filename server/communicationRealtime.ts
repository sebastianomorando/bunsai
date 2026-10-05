import { sql } from "bun";
import type { Bundana } from "../lib/Bundana";
import Session from "../entities/Session";
import { validateSetupOrigin } from "./setup";
import { enforceRequestRateLimit } from "./rateLimit";
import { errorToResponse, NotAuthenticatedError } from "./errors";
import { uuidArray } from "./communicationValidation";
type Identity = { userId: string; sessionId: string };
const sockets = new Set<Bun.ServerWebSocket<Identity>>();
let guard: ReturnType<typeof setInterval> | null = null;
let checking = false;
export function communicationHint(
  server: Bun.Server<unknown>,
  users: string[],
  kind: "notifications" | "chat",
) {
  // Hints never contain message/notification bodies. Revoked sockets must fetch
  // again through authenticated HTTP; a stale subscription cannot disclose data.
  for (const id of new Set(users))
    server.publish(`communications:${id}`, JSON.stringify({ type: kind }));
}
export function configureCommunicationRealtime(app: Bundana<unknown>) {
  app.setWebSocket({
    idleTimeout: 60,
    maxPayloadLength: 64,
    backpressureLimit: 1024,
    closeOnBackpressureLimit: true,
    sendPings: true,
    open(raw) {
      const ws = raw as Bun.ServerWebSocket<Identity>;
      if (
        sockets.size >= 500 ||
        [...sockets].filter((s) => s.data.userId === ws.data.userId).length >= 5
      ) {
        ws.close(1013);
        return;
      }
      sockets.add(ws);
      ws.subscribe(`communications:${ws.data.userId}`);
      ws.send(JSON.stringify({ type: "ready" }));
      if (!guard) {
        guard = setInterval(async () => {
          if (checking || !sockets.size) return;
          checking = true;
          try {
            const ids = [...sockets].map((s) => s.data.sessionId);
            const rows =
              await sql`SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=ANY(${uuidArray(ids)}::uuid[]) AND s.expires_at>now() AND u.is_active=true`;
            const valid = new Set(
              rows.map((r: { id: string }) => String(r.id)),
            );
            for (const s of sockets)
              if (!valid.has(s.data.sessionId)) s.close(1008);
          } catch {
            for (const s of sockets) s.close(1011);
          } finally {
            checking = false;
          }
        }, 10000);
        guard.unref();
      }
    },
    message(ws, message) {
      if (message === "ping") ws.send("pong");
      else ws.close(1008);
    },
    close(raw) {
      sockets.delete(raw as Bun.ServerWebSocket<Identity>);
      if (!sockets.size && guard) {
        clearInterval(guard);
        guard = null;
      }
    },
  } as Bun.WebSocketHandler<unknown>);
  app.get("/api/realtime", async (req, server) => {
    try {
      validateSetupOrigin(req);
      const session = await Session.getFromRequest(req);
      if (!session) throw new NotAuthenticatedError();
      await enforceRequestRateLimit(
        "communicationConnect",
        req,
        server,
        session.userId,
      );
      if (
        !server.upgrade(req, {
          data: { userId: session.userId, sessionId: session.id },
        })
      )
        return new Response("WebSocket richiesto", { status: 426 });
      return undefined as unknown as Response;
    } catch (e) {
      return errorToResponse(e);
    }
  });
}
