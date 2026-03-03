import app from "./server/app.ts";
import client from "./client/index.html";
import "./server/index";

app.bundle("/*", client);

if (import.meta.main) {
  app.listen();
}

export default app;
