# Bundana 🧣

Bundana 🧣 — a lightweight express-style layer for Bun

## Features

- 🚀 **Bun-native**: Built on top of `Bun.serve()` with native route support
- 🛤️ **Express-like API**: Familiar `get()`, `post()`, `patch()`, `delete()` methods
- 🔌 **Middleware support**: Global and per-route middleware with `next()` composition
- 📦 **Static file serving**: Serve files from glob patterns
- ⚡ **Built-in bundler**: Bundle and serve JavaScript/TypeScript with `build()`
- 🔌 **WebSocket support**: First-class WebSocket handler integration
- 🔥 **Hot reload**: Add routes dynamically after server start
- 🧩 **Plugin system**: Extend framework functionality with plugins
- 🎯 **TypeScript**: Full TypeScript support with generics for WebSocket data

## Installation

```bash
bun add bundana
```

Or simply copy `lib/Bundana.ts` into your project.

## Quick Start

```typescript
import { Bundana } from "./lib/Bundana";

const app = new Bundana();

app.get("/", () => {
    return new Response("Hello, World!");
});

app.listen();
```

## Usage Examples

### Basic Routing

```typescript
import { Bundana } from "./lib/Bundana";

const app = new Bundana();

// GET route
app.get("/hello", () => {
    return new Response("Hello!");
});

// POST route
app.post("/users", async (req) => {
    const body = await req.json();
    return Response.json({ created: true, user: body });
});

// PATCH route
app.patch("/users/:id", async (req) => {
    const id = req.params.id;
    return Response.json({ updated: true, id });
});

// DELETE route
app.delete("/users/:id", () => {
    return new Response("Deleted", { status: 204 });
});

app.listen();
```

### JSON Responses

```typescript
app.get("/api/data", () => {
    return Response.json({
        message: "Success",
        data: [1, 2, 3],
        timestamp: Date.now()
    });
});
```

### Query Parameters and Request Data

```typescript
app.get("/search", (req) => {
    const url = new URL(req.url);
    const query = url.searchParams.get("q");
    return Response.json({ query, results: [] });
});

app.post("/echo", async (req) => {
    const text = await req.text();
    return new Response(text);
});
```

### Global Middleware

```typescript
const app = new Bundana();

// Logging middleware
app.use(async (req, server, next) => {
    console.log(`${req.method} ${req.url}`);
    const start = Date.now();
    const response = await next();
    console.log(`Completed in ${Date.now() - start}ms`);
    return response;
});

// CORS middleware
app.use(async (req, server, next) => {
    const response = await next();
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
});

app.get("/", () => new Response("Hello"));
app.listen();
```

### Per-Route Middleware

```typescript
// Auth middleware
const requireAuth = (req: any, server: any, next: any) => {
    const token = req.headers.get("Authorization");
    if (!token) {
        return new Response("Unauthorized", { status: 401 });
    }
    return next();
};

// Rate limiting middleware
const rateLimit = (req: any, server: any, next: any) => {
    // Check rate limit
    return next();
};

// Protected route with multiple middlewares
app.get(
    "/admin/dashboard",
    (req) => Response.json({ data: "secret" }),
    [requireAuth, rateLimit]
);
```

### Basic Authentication Middleware

Bundana includes a built-in basic authentication middleware:

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuth } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

// Apply to all routes
app.use(basicAuth({ 
    username: "admin", 
    password: "secret" 
}));

// Or apply to specific routes
app.get("/admin", (req) => {
    return new Response("Admin panel");
}, [basicAuth({ username: "admin", password: "secret" })]);

app.listen();
```

See [BASICAUTH.md](./BASICAUTH.md) for detailed documentation.

### Error Handling

```typescript
const app = new Bundana();

// Custom error handler
app.errorHandler = (err) => {
    console.error("Error:", err);
    return Response.json(
        {
            error: "Internal Server Error",
            message: err instanceof Error ? err.message : String(err)
        },
        { status: 500 }
    );
};

app.get("/error", () => {
    throw new Error("Something went wrong!");
});

app.listen();
```

### Static File Serving

```typescript
const app = new Bundana();

// Serve all files from public directory at /static path
await app.static("/static", "public");

// Serve specific file types from assets directory at /assets path
await app.static("/assets", "assets", "*.{css,js,png,jpg}");

// Use default public folder with custom glob pattern
await app.static("/files", "public", "**/*.pdf");

app.listen();
```

### HTML Bundles & Single Page Applications

```typescript
import dashboard from "./dashboard.html";
import spa from "./spa.html";

const app = new Bundana();

// Serve HTML bundle at root - Bun automatically bundles <script> and <link> tags
app.get("/", dashboard);

// Serve SPA with wildcard route - handles all subroutes client-side
app.get("/spa/*", spa);

// The imported HTML files can contain React, TypeScript, CSS, etc.
// Bun bundles everything automatically in development mode
app.listen();
```

**Features**:
- Automatic bundling of `<script>` and `<link>` tags in HTML
- TypeScript, JSX, TSX transpilation
- Hot Module Reloading in development
- Wildcard routes (`/*`) perfect for SPAs with client-side routing
- Zero configuration needed

### Building and Serving JavaScript

```typescript
const app = new Bundana();

// Bundle TypeScript/JavaScript and serve at /app.js
await app.build("./client/app.ts", {
    minify: true,
    sourcemap: "external"
});

// Access at: http://localhost:3000/app.ts
app.listen();
```

### WebSocket Support

```typescript
interface WebSocketData {
    userId: string;
    room: string;
}

const app = new Bundana<WebSocketData>();

app.setWebSocket({
    open(ws) {
        console.log("Client connected");
        ws.subscribe(ws.data.room);
    },
    message(ws, message) {
        console.log("Received:", message);
        // Broadcast to room
        app.send(ws.data.room, { type: "message", data: message });
    },
    close(ws) {
        console.log("Client disconnected");
        ws.unsubscribe(ws.data.room);
    }
});

app.get("/", () => {
    return new Response(Bun.file("./client.html"));
});

app.listen();
```

### Plugin System

```typescript
// Define a plugin
const jsonHelperPlugin = (app: Bundana<any>) => {
    // Add utility methods or routes
    app.get("/health", () => Response.json({ status: "ok" }));
    app.get("/version", () => Response.json({ version: "1.0.0" }));
};

// Use the plugin
const app = new Bundana();
app.plugin(jsonHelperPlugin);
app.listen();
```

### Custom Port Configuration

```typescript
const app = new Bundana();

// Set via PORT environment variable
process.env.PORT = "8080";

// Or override in listen()
app.listen({ port: 8080 });

// Use ephemeral port (for testing)
const server = app.listen({ port: 0 });
console.log(`Running on port ${server.port}`);
```

## API Reference

### Constructor

```typescript
const app = new Bundana<WebSocketData>();
```

Creates a new instance of Bundana. The generic type parameter specifies the shape of WebSocket connection data.

### HTTP Methods

#### `get(path, handler, middlewares?)`

Register a GET route.

```typescript
app.get("/path", (req, server) => new Response("OK"));
```

#### `post(path, handler, middlewares?)`

Register a POST route.

```typescript
app.post("/path", (req, server) => new Response("Created"));
```

#### `patch(path, handler, middlewares?)`

Register a PATCH route.

#### `delete(path, handler, middlewares?)`

Register a DELETE route.

#### `add(method, path, handler, middlewares?)`

Register a route for any HTTP method.

```typescript
app.add("PUT", "/path", handler);
```

### Middleware

#### `use(middleware)`

Add global middleware that runs for all routes.

```typescript
app.use((req, server, next) => {
    console.log(req.method, req.url);
    return next();
});
```

**Middleware signature:**
```typescript
type Middleware<T> = (
    req: Bun.BunRequest,
    server: Bun.Server<T>,
    next: () => Promise<Response>
) => Response | Promise<Response>;
```

### Static Files & Bundling

#### `static(path, baseFolder, globPattern)`

Serve static files from a base folder matching a glob pattern at a URL path.

**Parameters:**
- `path` (optional): The URL path prefix to serve files from (e.g., `/static`). Default: `""`
- `baseFolder` (optional): The folder to scan for files. Default: `"public"`
- `globPattern` (optional): A glob pattern to match files within baseFolder. Default: `"**/*"`

```typescript
// Serve all files from public directory at /static path
await app.static("/static", "public");

// Serve specific file types from assets directory
await app.static("/assets", "assets", "*.{html,css,js}");

// Use defaults - serves public/**/* at root
await app.static();
```

#### `build(entrypoint, options?)`

Bundle and serve a JavaScript/TypeScript file.

```typescript
await app.build("./src/client.ts", {
    minify: true,
    target: "browser"
});
```

#### HTML Bundles

Serve HTML files with automatic bundling by importing them and passing to routes.

```typescript
import dashboard from "./dashboard.html";
import spa from "./spa.html";

// Serve at specific path
app.bundle("/dashboard", dashboard);

// Serve SPA with wildcard for client-side routing
app.bundle("/app/*", spa);
```

**How it works**: When you import an HTML file, Bun automatically:
- Bundles all `<script>` tags (TypeScript, JSX, TSX supported)
- Bundles all `<link rel="stylesheet">` tags
- Enables Hot Module Reloading in development
- Optimizes and minifies in production

**Example HTML file** (`spa.html`):
```html
<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.tsx"></script>
  </body>
</html>
```

### WebSocket

#### `setWebSocket(handler)`

Set the WebSocket handler for the server.

```typescript
app.setWebSocket({
    open: (ws) => { },
    message: (ws, message) => { },
    close: (ws) => { }
});
```

#### `send(room, message)`

Publish a message to all WebSocket connections in a room.

```typescript
app.send("chat-room", { type: "notification", text: "Hello!" });
```

### Server Control

#### `listen(options?)`

Start the server. Returns the Bun.Server instance.

```typescript
const server = app.listen({ port: 3000 });
console.log(`Server running on port ${server.port}`);
```

**Options:** Accepts all `Bun.Serve.Options` parameters.

#### `plugin(fn)`

Register a plugin function that receives the framework instance.

```typescript
app.plugin((framework) => {
    framework.get("/plugin-route", () => new Response("OK"));
});
```

### Error Handling

#### `errorHandler`

Set a custom error handler for uncaught exceptions in routes.

```typescript
app.errorHandler = (err) => {
    return Response.json({ error: String(err) }, { status: 500 });
};
```

### Properties

- `routes`: The routes object passed to `Bun.serve()`
- `port`: The port number (from `PORT` env var or 3000)
- `server`: The Bun.Server instance (null until `listen()` is called)
- `middlewares`: Array of global middlewares
- `artifacts`: Map of build artifacts from `build()` calls
- `websocket`: The WebSocket handler

## Handler Signature

All route handlers receive:

```typescript
type Handler<T> = (
    req: Bun.BunRequest,
    server: Bun.Server<T>
) => Response | Promise<Response>;
```

- `req`: Bun's native request object (extends standard Request)
- `server`: The Bun.Server instance

## Bun Route Parameters

Bundana uses Bun's native routing which supports dynamic route parameters:

```typescript
import type { BunRequest } from "bun";

// TypeScript provides autocomplete for params when using string literals
app.get("/users/:id", (req: BunRequest<"/users/:id">) => {
    const { id } = req.params; // Type-safe access
    return Response.json({ userId: id });
});

// Multiple parameters
app.get("/users/:userId/posts/:postId", (req) => {
    const { userId, postId } = req.params;
    return Response.json({ userId, postId });
});
```

**Features**:
- Automatic parameter extraction via `req.params`
- Type-safe autocomplete with string literal paths
- Percent-encoded values automatically decoded
- Unicode characters supported

## Testing

Run the test suite:

```bash
bun test
```

All tests use Bun's built-in test runner (`bun:test`) and spin up ephemeral servers on random ports to avoid conflicts.

## Performance Notes

- Bundana is a thin wrapper around `Bun.serve()` with minimal overhead
- Middleware composition happens once at route registration, not per-request
- Static file serving uses `Bun.file()` for optimal performance
- WebSocket support leverages Bun's native pub/sub system

## Limitations

- Middleware execution order: per-route middleware array replaces (not appends to) global middleware
- Server can only be started once per instance (call `listen()` only once)

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- All tests pass: `bun test`
- TypeScript types are maintained
- Documentation is updated
- No breaking changes to public API (or provide migration path)

---

Built with ❤️ for Bun
