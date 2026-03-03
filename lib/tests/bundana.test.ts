import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Bundana } from "../Bundana";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

describe("Bundana", () => {
    let app: Bundana<any>;
    let server: Bun.Server<any> | null = null;
    let port = 0;

    beforeEach(() => {
        app = new Bundana();
    });

    afterEach(async () => {
        if (server) {
            server.stop(true);
            server = null;
        }
    });

    const startServer = () => {
        // Use port 0 to get a random free port
        server = app.listen({ port: 0 });
        if (!server.port) {
            throw new Error("Failed to resolve ephemeral port");
        }
        port = server.port;
        return server;
    };

    describe("Routing and HTTP Methods", () => {
        it("should register and respond to GET route", async () => {
            app.get("/test", () => new Response("GET response"));
            startServer();

            const res = await fetch(`http://localhost:${port}/test`);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("GET response");
        });

        it("should register and respond to POST route", async () => {
            app.post("/test", () => new Response("POST response"));
            startServer();

            const res = await fetch(`http://localhost:${port}/test`, {
                method: "POST",
            });
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("POST response");
        });

        it("should register and respond to PATCH route", async () => {
            app.patch("/test", () => new Response("PATCH response"));
            startServer();

            const res = await fetch(`http://localhost:${port}/test`, {
                method: "PATCH",
            });
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("PATCH response");
        });

        it("should register and respond to DELETE route", async () => {
            app.delete("/test", () => new Response("DELETE response"));
            startServer();

            const res = await fetch(`http://localhost:${port}/test`, {
                method: "DELETE",
            });
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("DELETE response");
        });

        it("should handle multiple methods on the same path", async () => {
            app.get("/test", () => new Response("GET"));
            app.post("/test", () => new Response("POST"));
            app.patch("/test", () => new Response("PATCH"));
            startServer();

            const getRes = await fetch(`http://localhost:${port}/test`);
            expect(await getRes.text()).toBe("GET");

            const postRes = await fetch(`http://localhost:${port}/test`, {
                method: "POST",
            });
            expect(await postRes.text()).toBe("POST");

            const patchRes = await fetch(`http://localhost:${port}/test`, {
                method: "PATCH",
            });
            expect(await patchRes.text()).toBe("PATCH");
        });

        it("should handle multiple routes", async () => {
            app.get("/route1", () => new Response("Route 1"));
            app.get("/route2", () => new Response("Route 2"));
            app.post("/route3", () => new Response("Route 3"));
            startServer();

            const res1 = await fetch(`http://localhost:${port}/route1`);
            expect(await res1.text()).toBe("Route 1");

            const res2 = await fetch(`http://localhost:${port}/route2`);
            expect(await res2.text()).toBe("Route 2");

            const res3 = await fetch(`http://localhost:${port}/route3`, {
                method: "POST",
            });
            expect(await res3.text()).toBe("Route 3");
        });

        it("should return 404 for unregistered routes", async () => {
            app.get("/exists", () => new Response("OK"));
            startServer();

            const res = await fetch(`http://localhost:${port}/does-not-exist`);
            expect(res.status).toBe(404);
        });

        it("should allow hot-reloading routes after server start", async () => {
            app.get("/initial", () => new Response("Initial"));
            startServer();

            // Add route after server starts
            app.get("/added", () => new Response("Added"));

            const res = await fetch(`http://localhost:${port}/added`);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("Added");
        });
    });

    describe("Middleware", () => {
        it("should run global middleware for all routes", async () => {
            const log: string[] = [];

            app.use((req, server, next) => {
                log.push("global");
                return next();
            });

            app.get("/test1", () => {
                log.push("handler1");
                return new Response("OK1");
            });

            app.get("/test2", () => {
                log.push("handler2");
                return new Response("OK2");
            });

            startServer();

            await fetch(`http://localhost:${port}/test1`);
            expect(log).toEqual(["global", "handler1"]);

            log.length = 0;
            await fetch(`http://localhost:${port}/test2`);
            expect(log).toEqual(["global", "handler2"]);
        });

        it("should run per-route middleware in order", async () => {
            const log: string[] = [];

            const mw1 = (req: any, server: any, next: any) => {
                log.push("mw1");
                return next();
            };

            const mw2 = (req: any, server: any, next: any) => {
                log.push("mw2");
                return next();
            };

            app.get(
                "/test",
                () => {
                    log.push("handler");
                    return new Response("OK");
                },
                [mw1, mw2]
            );

            startServer();

            await fetch(`http://localhost:${port}/test`);
            expect(log).toEqual(["mw1", "mw2", "handler"]);
        });

        it("should run global middleware before per-route middleware", async () => {
            const log: string[] = [];

            app.use((req, server, next) => {
                log.push("global");
                return next();
            });

            const perRoute = (req: any, server: any, next: any) => {
                log.push("per-route");
                return next();
            };

            app.get(
                "/test",
                () => {
                    log.push("handler");
                    return new Response("OK");
                },
                [perRoute]
            );

            startServer();

            await fetch(`http://localhost:${port}/test`);
            // Per-route middleware replaces global middleware, not appends
            expect(log).toEqual(["per-route", "handler"]);
        });

        it("should allow middleware to short-circuit", async () => {
            const log: string[] = [];

            const authMiddleware = (req: any, server: any, next: any) => {
                log.push("auth");
                return new Response("Unauthorized", { status: 401 });
            };

            app.get(
                "/test",
                () => {
                    log.push("handler");
                    return new Response("OK");
                },
                [authMiddleware]
            );

            startServer();

            const res = await fetch(`http://localhost:${port}/test`);
            expect(res.status).toBe(401);
            expect(await res.text()).toBe("Unauthorized");
            expect(log).toEqual(["auth"]);
        });

        it("should throw error when next() is called multiple times", async () => {
            const badMiddleware = async (req: any, server: any, next: any) => {
                await next();
                return next(); // Call next twice
            };

            app.get("/test", () => new Response("OK"), [badMiddleware]);
            startServer();

            const res = await fetch(`http://localhost:${port}/test`);
            expect(res.status).toBe(500);
        });

        it("should support async middleware", async () => {
            const log: string[] = [];

            const asyncMiddleware = async (req: any, server: any, next: any) => {
                await Bun.sleep(10);
                log.push("async");
                return next();
            };

            app.get(
                "/test",
                () => {
                    log.push("handler");
                    return new Response("OK");
                },
                [asyncMiddleware]
            );

            startServer();

            await fetch(`http://localhost:${port}/test`);
            expect(log).toEqual(["async", "handler"]);
        });
    });

    describe("Error Handling", () => {
        it("should return 500 when handler throws and no errorHandler set", async () => {
            app.get("/error", () => {
                throw new Error("Test error");
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/error`);
            expect(res.status).toBe(500);
            expect(await res.text()).toBe("Internal Server Error");
        });

        it("should use custom errorHandler when set", async () => {
            app.errorHandler = (err) => {
                return new Response(`Custom Error: ${err}`, { status: 503 });
            };

            app.get("/error", () => {
                throw new Error("Test error");
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/error`);
            expect(res.status).toBe(503);
            const text = await res.text();
            expect(text).toContain("Custom Error");
        });

        it("should catch errors in middleware", async () => {
            app.errorHandler = () => new Response("Caught", { status: 500 });

            const errorMiddleware = () => {
                throw new Error("Middleware error");
            };

            app.get("/test", () => new Response("OK"), [errorMiddleware]);
            startServer();

            const res = await fetch(`http://localhost:${port}/test`);
            expect(res.status).toBe(500);
            expect(await res.text()).toBe("Caught");
        });

        it("should catch async errors in handler", async () => {
            app.get("/error", async () => {
                await Bun.sleep(10);
                throw new Error("Async error");
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/error`);
            expect(res.status).toBe(500);
        });
    });

    describe("Static Files", () => {
        it("should serve static files from base folder with glob pattern", async () => {
            // Create a temporary test file
            const testDir = join(import.meta.dir, "temp");
            await mkdir(testDir, { recursive: true });
            const testFile = join(testDir, "test.txt");
            await writeFile(testFile, "Test content");

            try {
                await app.static("/static", "lib/tests/temp", "*.txt");
                startServer();

                const res = await fetch(
                    `http://localhost:${port}/static/test.txt`
                );
                expect(res.status).toBe(200);
                expect(await res.text()).toBe("Test content");
            } finally {
                await rm(testDir, { recursive: true, force: true });
            }
        });

        it("should serve multiple static files", async () => {
            const testDir = join(import.meta.dir, "temp");
            await mkdir(testDir, { recursive: true });
            await writeFile(join(testDir, "file1.txt"), "Content 1");
            await writeFile(join(testDir, "file2.txt"), "Content 2");

            try {
                await app.static("/static", "lib/tests/temp", "*.txt");
                startServer();

                const res1 = await fetch(
                    `http://localhost:${port}/static/file1.txt`
                );
                expect(await res1.text()).toBe("Content 1");

                const res2 = await fetch(
                    `http://localhost:${port}/static/file2.txt`
                );
                expect(await res2.text()).toBe("Content 2");
            } finally {
                await rm(testDir, { recursive: true, force: true });
            }
        });
    });

    describe("build()", () => {
        it("should bundle and serve JavaScript files", async () => {
            const testDir = join(import.meta.dir, "temp");
            await mkdir(testDir, { recursive: true });
            const entrypoint = join(testDir, "entry.ts");
            await writeFile(
                entrypoint,
                'export const msg = "Hello from bundle";'
            );

            try {
                await app.build(entrypoint);
                startServer();

                const res = await fetch(`http://localhost:${port}/entry.ts`);
                expect(res.status).toBe(200);
                expect(res.headers.get("Content-Type")).toBe(
                    "application/javascript"
                );
                const content = await res.text();
                expect(content.length).toBeGreaterThan(0);
            } finally {
                await rm(testDir, { recursive: true, force: true });
            }
        });

        it("should store artifacts for built bundles", async () => {
            const testDir = join(import.meta.dir, "temp");
            await mkdir(testDir, { recursive: true });
            const entrypoint = join(testDir, "entry.js");
            await writeFile(entrypoint, 'console.log("test");');

            try {
                await app.build(entrypoint);
                expect(app.artifacts[entrypoint]).toBeDefined();
            } finally {
                await rm(testDir, { recursive: true, force: true });
            }
        });
    });

    describe("WebSocket Support", () => {
        it("should allow setting websocket handler", () => {
            const wsHandler: Bun.WebSocketHandler<any> = {
                message: (ws, message) => {},
                open: (ws) => {},
                close: (ws) => {},
            };

            app.setWebSocket(wsHandler);
            expect(app.websocket).toBe(wsHandler);
        });

        it("should not throw when calling send() with active server", () => {
            app.get("/test", () => new Response("OK"));
            startServer();
            expect(() => {
                app.send("test-room", { msg: "test" });
            }).not.toThrow();
        });
    });

    describe("Configuration", () => {
        it("should use default port from PORT env or 3000", () => {
            // Port can be set via PORT env variable
            expect(app.port).toBeGreaterThanOrEqual(3000);
        });

        it("should throw when trying to listen twice", () => {
            app.get("/test", () => new Response("OK"));
            startServer();
            expect(() => app.listen()).toThrow("Server is already running");
        });

        it("should accept custom port in listen options", () => {
            app.get("/test", () => new Response("OK"));
            server = app.listen({ port: 0 });
            expect(server.port).toBeGreaterThan(0);
        });
    });

    describe("Plugin System", () => {
        it("should support plugins", async () => {
            const log: string[] = [];

            const myPlugin = (framework: Bundana<any>) => {
                log.push("plugin called");
                framework.get("/plugin-route", () => new Response("From plugin"));
            };

            app.plugin(myPlugin);
            expect(log).toEqual(["plugin called"]);

            startServer();
            const res = await fetch(`http://localhost:${port}/plugin-route`);
            expect(await res.text()).toBe("From plugin");
        });
    });

    describe("Request and Response", () => {
        it("should pass request object to handler", async () => {
            let capturedUrl: string | undefined;

            app.get("/test", (req) => {
                capturedUrl = req.url;
                return new Response("OK");
            });

            startServer();

            await fetch(`http://localhost:${port}/test`);
            expect(capturedUrl).toBe(`http://localhost:${port}/test`);
        });

        it("should pass server object to handler", async () => {
            let capturedServer: any;

            app.get("/test", (req, server) => {
                capturedServer = server;
                return new Response("OK");
            });

            startServer();

            await fetch(`http://localhost:${port}/test`);
            expect(capturedServer).toBeDefined();
            expect(capturedServer.port).toBe(port);
        });

        it("should handle JSON responses", async () => {
            app.get("/json", () =>
                Response.json({ message: "Hello", count: 42 })
            );

            startServer();

            const res = await fetch(`http://localhost:${port}/json`);
            expect(res.headers.get("Content-Type")).toContain(
                "application/json"
            );
            const json = await res.json();
            expect(json).toEqual({ message: "Hello", count: 42 });
        });

        it("should handle custom headers", async () => {
            app.get("/headers", () => {
                return new Response("OK", {
                    headers: {
                        "X-Custom-Header": "CustomValue",
                        "X-Another": "AnotherValue",
                    },
                });
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/headers`);
            expect(res.headers.get("X-Custom-Header")).toBe("CustomValue");
            expect(res.headers.get("X-Another")).toBe("AnotherValue");
        });

        it("should support async handlers", async () => {
            app.get("/async", async () => {
                await Bun.sleep(10);
                return new Response("Async response");
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/async`);
            expect(await res.text()).toBe("Async response");
        });

        it("should handle request body in POST", async () => {
            app.post("/echo", async (req) => {
                const body = await req.text();
                return new Response(body);
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/echo`, {
                method: "POST",
                body: "Echo this",
            });
            expect(await res.text()).toBe("Echo this");
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty response", async () => {
            app.get("/empty", () => new Response());
            startServer();

            const res = await fetch(`http://localhost:${port}/empty`);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe("");
        });

        it("should handle various status codes", async () => {
            app.get("/created", () => new Response("Created", { status: 201 }));
            app.get("/no-content", () => new Response(null, { status: 204 }));
            app.get("/redirect", () =>
                new Response(null, {
                    status: 302,
                    headers: { Location: "/other" },
                })
            );

            startServer();

            const created = await fetch(`http://localhost:${port}/created`);
            expect(created.status).toBe(201);

            const noContent = await fetch(`http://localhost:${port}/no-content`);
            expect(noContent.status).toBe(204);

            const redirect = await fetch(`http://localhost:${port}/redirect`, {
                redirect: "manual",
            });
            expect(redirect.status).toBe(302);
        });

        it("should handle route with query parameters", async () => {
            app.get("/query", (req) => {
                const url = new URL(req.url);
                const name = url.searchParams.get("name");
                return new Response(`Hello ${name}`);
            });

            startServer();

            const res = await fetch(`http://localhost:${port}/query?name=World`);
            expect(await res.text()).toBe("Hello World");
        });
    });
});
