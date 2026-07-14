import app from "./server/app.ts";
import client from "./client/index.html";
import User from "./entities/User.ts";
import Asset from "./entities/Asset.ts";
import { registerClassRoutes } from "./server/decorators.ts";

registerClassRoutes(app, User);
registerClassRoutes(app, Asset);

app.bundle("/*", client);

if (import.meta.main) {
  app.listen();
}

export default app;
