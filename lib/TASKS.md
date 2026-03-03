# TASKS.md - Future Improvements Backlog

This document contains a prioritized list of potential improvements and features for Bundana. All items are designed to be non-breaking additions.

## Priority: HIGH (Should Do Next)

### 1. Add Response Helper Methods

**Goal**: Provide convenient response helpers to reduce boilerplate.

**Implementation**:
```typescript
// Add to Bundana class or as utilities
class ResponseHelpers {
    static json(data: any, status = 200) {
        return Response.json(data, { status });
    }
    
    static text(text: string, status = 200) {
        return new Response(text, { 
            status,
            headers: { "Content-Type": "text/plain" }
        });
    }
    
    static html(html: string, status = 200) {
        return new Response(html, {
            status,
            headers: { "Content-Type": "text/html" }
        });
    }
    
    static redirect(url: string, status = 302) {
        return new Response(null, {
            status,
            headers: { "Location": url }
        });
    }
}
```

**Benefits**:
- Cleaner route handlers
- Less repetitive code
- Better developer experience

**Testing**: Add tests for each helper method

---

### 2. Add Request Context/State Object

**Goal**: Provide a way to pass data between middleware without hacks.

**Implementation**:
```typescript
// Add context to request
interface RequestContext {
    state: Map<string, any>;
}

// Store in WeakMap or extend Request
private contextMap = new WeakMap<Request, RequestContext>();

getContext(req: Request): RequestContext {
    let ctx = this.contextMap.get(req);
    if (!ctx) {
        ctx = { state: new Map() };
        this.contextMap.set(req, ctx);
    }
    return ctx;
}
```

**Usage**:
```typescript
app.use((req, server, next) => {
    const ctx = app.getContext(req);
    ctx.state.set("user", { id: 1 });
    return next();
});

app.get("/profile", (req) => {
    const ctx = app.getContext(req);
    const user = ctx.state.get("user");
    return Response.json(user);
});
```

**Benefits**:
- Cleaner middleware communication
- No global state needed
- Type-safe with proper generics

**Testing**: Test context isolation between requests

---

### 3. Built-in CORS Middleware

**Goal**: Provide a simple CORS middleware for common use cases.

**Implementation**:
```typescript
interface CORSOptions {
    origin?: string | string[];
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
}

function cors(options: CORSOptions = {}) {
    return async (req: any, server: any, next: any) => {
        const response = await next();
        
        const origin = options.origin || "*";
        response.headers.set("Access-Control-Allow-Origin", origin);
        
        if (options.methods) {
            response.headers.set(
                "Access-Control-Allow-Methods",
                options.methods.join(", ")
            );
        }
        
        if (options.allowedHeaders) {
            response.headers.set(
                "Access-Control-Allow-Headers",
                options.allowedHeaders.join(", ")
            );
        }
        
        if (options.credentials) {
            response.headers.set("Access-Control-Allow-Credentials", "true");
        }
        
        return response;
    };
}

// Usage
app.use(cors({ origin: "https://example.com" }));
```

**Benefits**:
- Common use case covered
- Reduces boilerplate
- Easy to configure

**Testing**: Test various CORS configurations

---

### 4. Body Parsing Middleware

**Goal**: Automatically parse request bodies based on Content-Type.

**Implementation**:
```typescript
interface BodyParserOptions {
    json?: boolean;
    text?: boolean;
    formData?: boolean;
    maxSize?: number;
}

function bodyParser(options: BodyParserOptions = {}) {
    return async (req: any, server: any, next: any) => {
        const contentType = req.headers.get("content-type") || "";
        
        if (options.json !== false && contentType.includes("application/json")) {
            try {
                req.body = await req.json();
            } catch (e) {
                return new Response("Invalid JSON", { status: 400 });
            }
        }
        
        if (options.text && contentType.includes("text/")) {
            req.body = await req.text();
        }
        
        if (options.formData && contentType.includes("multipart/form-data")) {
            req.body = await req.formData();
        }
        
        return next();
    };
}

// Usage
app.use(bodyParser({ json: true }));

app.post("/api", (req: any) => {
    console.log(req.body); // Parsed JSON
    return Response.json({ received: req.body });
});
```

**Benefits**:
- Automatic body parsing
- Reduces handler complexity
- Error handling included

**Testing**: Test JSON, text, form-data parsing

---

## Priority: MEDIUM (Nice to Have)

### 5. Route Parameter Parsing

**Status**: ✅ Already supported by Bun natively

**Implementation**: Bun.serve() natively supports route parameters via `req.params`:

```typescript
import type { BunRequest } from "bun";

// Bundana routes automatically get Bun's native parameter support
app.get("/users/:id/posts/:postId", (req: BunRequest<"/users/:id/posts/:postId">) => {
    const { id, postId } = req.params; // Type-safe!
    return Response.json({
        userId: id,
        postId: postId
    });
});
```

**Features**:
- Type-safe parameter access with string literals
- Automatic percent-decoding
- Zero overhead (handled by Bun's optimized router)
- No additional parsing needed

**No action required**: This is already working as Bundana passes routes directly to Bun.serve()

---

### 6. Cache Control for Static Files

**Goal**: Add cache headers to static file responses.

**Implementation**:
```typescript
interface StaticOptions {
    maxAge?: number;
    immutable?: boolean;
    cacheControl?: string;
}

async static(path: string, pattern: string, options: StaticOptions = {}) {
    const glob = new Bun.Glob(pattern);
    const cacheHeader = options.cacheControl || 
        `max-age=${options.maxAge || 3600}${options.immutable ? ', immutable' : ''}`;
    
    for await (const file of glob.scan(".")) {
        const response = new Response(Bun.file(file), {
            headers: {
                "Cache-Control": cacheHeader
            }
        });
        this.routes[`${path}/${file}`] = response;
    }
}

// Usage
await app.static("/public", "public/**/*", { maxAge: 86400, immutable: true });
```

**Benefits**:
- Better performance
- Reduced server load
- Production-ready static serving

**Testing**: Verify cache headers are set correctly

---

### 7. Request Logging Middleware

**Goal**: Provide built-in request logging.

**Implementation**:
```typescript
interface LoggerOptions {
    format?: "tiny" | "combined" | "dev";
    skip?: (req: Request) => boolean;
}

function logger(options: LoggerOptions = {}) {
    return async (req: any, server: any, next: any) => {
        if (options.skip && options.skip(req)) {
            return next();
        }
        
        const start = Date.now();
        const method = req.method;
        const url = req.url;
        
        const response = await next();
        const duration = Date.now() - start;
        
        console.log(`${method} ${url} ${response.status} ${duration}ms`);
        
        return response;
    };
}

// Usage
app.use(logger({ format: "dev" }));
```

**Benefits**:
- Built-in logging
- Configurable formats
- Performance tracking

**Testing**: Test logging output and options

---

### 8. Cookie Parsing Utilities

**Goal**: Parse and set cookies easily.

**Implementation**:
```typescript
class CookieManager {
    static parse(cookieHeader: string | null): Map<string, string> {
        const cookies = new Map<string, string>();
        if (!cookieHeader) return cookies;
        
        cookieHeader.split(";").forEach(cookie => {
            const [key, value] = cookie.trim().split("=");
            if (key && value) {
                cookies.set(key, decodeURIComponent(value));
            }
        });
        
        return cookies;
    }
    
    static serialize(name: string, value: string, options: any = {}): string {
        let cookie = `${name}=${encodeURIComponent(value)}`;
        
        if (options.maxAge) {
            cookie += `; Max-Age=${options.maxAge}`;
        }
        if (options.path) {
            cookie += `; Path=${options.path}`;
        }
        if (options.httpOnly) {
            cookie += "; HttpOnly";
        }
        if (options.secure) {
            cookie += "; Secure";
        }
        if (options.sameSite) {
            cookie += `; SameSite=${options.sameSite}`;
        }
        
        return cookie;
    }
}

// Add to request
function cookieParser() {
    return (req: any, server: any, next: any) => {
        req.cookies = CookieManager.parse(req.headers.get("cookie"));
        return next();
    };
}
```

**Benefits**:
- Easy cookie handling
- Secure by default options
- Standard API

**Testing**: Test parsing and serialization

---

## Priority: LOW (Future Enhancements)

### 9. Rate Limiting Middleware

**Goal**: Built-in rate limiting for API protection.

**Implementation**:
```typescript
interface RateLimitOptions {
    windowMs: number;
    max: number;
    message?: string;
}

function rateLimit(options: RateLimitOptions) {
    const requests = new Map<string, number[]>();
    
    return (req: any, server: any, next: any) => {
        const ip = req.headers.get("x-forwarded-for") || "unknown";
        const now = Date.now();
        const windowStart = now - options.windowMs;
        
        let timestamps = requests.get(ip) || [];
        timestamps = timestamps.filter(t => t > windowStart);
        
        if (timestamps.length >= options.max) {
            return new Response(
                options.message || "Too many requests",
                { status: 429 }
            );
        }
        
        timestamps.push(now);
        requests.set(ip, timestamps);
        
        return next();
    };
}
```

**Testing**: Test rate limit enforcement

---

### 10. Session Management

**Goal**: Simple session handling with cookie or memory store.

**Implementation**: Create a session middleware with storage options.

---

### 11. Compression Middleware

**Goal**: Gzip/Brotli compression for responses.

**Implementation**: Use Bun's compression APIs when available.

---

### 12. File Upload Handling

**Goal**: Handle multipart file uploads easily.

**Implementation**: Parse FormData and save files.

---

### 13. Template Engine Integration

**Goal**: Support for template engines (JSX, Handlebars, etc.).

**Implementation**: Plugin system for renderers.

---

### 14. GraphQL Support

**Goal**: Easy GraphQL endpoint setup.

**Implementation**: Integration with GraphQL libraries.

---

### 15. API Versioning Helper

**Goal**: Simple API versioning (/v1/, /v2/).

**Implementation**: Prefix helper for routes.

---

## Non-Feature Tasks

### Documentation

- [ ] Add more examples to README
- [ ] Create video tutorials
- [ ] Write blog post about architecture
- [ ] Create comparison table with other frameworks

### Testing

- [ ] Add performance benchmarks
- [ ] Add load testing scenarios
- [ ] Increase code coverage to 100%
- [ ] Add integration tests with real apps

### Tooling

- [ ] Set up CI/CD pipeline
- [ ] Add linting configuration
- [ ] Set up automated releases
- [ ] Create example projects repository

### Community

- [ ] Create Discord/Slack channel
- [ ] Set up GitHub Discussions
- [ ] Create contribution guidelines
- [ ] Build example apps showcasing features

---

## How to Add Tasks

When adding a new task to this backlog:

1. **Choose priority level**: HIGH, MEDIUM, or LOW
2. **Write clear goal**: What problem does this solve?
3. **Sketch implementation**: Show how it would work
4. **List benefits**: Why is this valuable?
5. **Note testing needs**: How to test it?
6. **Check for breaking changes**: Must be non-breaking!

## Task Status Tracking

When working on a task:

1. Move task details to GitHub Issues (or similar)
2. Link the issue in this file
3. Update status: In Progress, Completed, Blocked
4. When completed, update relevant documentation
5. Run full test suite
6. Remove from this file or mark as done

---

**Remember**: Quality over quantity. It's better to have a few well-implemented features than many half-baked ones.

**Last Updated**: February 2, 2026
