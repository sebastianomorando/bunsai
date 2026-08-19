# Bunsai

`Bunsai` is not meant to be a framework you install, but a **repository you clone and hack**.

The idea is to give you a full-stack Bun baseline that is ready to run, with the thinnest possible abstraction over Bun’s native APIs, so you can adapt it to your real needs without fighting heavy conventions.

## Philosophy

- Clone > install: fork/clone the project and customize it.
- Thin layer: `Bundana` is a lightweight layer over `Bun.serve()`.
- Essential full stack: backend, frontend, auth example, DB migrations, CLI.
- Type-safe by default: everything is TypeScript with strict settings.
- Two routing styles: classic express-style routing **or** decorators on classes/entities.

## What the project includes

- Bun HTTP backend (`lib/Bundana.ts` + `server/*`)
- Express-style routing (`app.get/post/put/...`) and decorator-based routing
- Advanced decorator system:
  - argument binding (`@Args`, `Param`, `Body`, `Query`, ...)
  - auth/ownership/roles (`@RequireAuth`, `@RequireOwner`, `@RequireRole`)
  - serialization (`@Serialize`)
  - typed HTTP error mapping
- Example auth with cookie-based sessions
- Frontend with:
  - `preact`
  - `@preact/signals`
  - `preact-iso` (client-side routing)
- SQL migrations (`migrations/*.sql`) + runner (`migrate.ts`)
- Utility CLI (`cli/user.ts`)

## Prerequisites

- Bun `>= 1.3.14`
- PostgreSQL

## Quickstart

1. Install dependencies

```bash
bun install
```

2. Configure env

```bash
cp .env.example .env
```

Set at least:

- `DATABASE_URL`
- `PORT` (optional, default 3000)

Email confirmation and password reset require `APP_URL`, `MAIL_SERVER`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_EMAIL`, and optionally `MAIL_FROM_NAME` as shown in `.env.example`. Behind Caddy, set `APP_URL` to the public `https://` origin: session cookies will then receive the `Secure` attribute even if Caddy talks to Bun over HTTP.

3. Run migrations

```bash
bun run migrate.ts
```

4. (Optional) Seed demo users

```bash
bun run seed.ts
```

This creates 50 users total (49 regular + 1 admin) and can be re-run safely.

- Admin: `admin` / `admin123!`
- Demo user: `user001` / `user123!`

5. Start the app

```bash
bun run index.ts
```

## Bootstrap with `bun create` (optional)

```bash
bun create sebastianomorando/bunsai my-bunsai-app
cd my-bunsai-app
cp .env.example .env
bun run migrate.ts
bun run index.ts
```

## Structure (high-level)

```txt
client/        # Preact frontend + signals + preact-iso
entities/      # Domain/models (User, Session) with business logic
server/        # Server app, decorators, error handling
lib/           # Bundana (thin HTTP layer over Bun)
migrations/    # SQL migrations
cli/           # Utility commands (create/reset users)
index.ts       # Application entry point
migrate.ts     # Migration runner
seed.ts        # Demo data seeder (50 users incl. admin)
```

## Routing: two modes

### 1) Express-style (Bundana)

```ts
import app from "./server/app";

app.get("/health", () => Response.json({ ok: true }));
app.post("/echo", async (req) => Response.json(await req.json()));
```

### 2) Decorator-based on classes/entities

```ts
class UserController {
  @Route("GET", "/api/users/:id")
  @RequireAuth()
  @RequireOwner("id")
  @Serialize((u) => ({ id: u.id, username: u.username }))
  @Args(Param("id"))
  static async getById(id: string) {
    return await UserRepo.getById(id);
  }
}
```

In `index.ts`, decorated routes are registered with:

```ts
registerClassRoutes(app, User);
```

## Auth & authorization (current state)

- Login/logout via cookie session (`session_id`)
- `@RequireAuth()` -> blocks unauthenticated requests (`401`)
- `@RequireOwner(...)` -> owner-only access (`403`)
- `@RequireRole("admin")` -> admin-only access (`403`)
- Admin bypass: by default, users with `role = "admin"` bypass owner checks
- Registration sends a 24-hour email confirmation link. Only the token hash is stored and inactive users cannot log in.
- Admins can activate/deactivate users from the dashboard; deactivation revokes sessions and API tokens.
- Password reset sends a one-hour, single-use link by email. The token stays in the URL fragment so it is not sent in the page request; the REST response never includes it and does not reveal whether the address exists. Only the SHA-256 token hash is stored. Completing a reset revokes existing sessions and API tokens.
- User listing:
  - normal user: sees only themselves
  - admin: sees all users

## Practical API demo

Example flow with cookie jar:

```bash
# Register
curl -i -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret123"}'

# Open the confirmation link received by email before logging in

# Login (save cookie)
curl -i -c cookie.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# Users list (authenticated, paginated + sortable)
curl -i -b cookie.txt "http://localhost:3000/api/users?page=1&limit=10&sortBy=date_created&sortDir=desc"

# User detail
curl -i -b cookie.txt http://localhost:3000/api/users/<user-id>

# Logout
curl -i -b cookie.txt -X POST http://localhost:3000/api/logout
```

## Asset API

Assets are stored outside the database (under `data/assets` by default), while metadata lives in PostgreSQL. Each authenticated user can list and read metadata only for their own assets; the asset URL itself is public.

```bash
# Upload
curl -b cookie.txt -F 'file=@photo.jpg' -F 'title=Hero' \
  http://localhost:3000/api/assets

# Original
curl http://localhost:3000/assets/<asset-id> -o photo.jpg

# On-demand transform (generated once, then served from the disk cache)
curl 'http://localhost:3000/assets/<asset-id>?width=800&height=600&fit=inside&format=webp&quality=80' \
  -o photo.webp

# Built-in preset
curl 'http://localhost:3000/assets/<asset-id>?key=system-medium-contain' -o thumbnail
```

Supported query parameters are `width`, `height`, `quality`, `format` (`auto`, `jpg`, `png`, `webp`), `fit` (`inside`, `contain`, `fill`), `withoutEnlargement`, `rotate`, `flip`, `flop`, `brightness`, and `saturation`. Geometry is intentionally limited to Bun's native `fill` and `inside` modes; true crop/letterbox modes are not emulated with another image library.

Optional environment variables: `ASSETS_DIR`, `ASSET_CACHE_DIR`, `MAX_ASSET_BYTES`, `MAX_IMAGE_PIXELS`, and `MAX_TRANSFORM_DIMENSION`.

`GET /api/users` supports pagination and ordering:
- `page`, `limit` (default `1`/`10`, max `100`)
- `sortBy`: `date_created`, `username`, `email`, `role`, `is_active`
- `sortDir`: `asc`, `desc`

## Frontend

Frontend lives in `client/` and is already configured for:

- Preact (`jsxImportSource: "preact"` in `tsconfig`)
- state with signals
- routing with `preact-iso`

Included pages:

- `/register`
- `/confirm-email`
- `/login`
- `/users`
- `/users/:id`

## CLI

Available commands:

```bash
# Create user
bun run cli/user.ts create <username> [password] [email]

# Reset password (username or email)
bun run cli/user.ts reset-password <username|email>

# Activate a user (username or email)
bun run cli/user.ts activate <username|email>

# Seed demo users (49 user + 1 admin)
bun run seed.ts
```

## Technical goal

Bunsai is intended to stay:

- readable
- modifiable
- pragmatic

No lock-in: the code is yours, and you can change naming, conventions, security rules, domain logic, UI, and workflow for your actual product.

## Internal documentation

- Decorators: `server/DECORATORS.md`
- HTTP error handling: `server/ERRORS.md`
- Coding agent instructions: `AGENTS.md`
