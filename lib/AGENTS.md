# AGENTS.md - Documentation for AI Coding Agents

This document provides guidance for AI coding agents working on the Bundana project.

## Project Purpose

Bundana 🧣 — a lightweight express-style layer for Bun

It provides:

- A familiar Express-style API (get, post, patch, delete)
- Middleware composition with `next()` pattern
- Integration with Bun's native routing system
- WebSocket support through Bun's pub/sub
- Static file serving and bundling capabilities
- Plugin system for extensibility

**Goal**: Provide a minimal abstraction over Bun.serve() while maintaining the ergonomics of Express.js, without adding bloat or unnecessary abstractions.

## Architecture Overview

### Core Components

1. **Bundana Class** (`lib/Bundana.ts`)
   - Main entry point for the framework
   - Generic type parameter for WebSocket data: `Bundana<WebSocketData>`
   - Stores routes in `routes` object compatible with `Bun.serve()`
   - Manages middleware composition and error handling

2. **Route Registration**
   - Routes stored in format: `{ "/path": { GET: handler, POST: handler } }`
   - Methods: `get()`, `post()`, `patch()`, `delete()`, `add()`
   - Handlers receive `(req: Bun.BunRequest, server: Bun.Server) => Response`
   - Hot reload supported: routes can be added after `listen()` called

3. **Middleware System**
   - Global middleware: `app.use(middleware)` - stored in `middlewares[]`
   - Per-route middleware: passed as 3rd parameter to route methods
   - Middleware composition via `compose()` method
   - Each middleware receives `(req, server, next) => Response`
   - **Important**: Per-route middleware REPLACES global middleware (doesn't append)

4. **Error Handling**
   - Try-catch in `compose()` catches all handler/middleware errors
   - If `errorHandler` is set, it processes the error
   - Otherwise, returns `500 "Internal Server Error"`
   - Calling `next()` multiple times throws error

5. **Static Files & Build**
   - `static(path, baseFolder, glob)`: Uses `Bun.Glob` to scan baseFolder and register file routes at a URL path
   - `build(entrypoint, options)`: Bundles with `Bun.build()` and serves
   - Build artifacts stored in `artifacts` map

6. **WebSocket Support**
   - Set handler via `setWebSocket(handler)`
   - Publish messages via `send(room, message)`
   - WebSocket handler passed to `Bun.serve()` options

### File Structure

```
/home/ubuntu/save-slot/
├── lib/
│   ├── Bundana.ts               # Main framework class
│   └── README.md                # User documentation
│   └── tests/
│       └── bundana.test.ts      # Test suite (37 tests)
├── AGENTS.md                    # This file
├── CONTEXT.md                   # Design decisions & limitations
├── TASKS.md                     # Future improvements backlog
├── index.ts                     # Main application (if exists)
├── package.json
└── tsconfig.json
```

## How to Run Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test lib/tests/bundana.test.ts

# Run with watch mode
bun test --watch
```

**Test Requirements:**
- All tests MUST clean up servers: `server.stop(true)` in `afterEach()`
- Use ephemeral ports: `app.listen({ port: 0 })`
- Avoid timing-based assertions (no `setTimeout` unless necessary)
- Integration tests should use actual HTTP requests with `fetch()`

## How to Add Routes/Middlewares

### Adding a Route

```typescript
// In Bundana.ts, no changes needed - routes are added by users

// Usage example:
app.get("/new-route", (req, server) => {
    return new Response("Hello");
});
```

### Adding Global Middleware

```typescript
// Users call app.use()
app.use((req, server, next) => {
    console.log(req.method);
    return next();
});
```

### Adding Features to Framework

When adding new methods to `Bundana`:

1. **Add the method** to the class
2. **Write tests first** in `lib/tests/bundana.test.ts`
3. **Update type definitions** if needed
4. **Document in** `lib/README.md`
5. **Update TASKS.md** if this was a planned feature
6. **Update CONTEXT.md** if this changes design decisions

## Coding Style Rules

### TypeScript Standards

1. **No `any` types** unless absolutely necessary
   - Use generics or proper type definitions
   - Exception: When interfacing with untyped external APIs

2. **Explicit return types** for public methods
   ```typescript
   get(path: string, handler: Handler<T>): void
   ```

3. **Generic type parameters** for extensibility
   ```typescript
   class Bundana<WebSocketData> { ... }
   ```

4. **Private methods** prefixed with `private` keyword
   ```typescript
   private compose(handler, middlewares): Handler<T> { ... }
   ```

### Naming Conventions

- **Classes**: PascalCase (`Bundana`)
- **Methods**: camelCase (`setWebSocket`, `errorHandler`)
- **Types**: PascalCase (`Handler`, `Middleware`)
- **Variables**: camelCase (`middlewares`, `routes`)
- **Constants**: UPPER_SNAKE_CASE if truly constant

### Code Organization

1. **Type definitions** at the top of the file
2. **Class properties** declared before constructor
3. **Public methods** before private methods
4. **Group related methods** (e.g., all HTTP verbs together)

### Documentation

- **TSDoc comments** for public APIs
- **Inline comments** for complex logic only
- **Examples** in README for each feature
- **Tests as documentation** - they show how to use the API

## Definition of "Done" for PRs

A pull request is considered complete when:

### 1. Code Quality
- [ ] TypeScript compiles without errors
- [ ] No `any` types introduced (unless justified)
- [ ] Follows project naming conventions
- [ ] Code is readable and well-structured

### 2. Testing
- [ ] All existing tests pass: `bun test`
- [ ] New tests written for new features
- [ ] Edge cases covered
- [ ] Tests use proper cleanup (server.stop)
- [ ] No flaky tests (timing-dependent)

### 3. Documentation
- [ ] `lib/README.md` updated with examples
- [ ] TSDoc comments added for new public methods
- [ ] `CONTEXT.md` updated if design changes
- [ ] `TASKS.md` updated (mark as done or remove)
- [ ] `AGENTS.md` updated if workflow changes

### 4. Compatibility
- [ ] No breaking changes to public API
- [ ] If breaking changes necessary:
  - [ ] Provide backward-compatible aliases
  - [ ] Document migration path
  - [ ] Version bump planned (semantic versioning)

### 5. Performance
- [ ] No significant performance regressions
- [ ] Minimal overhead added (measure if unsure)
- [ ] Memory leaks checked (especially for servers)

### 6. Integration
- [ ] Works with existing examples
- [ ] Hot reload still functions
- [ ] WebSocket support unaffected (if present)

## Common Tasks

### Adding a New HTTP Method

```typescript
// Add method to Bundana class
put(path: string, handler: Handler<WebSocketData>, middlewares?: Middleware<WebSocketData>[]) {
    this.add("PUT", path, handler, middlewares);
}
```

### Adding a Utility Method

```typescript
// Example: Adding a json() helper
json(path: string, data: any) {
    this.get(path, () => Response.json(data));
}
```

### Adding Middleware

Create reusable middleware functions:

```typescript
// In a separate file: lib/middlewares.ts
export const cors = (req: any, server: any, next: any) => {
    const response = await next();
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
};
```

## Testing Guidelines

### Test Structure

```typescript
describe("Feature Name", () => {
    let app: Bundana<any>;
    let server: Bun.Server | null = null;
    
    beforeEach(() => {
        app = new Bundana();
    });
    
    afterEach(async () => {
        if (server) {
            server.stop(true);
            server = null;
        }
    });
    
    it("should do something", async () => {
        app.get("/test", () => new Response("OK"));
        server = app.listen({ port: 0 });
        const port = server.port;
        
        const res = await fetch(`http://localhost:${port}/test`);
        expect(res.status).toBe(200);
    });
});
```

### What to Test

1. **Happy paths** - normal usage
2. **Error cases** - invalid input, errors thrown
3. **Edge cases** - empty data, null, undefined
4. **Integration** - multiple features working together
5. **Middleware order** - composition works correctly
6. **Async behavior** - promises resolve correctly

### What NOT to Test

- Internal Bun.serve() behavior (trust Bun)
- Standard Response/Request objects (trust Web APIs)
- Third-party libraries (trust their tests)

## Debugging Tips

### Common Issues

1. **Port already in use**
   - Ensure `server.stop(true)` called in tests
   - Use `port: 0` for ephemeral ports

2. **Routes not responding**
   - Check route is registered before server starts
   - Verify `Bun.serve()` has routes object

3. **Middleware not running**
   - Check if per-route middleware overrides global
   - Ensure `next()` is called

4. **TypeScript errors**
   - Check generic type parameters match
   - Verify Handler/Middleware signatures

### Useful Debug Commands

```bash
# Check TypeScript compilation
bun run tsc --noEmit

# Run single test
bun test --test-name-pattern "should register GET"

# Run with verbose output
bun test --verbose

# Check Bun version
bun --version
```

## Release Checklist

Before releasing a new version:

1. [ ] All tests pass
2. [ ] Documentation updated
3. [ ] CHANGELOG.md updated (if exists)
4. [ ] Version bumped in package.json
5. [ ] Git tag created
6. [ ] Breaking changes documented

## Questions for Future Contributors

When making changes, ask yourself:

1. **Does this add value?** - Is this feature really needed?
2. **Is this Bun-native?** - Does it leverage Bun's capabilities?
3. **Does this add bloat?** - Can we achieve the same with less code?
4. **Is this testable?** - Can we write deterministic tests?
5. **Is this documented?** - Will users understand how to use it?
6. **Is this breaking?** - Do we need migration docs?

## Resources

- [Bun Documentation](https://bun.sh/docs)
- [Bun.serve() API](https://bun.sh/docs/api/http)
- [Web Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

---

**Remember**: Keep it simple, keep it fast, keep it Bun-native!
