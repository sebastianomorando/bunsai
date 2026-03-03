import Session from "../entities/Session";
import type { Middleware } from "../lib/Bundana";

export const authMiddleware: Middleware<unknown> = async (
  req,
  _server,
  next
) => {
  const session = await Session.getFromRequest(req);
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  (req as Bun.BunRequest & { session?: Session }).session = session;
  return next();
};

export default authMiddleware;
