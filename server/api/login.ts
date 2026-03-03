import app from "../app";
import User from "../../entities/User";

app.post("/register", async (req: Bun.BunRequest<"/register">) => {
  try {
    const body = (await req.json()) as {
      username?: string;
      email?: string;
      password?: string;
    };

    if (!body?.username || !body?.email || !body?.password) {
      return Response.json(
        { error: "username, email e password sono obbligatori" },
        { status: 400 }
      );
    }

    const user = await User.register({
      username: body.username,
      email: body.email,
      password: body.password,
    });

    return Response.json(
      {
        id: user.id,
        username: user.username,
        email: user.email,
        message: "Utente registrato",
      },
      { status: 201 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registrazione fallita";
    return Response.json({ error: message }, { status: 400 });
  }
});

app.post("/login", async (req: Bun.BunRequest<"/login">) => {
  try {
    const body = (await req.json()) as { username?: string; password?: string };

    if (!body?.username || !body?.password) {
      return Response.json(
        { error: "username e password sono obbligatori" },
        { status: 400 }
      );
    }

    await User.login(
      {
        username: body.username,
        password: body.password,
      },
      req
    );

    return Response.json({ message: "Login effettuato" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login fallito";
    return Response.json({ error: message }, { status: 401 });
  }
});

app.post("/logout", async (req: Bun.BunRequest<"/logout">) => {
  try {
    await User.logout(req);
    return Response.json({ message: "Logout effettuato" }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Logout fallito";
    return Response.json({ error: message }, { status: 400 });
  }
});

app.get("/logout", async (req: Bun.BunRequest<"/logout">) => {
  try {
    await User.logout(req);
  } catch {
    // Ignoriamo errori lato redirect per semplificare UX.
  }

  return Response.redirect("/login", 302);
});
