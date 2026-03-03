import type { ErrorLike } from "bun";
import { watch } from "fs";

type Handler<WebSocketData> = (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>
) => Response | Promise<Response>;

export type Middleware<WebSocketData> = (
    req: Bun.BunRequest,
    server: Bun.Server<WebSocketData>,
    next: () => Promise<Response>
) => Response | Promise<Response>;


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
    routes: Bun.Serve.Routes<WebSocketData, string>;
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
     * Serve static files from a glob pattern
     * @param path The base path to serve the files from
     * @param baseFolder The base folder to serve the files from
     * @param globPattern A valid glob pattern
     */
    async static(path: string = "", baseFolder: string = "public", globPattern: string = "**/*") {
        const glob = new Bun.Glob(globPattern);
        for await (const file of glob.scan(baseFolder)) {
            // console.log(`${path}/${file}`, `${baseFolder}/${file}`);
            if (file === "index.html") {
                this.get(`${path}/`, (req, server) => new Response(Bun.file(`./${baseFolder}/${file}`)));
            }
            this.get(`${path}/${file}`, (req, server) => new Response(Bun.file(`./${baseFolder}/${file}`)));
        }
        watch(baseFolder, { recursive: true }, async (eventType, filename) => {
            this.get(`${path}/${filename}`, (req, server) => new Response(Bun.file(`./${baseFolder}/${filename}`)));
        });
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
        const mws = middlewares ?? this.middlewares;
        const finalHandler = this.compose(handler, mws);

        const route = this.routes[path] ?? {};

        this.routes[path] = {
            ...route,
            [method]: finalHandler
        };

        if (this.server) {
            this.server.reload({
                routes: this.routes
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
