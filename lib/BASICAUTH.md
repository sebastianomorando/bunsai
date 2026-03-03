# Basic Authentication Middleware for Bundana

This middleware provides HTTP Basic Authentication for Bundana routes.

## Installation

The middleware is included in the `lib/` directory as `BasicAuthMiddleware.ts`.

## Usage

### Global Authentication

Apply basic auth to all routes:

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuth } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

// All routes will require authentication
app.use(basicAuth({ 
    username: "admin", 
    password: "secret",
    realm: "My App" // optional
}));

app.get("/", (req, server) => new Response("Protected content"));

app.listen();
```

### Route-Specific Authentication

Apply basic auth to specific routes only:

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuth } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

const authMiddleware = basicAuth({ 
    username: "admin", 
    password: "secret" 
});

// Public route
app.get("/", (req, server) => new Response("Public content"));

// Protected route
app.get("/admin", (req, server) => {
    return new Response("Admin panel");
}, [authMiddleware]);

app.listen();
```

### Multiple Users

Support multiple username/password combinations:

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuthMultiple } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

app.use(basicAuthMultiple([
    { username: "admin", password: "admin123" },
    { username: "user", password: "user123" },
    { username: "guest", password: "guest123" }
], "Secure Area"));

app.get("/protected", (req, server) => {
    return new Response("Protected content");
});

app.listen();
```

### Environment Variables

Best practice is to store credentials in environment variables:

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuth } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

app.use(basicAuth({ 
    username: process.env.AUTH_USERNAME!,
    password: process.env.AUTH_PASSWORD!
}));

app.get("/", (req, server) => new Response("Protected content"));

app.listen();
```

## API Reference

### `basicAuth(options)`

Creates a basic authentication middleware for a single user.

**Parameters:**
- `options.username` (string, required): The valid username
- `options.password` (string, required): The valid password
- `options.realm` (string, optional): The authentication realm (default: "Secure Area")

**Returns:** Middleware function

### `basicAuthMultiple(users, realm?)`

Creates a basic authentication middleware that supports multiple users.

**Parameters:**
- `users` (Array<{username: string, password: string}>, required): Array of valid credentials
- `realm` (string, optional): The authentication realm (default: "Secure Area")

**Returns:** Middleware function

## Testing

Run the tests with:

```bash
bun test lib/tests/basicauth.test.ts
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Use HTTPS**: Basic authentication sends credentials encoded in base64, which is easily decoded. Always use HTTPS in production.

2. **Strong Passwords**: Use strong, randomly generated passwords.

3. **Environment Variables**: Never hardcode credentials in your source code. Use environment variables or a secrets management system.

4. **Consider Alternatives**: For production applications, consider more secure alternatives like:
   - JWT tokens
   - OAuth 2.0
   - API keys with proper hashing

5. **Rate Limiting**: Implement rate limiting to prevent brute force attacks (not included in this basic middleware).

## Example: Complete Application

```typescript
import { Bundana } from "./lib/Bundana";
import { basicAuth } from "./lib/BasicAuthMiddleware";

const app = new Bundana();

// Public routes
app.get("/", (req, server) => {
    return new Response("Welcome! Visit /admin for admin panel.");
});

// Protected admin routes
const adminAuth = basicAuth({
    username: process.env.ADMIN_USER || "admin",
    password: process.env.ADMIN_PASS || "changeme",
    realm: "Admin Panel"
});

app.get("/admin", (req, server) => {
    return new Response("Admin Dashboard", {
        headers: { "Content-Type": "text/html" }
    });
}, [adminAuth]);

app.get("/admin/users", (req, server) => {
    return Response.json({ users: ["user1", "user2"] });
}, [adminAuth]);

app.listen();
```
