# CONTEXT.md - Design Context & Decisions

This document explains the design philosophy, key decisions, and known limitations of Bundana.

## Design Goals

### 1. Bun-Native First

**Goal**: Leverage Bun's capabilities without abstracting them away.

**Rationale**: Bun provides native routing via `Bun.serve({ routes })` and native WebSocket support. Rather than building our own routing engine, we use Bun's built-in features. This keeps the framework lightweight and ensures we benefit from Bun's optimizations.

**Implementation**:
- Routes stored as `{ "/path": { GET: handler } }` - directly compatible with Bun.serve()
- WebSocket handler passed directly to Bun.serve()
- Static files served via `Bun.file()` for optimal performance
- Build uses `Bun.build()` natively

### 2. Minimal Overhead

**Goal**: Add as little abstraction as possible while maintaining usability.

**Rationale**: Many frameworks add layers of abstraction that slow down request handling. Bundana should be a thin wrapper that adds middleware composition and error handling without significant overhead.

**Implementation**:
- Middleware composition happens ONCE at route registration, not per-request
- Direct handler invocation - no routing tree traversal
- Zero dependencies (uses only Bun built-ins)
- Type-safe without runtime type checking

### 3. Express-like Ergonomics

**Goal**: Provide a familiar API for developers coming from Express.js.

**Rationale**: Express.js is the de-facto standard for Node.js web frameworks. Developers know the `app.get()`, `app.use()`, and `next()` patterns. By matching this API, we reduce the learning curve.

**Implementation**:
- Methods: `get()`, `post()`, `patch()`, `delete()` mirror Express
- Middleware signature: `(req, res, next)` → `(req, server, next)`
- Global and per-route middleware support
- Plugin system via `app.plugin()`

## Key Architectural Decisions

### Decision 1: Middleware Composition Strategy

**What We Chose**: Compose middleware at route registration time, not per-request.

**Why**:
- Performance: Avoids rebuilding the middleware chain on every request
- Predictability: Middleware order is set once and doesn't change
- Simplicity: Less code to maintain

**Trade-off**: Cannot dynamically change middleware per-request based on request data. This is acceptable because most middleware needs are static.

**Implementation Detail**:
```typescript
private compose(handler, middlewares): Handler {
    return async (req, server) => {
        let index = -1;
        const dispatch = async (i: number): Promise<Response> => {
            if (i <= index) throw new Error("next() called multiple times");
            index = i;
            const mw = middlewares[i];
            if (mw) return mw(req, server, () => dispatch(i + 1));
            return handler(req, server);
        };
        return await dispatch(0);
    };
}
```

### Decision 2: Per-Route Middleware Replaces Global

**What We Chose**: When per-route middleware is provided, it REPLACES global middleware, not appends.

**Why**:
- Simplicity: Easier to reason about middleware order
- Flexibility: Routes can opt-out of global middleware
- Performance: Fewer middleware to execute

**Alternative Considered**: Concatenate global + per-route middleware
- Rejected because: Less control, potential performance hit, harder to debug

**How to Use Both**: If you need both global and per-route:
```typescript
const allMiddlewares = [...app.middlewares, customMiddleware];
app.get("/path", handler, allMiddlewares);
```

### Decision 3: Error Handling via Try-Catch in Composition

**What We Chose**: Wrap the entire middleware/handler chain in try-catch.

**Why**:
- Catches all errors: async and sync
- Single error handler for consistency
- No need for error middleware (like Express's 4-param middleware)

**Implementation**:
```typescript
try {
    return await dispatch(0);
} catch (err) {
    return this.errorHandler 
        ? this.errorHandler(err) 
        : new Response("Internal Server Error", { status: 500 });
}
```

**Trade-off**: Cannot have per-route error handlers easily. Acceptable because most apps need a single error handling strategy.

### Decision 4: Hot Reload via server.reload()

**What We Chose**: Allow adding routes after `listen()` by calling `server.reload()`.

**Why**:
- Development ergonomics: Add routes dynamically during development
- Plugin support: Plugins can add routes to running server
- Bun supports it natively: `server.reload({ routes })`

**Limitation**: This is a Bun-specific feature, not portable to other runtimes.

### Decision 5: Native Bun Route Parameters

**What We Chose**: Use Bun's native route parameter support via `req.params`.

**Why**:
- Bun.serve() natively supports route patterns like `/users/:id`
- Automatic parameter parsing with type-safe autocomplete
- Zero overhead - handled by Bun's optimized router
- Percent-encoded values are automatically decoded

**Implementation**: Route parameters are accessed via `req.params` on BunRequest objects, with TypeScript providing type-safe autocomplete for string literal paths.

### Decision 6: Generic Type Parameter for WebSocket Data

**What We Chose**: `Bundana<WebSocketData>` with generic type.

**Why**:
- Type safety: WebSocket handlers know the shape of `ws.data`
- Flexibility: Different apps need different WebSocket data
- Bun compatibility: Matches `Bun.Server<WebSocketData>`

**Usage**:
```typescript
interface MyWSData { userId: string; }
const app = new Bundana<MyWSData>();
```

### Decision 7: Single Server Instance Per Framework

**What We Chose**: `listen()` can only be called once; throws if called again.

**Why**:
- Clarity: One server per app instance
- Resource management: Prevents accidental multiple server starts
- State consistency: Server reference stored in `this.server`

**Workaround**: Create multiple Bundana instances for multiple servers.

## Implementation Details

### Route Storage Format

Routes are stored as nested objects:
```typescript
routes = {
    "/path": {
        GET: handler,
        POST: handler
    },
    "/other": {
        GET: handler
    }
}
```

This matches Bun.serve() expectations exactly.

### Middleware Execution Order

For a route with per-route middleware:
```
1. Per-route middleware[0]
2. Per-route middleware[1]
3. ... (all per-route middleware)
4. Route handler
```

For a route WITHOUT per-route middleware:
```
1. Global middleware[0]
2. Global middleware[1]
3. ... (all global middleware)
4. Route handler
```

**Note**: Global and per-route middleware do NOT combine automatically.

### Static File Serving

Uses `Bun.Glob` to match files from a base folder:
```typescript
async static(path: string = "", baseFolder: string = "public", globPattern: string = "**/*") {
    const glob = new Bun.Glob(globPattern);
    for await (const file of glob.scan(baseFolder)) {
        this.get(`${path}/${file}`, (req, server) => new Response(Bun.file(`./${baseFolder}/${file}`)));
    }
    // Also watches for new files added to baseFolder
}
```

**Features**: 
- Scans specific base folder instead of current directory
- Watches for file changes and automatically registers new routes
- Supports serving index.html at the base path

**Limitation**: Static files added BEFORE server starts. Cannot add dynamically (easily).

### Build Artifacts

Built files are stored for reference:
```typescript
artifacts: { [entrypoint: string]: Bun.BuildArtifact } = {};
```

**Purpose**: Allows checking build outputs, re-building, or inspecting bundles.

## Known Limitations

### 1. Middleware Order Control

**Limitation**: Cannot easily mix global and per-route middleware.

**Workaround**: Manually combine arrays:
```typescript
app.get("/path", handler, [...app.middlewares, customMw]);
```

**Future**: Could add an `appendMiddleware` option to route methods.

### 2. Single Server Per Instance

**Limitation**: `listen()` can only be called once per Bundana instance.

**Workaround**: Create multiple instances:
```typescript
const app1 = new Bundana();
const app2 = new Bundana();
app1.listen({ port: 3000 });
app2.listen({ port: 4000 });
```

**Rationale**: This is intentional to prevent resource leaks.

### 3. No Request Context Object

**Limitation**: No built-in way to pass data between middleware (like Express's `res.locals`).

**Workaround**: Use WeakMap or closure:
```typescript
const contextMap = new WeakMap<Request, any>();
app.use((req, server, next) => {
    contextMap.set(req, { user: "Alice" });
    return next();
});
```

**Future**: Consider adding context/state object.

### 4. No Built-in Body Parsing

**Limitation**: Must manually call `req.json()`, `req.text()`, etc.

**Workaround**: Create middleware:
```typescript
const jsonParser = async (req, server, next) => {
    if (req.headers.get("content-type")?.includes("application/json")) {
        // Parse and store somewhere
    }
    return next();
};
```

**Future**: Add body parsing middleware to framework or as separate package.

### 5. No Response Helpers

**Limitation**: Must use standard `Response` API or `Response.json()`.

**Workaround**: Create helper functions:
```typescript
const json = (data: any, status = 200) => 
    Response.json(data, { status });

app.get("/api", () => json({ ok: true }));
```

**Future**: Could add response helpers to framework.

### 6. Static Files Not Cached by Default

**Limitation**: No cache-control headers added automatically.

**Workaround**: Add middleware or manually set headers:
```typescript
app.get("/file.css", () => {
    return new Response(Bun.file("file.css"), {
        headers: { "Cache-Control": "max-age=3600" }
    });
});
```

**Future**: Add caching options to `static()` method.

## Performance Characteristics

### Strengths

1. **Route Lookup**: O(1) - direct object property access
2. **Middleware Composition**: Happens once at registration, not per-request
3. **Static Files**: Uses `Bun.file()` which is optimized for streaming
4. **WebSocket**: Leverages Bun's native pub/sub (no emulation)
5. **Memory**: Minimal overhead - routes stored as simple objects

### Potential Bottlenecks

1. **Large Middleware Chains**: Each middleware adds a function call
   - Mitigation: Keep middleware count reasonable (<10)

2. **Many Routes**: Object property lookup is fast but not infinite
   - Mitigation: Bun.serve() handles this internally

3. **Build Artifacts**: Stored in memory
   - Mitigation: Only store references, actual files on disk

## Future Considerations

### Potential Additions (Non-Breaking)

1. **Request Context Object**: `req.context` or similar
2. **Response Helpers**: `res.json()`, `res.status()`, etc.
3. **Body Parsing Middleware**: Built-in JSON/form parsers
4. **CORS Middleware**: Built-in CORS handling
5. **Compression**: Gzip/Brotli support
6. **Cookie Parsing**: Built-in cookie utilities
7. **Session Management**: Simple session middleware

### Breaking Changes to Avoid

1. **Changing middleware signature**: Would break all existing middleware
2. **Changing handler return type**: Response is standard Web API
3. **Changing route registration methods**: API compatibility is key
4. **Removing properties**: `routes`, `port`, `server`, etc. may be used by users

### Architecture Evolution

As the framework grows, consider:

1. **Modular Architecture**: Split into separate packages (core, middleware, utils)
2. **Plugin API Formalization**: Define clear plugin interfaces
3. **Performance Benchmarks**: Track performance over time
4. **Compatibility Layer**: Support other runtimes (Deno, Node.js)?

## Comparison to Other Frameworks

### vs Express.js

**Similarities**:
- Method routing: `get()`, `post()`, etc.
- Middleware with `next()`
- Error handling

**Differences**:
- Bundana uses Bun's native routing (faster)
- Route parameters via Bun's native `req.params` (type-safe)
- No response helpers (yet)
- WebSocket support built-in

### vs Hono

**Similarities**:
- Lightweight and fast
- Middleware support
- Modern TypeScript

**Differences**:
- Hono is runtime-agnostic, Bundana is Bun-specific
- Hono has more features (context, helpers, validators)
- Bundana is simpler and more minimal

### vs Elysia

**Similarities**:
- Built for Bun
- TypeScript-first
- Performance-focused

**Differences**:
- Elysia has schema validation and type inference
- Bundana is more minimal
- Elysia has more built-in features

## Philosophy

### What Bundana IS

- A thin wrapper around Bun.serve()
- A middleware composition system
- An Express-like API for Bun
- A foundation for building web apps

### What Bundana IS NOT

- A full-featured framework like Express
- A validation library
- An ORM or database layer
- A view engine or template system

**Core Principle**: Do one thing well - provide a great routing and middleware system for Bun.

---

**Last Updated**: February 2, 2026
**Version**: 1.0.0 (initial documentation)
