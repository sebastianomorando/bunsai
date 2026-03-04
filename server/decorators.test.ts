import { describe, it, expect } from "bun:test";
import type { Handler, Middleware } from "../lib/Bundana";
import {
  Args,
  registerClassRoutes,
  registerMethodRoutes,
  Route,
  Use,
  Param,
  Body,
  BodyField,
  Req,
  RequireAuth,
  RequireOwner,
  Serialize,
} from "./decorators";
import {
  NotAuthenticatedError,
  NotAuthorizedError,
  NotFoundError,
} from "./errors";

type RouteCall = {
  method: string;
  path: string;
  handler: Handler<any>;
  middlewares?: Middleware<any>[];
};

function createRouterSpy() {
  const calls: RouteCall[] = [];

  return {
    calls,
    router: {
      add(method: string, path: string, handler: Handler<any>, middlewares?: Middleware<any>[]) {
        calls.push({ method, path, handler, middlewares });
      },
    },
  };
}

function routeByPath(calls: RouteCall[], path: string) {
  const route = calls.find((call) => call.path === path);
  if (!route) throw new Error(`Route non trovata: ${path}`);
  return route;
}

describe("server decorators", () => {
  it("registra route e middlewares anche con @Use sopra o sotto @Route", () => {
    const mwTop: Middleware<any> = async (_req, _server, next) => next();
    const mwBottom: Middleware<any> = async (_req, _server, next) => next();

    class Controller {
      @Use(mwTop)
      @Route("GET", "/top-order")
      topOrder() {
        return "ok";
      }

      @Route("GET", "/bottom-order")
      @Use(mwBottom)
      bottomOrder() {
        return "ok";
      }

      @Use(mwTop)
      onlyUse() {
        return "should-not-register";
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller, "/api//");

    expect(calls).toHaveLength(2);

    const topRoute = routeByPath(calls, "/api/top-order");
    expect(topRoute.method).toBe("GET");
    expect(topRoute.middlewares).toEqual([mwTop]);

    const bottomRoute = routeByPath(calls, "/api/bottom-order");
    expect(bottomRoute.method).toBe("GET");
    expect(bottomRoute.middlewares).toEqual([mwBottom]);
  });

  it("usa target static/non-static corretto e converte i return value in Response", async () => {
    const rawResponse = new Response("already-response", { status: 202 });

    class Controller {
      instanceCount = 0;
      static staticCount = 0;

      @Route("GET", "/json")
      jsonPayload() {
        this.instanceCount += 1;
        return { count: this.instanceCount };
      }

      @Route("GET", "/text")
      textPayload() {
        return "plain-text";
      }

      @Route("GET", "/raw")
      rawPayload() {
        return rawResponse;
      }

      @Route("GET", "/number")
      static numericPayload() {
        this.staticCount += 1;
        return this.staticCount;
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller);

    const jsonHandler = routeByPath(calls, "/json").handler;
    const jsonFirst = await jsonHandler({} as any, {} as any);
    expect(jsonFirst.headers.get("Content-Type")).toContain("application/json");
    expect(await jsonFirst.json()).toEqual({ count: 1 });

    const jsonSecond = await jsonHandler({} as any, {} as any);
    expect(await jsonSecond.json()).toEqual({ count: 2 });

    const textRes = await routeByPath(calls, "/text").handler({} as any, {} as any);
    expect(textRes.headers.get("Content-Type")).toBe("text/plain");
    expect(await textRes.text()).toBe("plain-text");

    const rawRes = await routeByPath(calls, "/raw").handler({} as any, {} as any);
    expect(rawRes).toBe(rawResponse);

    const numericHandler = routeByPath(calls, "/number").handler;
    const numberFirst = await numericHandler({} as any, {} as any);
    expect(numberFirst.headers.get("Content-Type")).toBe("text/plain");
    expect(await numberFirst.text()).toBe("1");

    const numberSecond = await numericHandler({} as any, {} as any);
    expect(await numberSecond.text()).toBe("2");
  });

  it("supporta @Args sui metodi decorati senza cambiare signature", async () => {
    class Controller {
      @Route("GET", "/users/:id")
      @Args(Param("id"))
      static byId(id: string) {
        return { id };
      }

      @Route("POST", "/sum")
      @Args(BodyField("a"), BodyField("b"))
      static sum(a: number, b: number) {
        return a + b;
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller, "/api");

    const byIdRes = await routeByPath(calls, "/api/users/:id").handler(
      { params: { id: "abc" } } as any,
      {} as any
    );
    expect(await byIdRes.json()).toEqual({ id: "abc" });

    let bodyReads = 0;
    const sumRes = await routeByPath(calls, "/api/sum").handler(
      {
        json: async () => {
          bodyReads += 1;
          return { a: 2, b: 3 };
        },
      } as any,
      {} as any
    );
    expect(await sumRes.text()).toBe("5");
    expect(bodyReads).toBe(1);
  });

  it("supporta @Serialize per filtrare campi sensibili", async () => {
    class Controller {
      @Route("GET", "/me")
      @Serialize((payload) => {
        const row = payload as Record<string, unknown>;
        return {
          id: row.id,
          username: row.username,
        };
      })
      static me() {
        return {
          id: "u-1",
          username: "sebas",
          passwordHash: "secret",
          apiToken: "token",
        };
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller);

    const res = await routeByPath(calls, "/me").handler({} as any, {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "u-1",
      username: "sebas",
    });
  });

  it("crea route da metodi di classe senza modificare la classe target", async () => {
    class UserServiceLike {
      static getById(id: string) {
        return { id, source: "static" };
      }

      static login(payload: { username: string }, req: Request) {
        return { username: payload.username, hasReq: !!req.url };
      }

      echo(id: string) {
        return `echo:${id}`;
      }
    }

    const { router, calls } = createRouterSpy();
    registerMethodRoutes(
      router as any,
      UserServiceLike,
      [
        {
          method: "GET",
          path: "/users/:id",
          call: "getById",
          args: [Param("id")],
          serializer: (payload) => ({
            id: (payload as { id: string }).id,
          }),
        },
        {
          method: "POST",
          path: "/login",
          call: "login",
          args: [Body(), Req()],
        },
        {
          method: "GET",
          path: "/echo/:id",
          call: "echo",
          isStatic: false,
          args: [Param("id")],
        },
      ],
      "/api"
    );

    expect(calls).toHaveLength(3);

    const getRes = await routeByPath(calls, "/api/users/:id").handler(
      { params: { id: "u-1" } } as any,
      {} as any
    );
    expect(await getRes.json()).toEqual({ id: "u-1" });

    const loginRes = await routeByPath(calls, "/api/login").handler(
      {
        url: "http://localhost/api/login",
        json: async () => ({ username: "sebas" }),
      } as any,
      {} as any
    );
    expect(await loginRes.json()).toEqual({ username: "sebas", hasReq: true });

    const echoRes = await routeByPath(calls, "/api/echo/:id").handler(
      { params: { id: "42" } } as any,
      {} as any
    );
    expect(await echoRes.text()).toBe("echo:42");
  });

  it("mappa gli errori custom in risposte HTTP corrette", async () => {
    class Controller {
      @Route("GET", "/not-found")
      static notFound() {
        throw new NotFoundError("Risorsa non trovata");
      }

      @Route("GET", "/unauthenticated")
      static unauthenticated() {
        throw new NotAuthenticatedError("Login richiesto");
      }

      @Route("GET", "/forbidden")
      static forbidden() {
        throw new NotAuthorizedError("Accesso negato");
      }

      @Route("GET", "/unexpected")
      static unexpected() {
        throw new Error("DB connection leaked details");
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller);

    const nf = await routeByPath(calls, "/not-found").handler({} as any, {} as any);
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({
      error: "Risorsa non trovata",
      code: "NOT_FOUND",
    });

    const unauth = await routeByPath(calls, "/unauthenticated").handler(
      {} as any,
      {} as any
    );
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({
      error: "Login richiesto",
      code: "NOT_AUTHENTICATED",
    });

    const forbidden = await routeByPath(calls, "/forbidden").handler({} as any, {} as any);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "Accesso negato",
      code: "NOT_AUTHORIZED",
    });

    const unexpected = await routeByPath(calls, "/unexpected").handler(
      {} as any,
      {} as any
    );
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("blocca route protette con @RequireAuth quando manca sessione", async () => {
    class Controller {
      @Route("GET", "/private")
      @RequireAuth()
      static privateData() {
        return { ok: true };
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller);

    const res = await routeByPath(calls, "/private").handler(
      { cookies: { get: () => undefined } } as any,
      {} as any
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Autenticazione richiesta",
      code: "NOT_AUTHENTICATED",
    });
  });

  it("applica @RequireOwner: consente owner e blocca altri utenti", async () => {
    class Controller {
      @Route("GET", "/users/:id")
      @RequireOwner("id")
      @Args(Param("id"))
      static profile(id: string) {
        return { id };
      }
    }

    const { router, calls } = createRouterSpy();
    registerClassRoutes(router as any, Controller);
    const handler = routeByPath(calls, "/users/:id").handler;

    const ownRes = await handler(
      { params: { id: "u-1" }, session: { userId: "u-1" } } as any,
      {} as any
    );
    expect(ownRes.status).toBe(200);
    expect(await ownRes.json()).toEqual({ id: "u-1" });

    const otherRes = await handler(
      { params: { id: "u-2" }, session: { userId: "u-1" } } as any,
      {} as any
    );
    expect(otherRes.status).toBe(403);
    expect(await otherRes.json()).toEqual({
      error: "Accesso negato",
      code: "NOT_AUTHORIZED",
    });
  });
});
