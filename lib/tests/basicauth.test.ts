import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Bundana } from "../Bundana";
import { basicAuth, basicAuthMultiple } from "../BasicAuthMiddleware";

describe("BasicAuth Middleware", () => {
    let server: Bun.Server<any>;
    const port = 3456;

    afterAll(() => {
        server?.stop();
    });

    test("should require authentication", async () => {
        const app = new Bundana();
        app.port = port;

        app.get("/protected", () => new Response("Success"), [
            basicAuth({ username: "admin", password: "secret" })
        ]);

        server = app.listen();

        const response = await fetch(`http://localhost:${port}/protected`);
        
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    });

    test("should allow valid credentials", async () => {
        const app = new Bundana();
        app.port = port + 1;

        app.get("/protected", () => new Response("Success"), [
            basicAuth({ username: "admin", password: "secret" })
        ]);

        server = app.listen();

        const credentials = btoa("admin:secret");
        const response = await fetch(`http://localhost:${port + 1}/protected`, {
            headers: {
                Authorization: `Basic ${credentials}`
            }
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Success");
        
        server.stop();
    });

    test("should reject invalid credentials", async () => {
        const app = new Bundana();
        app.port = port + 2;

        app.get("/protected", () => new Response("Success"), [
            basicAuth({ username: "admin", password: "secret" })
        ]);

        server = app.listen();

        const credentials = btoa("admin:wrong");
        const response = await fetch(`http://localhost:${port + 2}/protected`, {
            headers: {
                Authorization: `Basic ${credentials}`
            }
        });

        expect(response.status).toBe(401);
        expect(await response.text()).toBe("Invalid credentials");
        
        server.stop();
    });

    test("should work as global middleware", async () => {
        const app = new Bundana();
        app.port = port + 3;

        app.use(basicAuth({ username: "admin", password: "secret" }));
        app.get("/protected", () => new Response("Success"));

        server = app.listen();

        // Without auth
        let response = await fetch(`http://localhost:${port + 3}/protected`);
        expect(response.status).toBe(401);

        // With auth
        const credentials = btoa("admin:secret");
        response = await fetch(`http://localhost:${port + 3}/protected`, {
            headers: {
                Authorization: `Basic ${credentials}`
            }
        });

        expect(response.status).toBe(200);
        
        server.stop();
    });

    test("should support multiple users", async () => {
        const app = new Bundana();
        app.port = port + 4;

        app.use(basicAuthMultiple([
            { username: "admin", password: "admin123" },
            { username: "user", password: "user123" }
        ]));

        app.get("/protected", () => new Response("Success"));

        server = app.listen();

        // Test first user
        let credentials = btoa("admin:admin123");
        let response = await fetch(`http://localhost:${port + 4}/protected`, {
            headers: { Authorization: `Basic ${credentials}` }
        });
        expect(response.status).toBe(200);

        // Test second user
        credentials = btoa("user:user123");
        response = await fetch(`http://localhost:${port + 4}/protected`, {
            headers: { Authorization: `Basic ${credentials}` }
        });
        expect(response.status).toBe(200);

        // Test invalid user
        credentials = btoa("hacker:wrong");
        response = await fetch(`http://localhost:${port + 4}/protected`, {
            headers: { Authorization: `Basic ${credentials}` }
        });
        expect(response.status).toBe(401);
        
        server.stop();
    });
});
