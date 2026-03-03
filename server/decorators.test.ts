import { describe, it, expect } from "bun:test";
import type { Handler, Middleware } from "../lib/Bundana";
import { registerClassRoutes, Route, Use } from "./decorators";

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
});
