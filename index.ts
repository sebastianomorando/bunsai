import app from "./server/app.ts";
import client from "./client/index.html";
import User from "./entities/User.ts";
import Asset from "./entities/Asset.ts";
import Setup from "./server/setup.ts";
import { registerDatabaseAdmin } from "./server/databaseAdmin.ts";
import { registerClassRoutes } from "./server/decorators.ts";

registerClassRoutes(app, User);
registerClassRoutes(app, Asset);
registerClassRoutes(app, Setup);
registerDatabaseAdmin(app);

app.bundle("/*", client);

if (import.meta.main) {
  app.listen();
}

export default app;
