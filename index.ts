import app from "./server/app.ts";
import client from "./client/index.html";
import User from "./entities/User.ts";
import { registerClassRoutes } from "./server/decorators.ts";

registerClassRoutes(app, User);

app.bundle("/*", client);

if (import.meta.main) {
  app.listen();
}

export default app;
