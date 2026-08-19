import type { ErrorLike } from "bun";

export type HttpMethod = "GET" | "POST" | "DELETE" | "PATCH" | "PUT" | "OPTIONS";

export type Handler<WebSocketData> = (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>
) => Response | Promise<Response>;

export type Middleware<WebSocketData> = (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>,
    next: () => Promise<Response>
) => Response | Promise<Response>;

export type Route = {
    method: HttpMethod;
    path: string;
    handler: Handler<any>;
    middlewares?: Middleware<any>[];
};

export type DirectoryRoute = {
    dir: string;
    statCache?: boolean;
};

type Routes<WebSocketData> = Record<
    string,
    Bun.Serve.Routes<WebSocketData, string>[string] | DirectoryRoute
>;

/**
 * Bundana — a lightweight express-style layer for Bun's HTTP server
 * @template WebSocketData The type of data associated with WebSocket connections
 * 
 */
type ListenOptions<WebSocketData> = Omit<
    Bun.Serve.Options<WebSocketData, string>,
    "routes" | "error" | "websocket"
> & {
    port?: number;
};

export class Bundana<WebSocketData> {
    routes: Routes<WebSocketData>;
    port = Number(process.env.PORT) || 3000;
    server: Bun.Server<WebSocketData> | null = null;
    // options: Bun.Serve.Options<WebSocketData, string>;
    middlewares: Array<Middleware<WebSocketData>> = [];
    artifacts: { [key: string]: Bun.BuildArtifact } = {};
    websocket: Bun.WebSocketHandler<WebSocketData> | undefined;

    constructor() {
        this.routes = {};
        // this.options = {};
    }

    /**
     * Serve a directory using Bun's native directory routes.
     * @param path The route path, ending in `/*`
     * @param route Bun's directory route configuration
     */
    static(path: `${string}/*`, route: DirectoryRoute): void {
        this.routes[path] = route;

        if (this.server) {
            this.server.reload({
                routes: this.routes as Bun.Serve.Routes<WebSocketData, string>
            });
        }
    }

    bundle(path: string, entryPoint: Bun.HTMLBundle) {
        this.routes[path] = entryPoint;
    }

    async build(path: string, options?: Bun.BuildConfig) {
        const bundle = await Bun.build({
            entrypoints: [path],
            ...options
        });
        this.artifacts[path] = bundle.outputs[0]!;
        this.get(`/${path.split("/").pop()}`, async (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => {
            let script = bundle.outputs[0];
            let content = await script!.text();
            return new Response(content, {
                headers: {
                    "Content-Type": "application/javascript"
                }
            });
        });
        return bundle;
    }

    private compose(handler: Handler<WebSocketData>, middlewares: Middleware<WebSocketData>[]): Handler<WebSocketData> {
        return async (req, server) => {
            let index = -1;

            const dispatch = async (i: number): Promise<Response> => {
                if (i <= index) {
                    throw new Error("next() called multiple times");
                }
                index = i;

                const mw = middlewares[i];
                if (mw) {
                    return mw(req, server, () => dispatch(i + 1));
                }

                return handler(req, server);
            };

            
            return await dispatch(0);
            
        };
    }

    get(
        path: string,
        handler: (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => Response | Promise<Response>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        this.add("GET", path, handler, middlewares);
    }

    post(
        path: string,
        handler: (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => Response | Promise<Response>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        this.add("POST", path, handler, middlewares);
    }

    delete(
        path: string,
        handler: (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => Response | Promise<Response>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        this.add("DELETE", path, handler, middlewares);
    }

    patch(
        path: string,
        handler: (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => Response | Promise<Response>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        this.add("PATCH", path, handler, middlewares);
    }

    put(
        path: string,
        handler: (req: Bun.BunRequest, server: Bun.Server<WebSocketData>) => Response | Promise<Response>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        this.add("PUT", path, handler, middlewares);
    }

    add(
        method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT" | "OPTIONS",
        path: string,
        handler: Handler<WebSocketData>,
        middlewares?: Middleware<WebSocketData>[]
    ) {
        const mws = [...this.middlewares, ...(middlewares ?? [])];
        const finalHandler = this.compose(handler, mws);

        const route = this.routes[path] ?? {};

        this.routes[path] = {
            ...route,
            [method]: finalHandler
        };

        if (this.server) {
            this.server.reload({
                routes: this.routes as Bun.Serve.Routes<WebSocketData, string>
            });
        }
    }

    setWebSocket(handler: Bun.WebSocketHandler<WebSocketData>) {
        this.websocket = handler;
    }

    send(room: string, message: any) {
        this.server?.publish(room, JSON.stringify(message));
    }

    use(arg: Middleware<WebSocketData>) {
        this.middlewares.push(arg as Middleware<WebSocketData>);
    }

    plugin(app: (framework: Bundana<WebSocketData>) => void) {
        app(this);
    }

    errorHandler(error: ErrorLike): Response {
        console.error("Error occurred:", error);
        if (error.code === "ENOENT") {
            return new Response("Not Found", { status: 404 });
        }

        return new Response("Internal Server Error", { status: 500 });
    }

    listen(options?: ListenOptions<WebSocketData>): Bun.Server<WebSocketData> {
        if (this.server) {
            throw new Error("Server is already running");
        }
        const resolvedPort = options?.port ?? this.port;

        const serveOptions = {
            ...options,
            routes: this.routes,
            port: resolvedPort,
            websocket: this.websocket,
            error: this.errorHandler,
        } as Bun.Serve.Options<WebSocketData, string>;

        this.server = Bun.serve(serveOptions);
        console.log(`Listening on port ${resolvedPort}`);
        return this.server;
    }
}
