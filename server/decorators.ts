import type { Handler, Middleware, Route, HttpMethod, Bundana } from "../lib/Bundana";

type RouteDef = {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
  isStatic: boolean;
  middlewares: Middleware<any>[];
};

const ROUTES = Symbol("bundana:routes");

function pushRoute(metadata: any, def: RouteDef) {
  (metadata[ROUTES] ??= []).push(def);
}

function findRoute(metadata: any, name: string | symbol) {
  const arr: RouteDef[] = metadata[ROUTES] ?? [];
  return arr.find(r => r.propertyKey === name);
}

export function Route(method: HttpMethod, path: string) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Route solo su metodi");

    pushRoute(context.metadata, {
      method,
      path,
      propertyKey: context.name,
      isStatic: !!context.static,
      middlewares: [],
    });

    return value;
  };
}

export function Use(...middlewares: Middleware<any>[]) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Use solo su metodi");

    let def = findRoute(context.metadata, context.name);
    if (!def) {
      // placeholder: così funziona anche se @Use sta sopra @Route
      def = {
        method: "GET",
        path: "",
        propertyKey: context.name,
        isStatic: !!context.static,
        middlewares: [],
      };
      pushRoute(context.metadata, def);
    }

    def.middlewares.push(...middlewares);
    return value;
  };
}

export function registerClassRoutes(router: Bundana<any>, Klass: any, basePath = "") {
  const meta = Klass?.[Symbol.metadata] ?? {};
  const routes: RouteDef[] = meta[ROUTES] ?? [];
  const instance = new Klass(); // usato solo per metodi non-static

  for (const r of routes) {
    if (!r.path) continue; // ignora placeholder senza @Route vero
    const fullPath = (basePath + r.path).replace(/\/+/g, "/");

    const handler: Handler<any> = async (ctx, server) => {
      const target = r.isStatic ? Klass : instance;
      const fn = target[r.propertyKey];
      const _res = await fn.call(target, ctx, server);

      const res = new Response();
        if (_res instanceof Response) {
            return _res;
        } else if (typeof _res === "object") {
           return Response.json(_res, {
                headers: {
                    "Content-Type": "application/json"
                }
           });
        } else if (typeof _res === "string") {
            return new Response(_res, {
                 headers: {
                    "Content-Type": "text/plain"
                }
            });
        } else {
            return new Response(String(_res), {
                 headers: {
                    "Content-Type": "text/plain"
                }
            });
        }
    };

    router.add(r.method, fullPath, handler, r.middlewares);
  }
}