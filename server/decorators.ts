import type { Handler, Middleware, HttpMethod, Bundana } from "../lib/Bundana";
import {
  errorToResponse,
  NotAuthenticatedError,
  NotAuthorizedError,
} from "./errors";

type RouteDef = {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
  isStatic: boolean;
  middlewares: Middleware<any>[];
  args?: ArgBinder[];
  guards?: GuardBinder[];
  serializer?: SerializerBinder;
};

export type ArgBinder = (
  req: Bun.BunRequest,
  server: Bun.Server<any>
) => unknown | Promise<unknown>;

export type MethodRouteBinding = {
  method: HttpMethod;
  path: string;
  call: string | symbol;
  isStatic?: boolean;
  middlewares?: Middleware<any>[];
  args?: ArgBinder[];
  guards?: GuardBinder[];
  serializer?: SerializerBinder;
};

export type GuardBinder = (
  req: Bun.BunRequest,
  server: Bun.Server<any>
) => void | Promise<void>;

export type SerializerBinder = (
  payload: unknown,
  req: Bun.BunRequest,
  server: Bun.Server<any>
) => unknown | Promise<unknown>;

export type OwnerResolver = (
  req: Bun.BunRequest,
  server: Bun.Server<any>
) => unknown | Promise<unknown>;

export type RequireOwnerOptions = {
  param?: string;
  query?: string;
  bodyField?: string;
  resolve?: OwnerResolver;
};

const ROUTES = Symbol("bundana:routes");
const METADATA = (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");
const BODY_CACHE = Symbol("bundana:body-cache");
const SESSION_CACHE = Symbol("bundana:session-cache");

function pushRoute(metadata: any, def: RouteDef) {
  (metadata[ROUTES] ??= []).push(def);
}

function findRoute(metadata: any, name: string | symbol) {
  const arr: RouteDef[] = metadata[ROUTES] ?? [];
  return arr.find(r => r.propertyKey === name);
}

function upsertRoute(
  metadata: any,
  name: string | symbol,
  isStatic: boolean,
  init?: Partial<RouteDef>
) {
  let def = findRoute(metadata, name);
  if (!def) {
    def = {
      method: "GET",
      path: "",
      propertyKey: name,
      isStatic,
      middlewares: [],
      guards: [],
      ...init,
    };
    pushRoute(metadata, def);
  } else if (init) {
    Object.assign(def, init);
  }
  return def;
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) {
    return result;
  }

  if (typeof result === "object" && result !== null) {
    return Response.json(result);
  }

  return new Response(String(result), {
    headers: {
      "Content-Type": "text/plain",
    },
  });
}

function normalizePath(basePath: string, path: string) {
  return (basePath + path).replace(/\/+/g, "/");
}

function resolveMethodTarget(
  Klass: any,
  getInstance: () => any,
  call: string | symbol,
  forceStatic?: boolean
) {
  if (forceStatic === true) {
    const fn = Klass?.[call];
    if (typeof fn !== "function") {
      throw new Error(`Metodo statico non trovato: ${String(call)}`);
    }
    return { target: Klass, fn };
  }

  if (forceStatic === false) {
    const instance = getInstance();
    const fn = instance?.[call];
    if (typeof fn !== "function") {
      throw new Error(`Metodo istanza non trovato: ${String(call)}`);
    }
    return { target: instance, fn };
  }

  if (typeof Klass?.[call] === "function") {
    return { target: Klass, fn: Klass[call] };
  }

  const instance = getInstance();
  if (typeof instance?.[call] === "function") {
    return { target: instance, fn: instance[call] };
  }

  throw new Error(`Metodo non trovato: ${String(call)}`);
}

export function Route(method: HttpMethod, path: string) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Route solo su metodi");

    upsertRoute(context.metadata, context.name, !!context.static, { method, path });

    return value;
  };
}

export function Use(...middlewares: Middleware<any>[]) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Use solo su metodi");

    const def = upsertRoute(context.metadata, context.name, !!context.static);

    def.middlewares.push(...middlewares);
    return value;
  };
}

export function Args(...args: ArgBinder[]) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Args solo su metodi");
    const def = upsertRoute(context.metadata, context.name, !!context.static);
    def.args = args;
    return value;
  };
}

export function Guard(...guards: GuardBinder[]) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Guard solo su metodi");
    const def = upsertRoute(context.metadata, context.name, !!context.static);
    (def.guards ??= []).push(...guards);
    return value;
  };
}

export function Serialize(serializer: SerializerBinder) {
  return (value: any, context: ClassMethodDecoratorContext) => {
    if (context.kind !== "method") throw new Error("@Serialize solo su metodi");
    const def = upsertRoute(context.metadata, context.name, !!context.static);
    def.serializer = serializer;
    return value;
  };
}

export function RequireAuth() {
  return Guard(async (req) => {
    await requireSession(req);
  });
}

export function RequireOwner(
  configOrParam: string | RequireOwnerOptions = "id"
) {
  const config: RequireOwnerOptions =
    typeof configOrParam === "string"
      ? { param: configOrParam }
      : configOrParam;

  return Guard(async (req, server) => {
    const session = await requireSession(req);
    const ownerId = await resolveOwnerId(req, server, config);

    if (!ownerId) {
      throw new NotAuthorizedError("Owner non risolto");
    }

    if (String(ownerId) !== String(session.userId)) {
      throw new NotAuthorizedError("Accesso negato");
    }
  });
}

export function registerClassRoutes(router: Bundana<any>, Klass: any, basePath = "") {
  const meta = Klass?.[METADATA] ?? {};
  const routes: RouteDef[] = meta[ROUTES] ?? [];
  let instance: any;
  const getInstance = () => {
    if (instance) {
      return instance;
    }

    try {
      instance = new Klass();
      return instance;
    } catch (error) {
      throw new Error(
        `Impossibile istanziare ${Klass?.name ?? "classe"}: usa metodi statici o registra l'istanza manualmente`
      );
    }
  };

  for (const r of routes) {
    if (!r.path) continue; // ignora placeholder senza @Route vero
    const fullPath = normalizePath(basePath, r.path);

    const handler: Handler<any> = async (ctx, server) => {
      try {
        const target = r.isStatic ? Klass : getInstance();
        const fn = target[r.propertyKey];
        if (r.guards?.length) {
          for (const guard of r.guards) {
            await guard(ctx, server);
          }
        }
        const methodArgs = r.args?.length
          ? await Promise.all(r.args.map((binder) => binder(ctx, server)))
          : [ctx, server];
        const result = await fn.call(target, ...methodArgs);
        const output =
          r.serializer && !(result instanceof Response)
            ? await r.serializer(result, ctx, server)
            : result;
        return toResponse(output);
      } catch (error) {
        return errorToResponse(error);
      }
    };

    router.add(r.method, fullPath, handler, r.middlewares);
  }
}

export function Param(name: string): ArgBinder {
  return (req) => (req as Bun.BunRequest & { params?: Record<string, string> }).params?.[name];
}

export function Query(name: string): ArgBinder {
  return (req) => {
    const value = new URL(req.url).searchParams.get(name);
    return value;
  };
}

export function Body(): ArgBinder {
  return (req) => readBody(req);
}

export function BodyField(name: string): ArgBinder {
  return async (req) => {
    const body = await readBody(req);
    if (body && typeof body === "object") {
      return (body as Record<string, unknown>)[name];
    }
    return undefined;
  };
}

export function Req(): ArgBinder {
  return (req) => req;
}

export function Server(): ArgBinder {
  return (_req, server) => server;
}

export function registerMethodRoutes(
  router: Bundana<any>,
  Klass: any,
  bindings: MethodRouteBinding[],
  basePath = ""
) {
  let instance: any;
  const getInstance = () => {
    if (instance) {
      return instance;
    }

    try {
      instance = new Klass();
      return instance;
    } catch (error) {
      throw new Error(
        `Impossibile istanziare ${Klass?.name ?? "classe"}: usa metodi statici o passa isStatic: true`
      );
    }
  };

  for (const binding of bindings) {
    const fullPath = normalizePath(basePath, binding.path);

    const handler: Handler<any> = async (req, server) => {
      try {
        const { target, fn } = resolveMethodTarget(
          Klass,
          getInstance,
          binding.call,
          binding.isStatic
        );

        if (binding.guards?.length) {
          for (const guard of binding.guards) {
            await guard(req, server);
          }
        }
        const args = binding.args?.length
          ? await Promise.all(binding.args.map((binder) => binder(req, server)))
          : [req, server];

        const result = await fn.apply(target, args);
        const output =
          binding.serializer && !(result instanceof Response)
            ? await binding.serializer(result, req, server)
            : result;
        return toResponse(output);
      } catch (error) {
        return errorToResponse(error);
      }
    };

    router.add(binding.method, fullPath, handler, binding.middlewares);
  }
}

async function readBody(req: Bun.BunRequest) {
  const cachedReq = req as Bun.BunRequest & {
    [BODY_CACHE]?: unknown | Promise<unknown>;
  };
  const cached = cachedReq[BODY_CACHE];
  if (cached !== undefined) {
    return await cached;
  }
  const pending = req.json();
  cachedReq[BODY_CACHE] = pending;
  const parsed = await pending;
  cachedReq[BODY_CACHE] = parsed;
  return parsed;
}

let sessionModulePromise: Promise<{ default: any }> | null = null;

async function getSessionModel() {
  sessionModulePromise ??= import("../entities/Session");
  const mod = await sessionModulePromise;
  return mod.default;
}

async function getSessionFromRequest(req: Bun.BunRequest) {
  const cachedReq = req as Bun.BunRequest & {
    [SESSION_CACHE]?: unknown | Promise<unknown>;
    session?: unknown;
  };

  if (cachedReq.session) {
    cachedReq[SESSION_CACHE] = cachedReq.session;
    return cachedReq.session as any;
  }

  const cached = cachedReq[SESSION_CACHE];
  if (cached !== undefined) {
    return await cached;
  }

  const Session = await getSessionModel();
  const pending = Session.getFromRequest(req);
  cachedReq[SESSION_CACHE] = pending;
  const session = await pending;
  cachedReq[SESSION_CACHE] = session;
  if (session) {
    cachedReq.session = session;
  }
  return session;
}

async function requireSession(req: Bun.BunRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) {
    throw new NotAuthenticatedError("Autenticazione richiesta");
  }
  return session as { userId: string };
}

async function resolveOwnerId(
  req: Bun.BunRequest,
  server: Bun.Server<any>,
  config: RequireOwnerOptions
) {
  if (config.resolve) {
    return await config.resolve(req, server);
  }

  if (config.param) {
    const params = (req as Bun.BunRequest & {
      params?: Record<string, string>;
    }).params;
    return params?.[config.param];
  }

  if (config.query) {
    return new URL(req.url).searchParams.get(config.query);
  }

  if (config.bodyField) {
    const body = await readBody(req);
    if (body && typeof body === "object") {
      return (body as Record<string, unknown>)[config.bodyField];
    }
  }

  return undefined;
}
