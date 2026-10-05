# Bunsai

<p align="center">
  <img src="./client/assets/bunsai-logo.svg" alt="Bunsai logo" width="180">
</p>

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
  - shared rate limiting (`@RateLimit`)
  - serialization (`@Serialize`)
  - typed HTTP error mapping
- Example auth with cookie-based sessions
- Frontend with:
  - `preact`
  - `@preact/signals`
  - `preact-iso` (client-side routing)
- SQL migrations (`migrations/*.sql`) + runner (`migrate.ts`)
- Utility CLIs for users and maintenance (`cli/*`)

## Prerequisites

- Bun `>= 1.4.0`
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
- `APP_URL`, used to build public email links
- `RATE_LIMIT_SECRET` with at least 32 characters in production

`PORT` is optional: the application defaults to `3000`, while `.env.example` explicitly selects `3030`. The HTTP examples below follow `.env.example`.

Email confirmation and password reset require `MAIL_SERVER` and `MAIL_FROM_EMAIL`; port, TLS mode, credentials, and sender name are configurable as shown in `.env.example`. `MAIL_USERNAME` and `MAIL_PASSWORD` are needed only when the SMTP server requires authentication. Behind Caddy, set `APP_URL` to the public `https://` origin: session cookies will then receive the `Secure` attribute even if Caddy talks to Bun over HTTP.

3. Run migrations

```bash
bun run migrate
```

4. (Optional) Seed demo users

```bash
bun run seed
```

This creates 50 users total (49 regular + 1 admin) and can be re-run safely.

The seed restores known demo credentials on every run. Never execute it in production or in an environment exposed to untrusted users.

- Admin: `admin` / `admin123!`
- Demo user: `user001` / `user123!`

5. Start the app

```bash
bun run start
```

## First administrator setup

After applying migrations, open the app in your browser. If an administrator has never been created, the app redirects to `/setup`. Enter an email address, username and a password with 12 to 128 characters. The account receives the `admin` role and is immediately active, without sending email; continue by signing in on the login page.

Set `APP_URL` to the exact browser origin (scheme, host and port). In development, a local `APP_URL` also allows the `localhost`, `127.0.0.1` and `[::1]` aliases with the same scheme and port; Docker Compose respects an explicit `APP_URL` in `.env`. Production requires HTTPS and the exact origin. Complete setup before exposing a fresh installation to untrusted visitors: the first visitor can choose its initial administrator.

Migration `0007_initial_setup.sql` recognizes existing administrators, including seeded accounts, and skips the form. Setup never reopens after completion if the last admin is deleted, disabled or demoted; recovery requires authorized database access. Existing users are never promoted through this form.

`GET /api/setup` returns only `{ required: boolean }`; `POST /api/setup` creates the initial admin once, with origin checks, bounded inputs and a shared rate limit of 5 attempts per IP every 15 minutes. Configure `RATE_LIMIT_SETUP_*` through `.env.example`. PostgreSQL serializes concurrent requests across replicas.

For real regressions, prepare a disposable database named `bunsai_setup_tests`, apply migrations, then run `SETUP_INTEGRATION=1 bun test server/setup.integration.test.ts` with its `DATABASE_URL`. These tests modify users and installation state and are skipped by the standard suite.

## Local development with Docker Compose

With Docker and Compose v2.24 or newer, start Bun, PostgreSQL, Mailpit and MinIO:

```bash
docker compose up -d
docker compose logs -f bun
```

The `.env` file is optional. If present, its settings are passed to Bun; Compose overrides database, SMTP and S3 settings with local container addresses. Bun installs locked dependencies, runs migrations after PostgreSQL is ready, then starts `dev` with automatic reload. Source files are mounted read-only, while dependencies and data use separate Docker volumes. Demo users are not seeded automatically.

| Service | Address from the host |
| --- | --- |
| Bun app | http://localhost:3030 |
| PostgreSQL | `localhost:5432`, database `database`, user `postgres`, password `password` |
| Mailpit email UI | http://localhost:8025 |
| Mailpit SMTP | `localhost:1025`, without authentication or TLS |
| MinIO S3 API | http://localhost:9000 |
| MinIO console | http://localhost:9001 |

MinIO uses local credentials `bunsai` / `bunsai-local-password`. Create the private `bunsai` bucket once using the bundled client:

```bash
docker compose exec minio sh -ec 'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb --ignore-existing local/bunsai'
```

If you set `S3_BUCKET`, replace `bunsai` in the command with that name. Bun receives `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Set `ASSET_STORAGE=s3` in `.env` and recreate Bun with `docker compose up -d bun` to store new assets in MinIO. Host-side tests should use `http://localhost:9000`. Downloads are served through the app, so browsers do not need access to the internal `minio` hostname.

Override ports and credentials using the commented variables in `.env.example`; `PORT` controls the host app port. Use a URL-safe PostgreSQL password because Compose embeds it in `DATABASE_URL`. PostgreSQL credentials are initialized when its volume is first created; changing `.env` does not update an existing database.

```bash
docker compose exec bun bun run seed # optional local demo data only
docker compose down                 # preserves data
```

`docker compose down -v` permanently deletes all project volumes. This stack is for local tests, with loopback-only ports, HTTP and known development credentials. MinIO Community is no longer maintained; keep the pinned release confined to test data (see `SECURITY_AUDIT.md`).

## Bootstrap with `bun create` (optional)

```bash
bun create sebastianomorando/bunsai my-bunsai-app
cd my-bunsai-app
cp .env.example .env
bun run migrate
bun run start
```

## Structure (high-level)

```txt
client/        # Preact frontend + signals + preact-iso
entities/      # Domain/models (User, Session, Asset) with business logic
server/        # Server app, decorators, error handling
lib/           # Bundana (thin HTTP layer over Bun)
migrations/    # SQL migrations
cli/           # User administration and maintenance commands
data/          # Local asset and transformed-image cache storage
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

// Serve ./public through Bun's native directory route.
// The route must end with /*.
app.static("/static/*", { dir: "./public" });
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
- Login, registration, email confirmation, and both password-reset phases use shared PostgreSQL rate limits by IP and identifier. Keys are pseudonymized with HMAC and limited responses include `Retry-After`.
- User listing:
  - normal user: sees only themselves
  - admin: sees all users

## Practical API demo

Example flow with cookie jar:

```bash
# Register
curl -i -X POST http://localhost:3030/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret123"}'

# Open the confirmation link received by email before logging in

# Login (save cookie)
curl -i -c cookie.txt -X POST http://localhost:3030/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# Users list (authenticated, paginated + sortable)
curl -i -b cookie.txt "http://localhost:3030/api/users?page=1&limit=10&sortBy=date_created&sortDir=desc"

# User detail
curl -i -b cookie.txt http://localhost:3030/api/users/<user-id>

# Logout
curl -i -b cookie.txt -X POST http://localhost:3030/api/logout
```

`GET /api/users` supports pagination and ordering:

- `page`, `limit` (default `1`/`10`, max `100`)
- `sortBy`: `date_created`, `username`, `email`, `role`, `is_active`
- `sortDir`: `asc`, `desc`

## Asset API

Assets are stored outside the database (under `data/assets` by default), while metadata lives in PostgreSQL. Each authenticated user can list and read metadata only for their own assets; the asset URL itself is public.

To use AWS S3, MinIO, R2 or a compatible provider, apply `0006_asset_storage.sql` with `bun run migrate` and configure:

```dotenv
ASSET_STORAGE=s3
S3_BUCKET=bunsai
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
# Omit the endpoint for AWS; for MinIO outside Docker:
S3_ENDPOINT=http://localhost:9000
S3_VIRTUAL_HOSTED_STYLE=false
```

Storage uses [Bun.S3Client](https://bun.sh/docs/runtime/s3) without additional SDKs. Temporary credentials use `S3_SESSION_TOKEN`; matching `AWS_*` fallbacks are supported. Set `S3_VIRTUAL_HOSTED_STYLE=true` for endpoints with the bucket in the hostname. Explicit production endpoints require HTTPS. Create the bucket beforehand and keep it private; uploads do not set public ACLs. Use scoped `GetObject`, `PutObject`, `DeleteObject` and required multipart permissions for a dedicated bucket.

`ASSET_STORAGE` selects the backend for new uploads. Each row retains `storage_backend`; existing rows default to `local`, and switching modes does not transfer files. Keep local files and S3 configuration available while their rows exist. All S3 assets use the configured bucket; changing that bucket requires transferring objects with their UUID keys intact.

S3 originals are downloaded through the app with size and concurrency limits and served at `/assets/:id`. `MAX_ASSET_BYTES` defaults to 25 MiB and supports values up to 100 MiB; S3 downloads also enforce this limit. S3 uploads and original downloads have shared per-IP rate limits of 10 and 60 requests per minute respectively, configurable through `RATE_LIMIT_S3_ASSET_*` in `.env.example`. Transformed variants stay in the local cache, and cache hits do not contact S3. Provider failures return a safe `503 ASSET_STORAGE_UNAVAILABLE` without falling back to local storage. Deletion removes storage before the database row, preserving a retryable record when storage fails.

Compose builds MinIO and `mc` from pinned official releases in `docker/minio/Dockerfile`, as the prebuilt image is no longer accessible. The first start needs network access and a few minutes to compile; application files and `.env` are excluded from the build context.

To run real API regressions, prepare a **disposable** database named `bunsai_asset_tests`, apply migrations, and configure a private test bucket. Set `ASSETS_DIR` and `ASSET_CACHE_DIR` to separate temporary directories, then run `ASSET_INTEGRATION=1 bun test server/assets.integration.test.ts`. The standard suite skips these tests, which create users and objects and verify owner isolation.

```bash
# Upload
curl -b cookie.txt -F 'file=@photo.jpg' -F 'title=Hero' \
  http://localhost:3030/api/assets

# Original
curl http://localhost:3030/assets/<asset-id> -o photo.jpg

# On-demand transform (generated once, then served from the disk cache)
curl 'http://localhost:3030/assets/<asset-id>?width=800&height=600&fit=inside&format=webp&quality=80' \
  -o photo.webp

# Built-in preset
curl 'http://localhost:3030/assets/<asset-id>?key=system-medium-contain' -o thumbnail
```

Supported query parameters are `width`, `height`, `quality`, `format` (`auto`, `jpg`, `png`, `webp`), `fit` (`inside`, `contain`, `fill`), `withoutEnlargement`, `rotate`, `flip`, `flop`, `brightness`, and `saturation`. Geometry is intentionally limited to Bun's native `fill` and `inside` modes; true crop/letterbox modes are not emulated with another image library.

Only cache misses consume the image-transform rate limit. Cached variants use LRU eviction with a 512 MiB global quota, at most 10,000 cache files, at most 20 variants per asset, and at most two concurrent transformations per process. The maintenance job removes expired rate-limit records and variants beyond quota.

Optional environment variables include `ASSETS_DIR`, `ASSET_CACHE_DIR`, `MAX_ASSET_BYTES`, `MAX_IMAGE_PIXELS`, `MAX_TRANSFORM_DIMENSION`, `RATE_LIMIT_IMAGE_TRANSFORM_MAX`, `MAX_ASSET_CACHE_BYTES`, `MAX_ASSET_CACHE_FILES`, `MAX_ASSET_CACHE_VARIANTS_PER_ASSET`, and `MAX_CONCURRENT_IMAGE_TRANSFORMS`; see `.env.example` for the complete list.

Behind Caddy, `X-Forwarded-For` is accepted only when it contains one valid IP and the peer address is listed in `TRUSTED_PROXY_IPS`; the default permits same-host Caddy. `RATE_LIMIT_SECRET` is required in production and must be shared by every application replica.

If another proxy or CDN sits in front of Caddy, configure Caddy's global `trusted_proxies` and `trusted_proxies_strict` options, normalize the upstream header with `header_up X-Forwarded-For {client_ip}`, and add only the address from which Caddy reaches Bunsai to `TRUSTED_PROXY_IPS`. Without normalization, Bunsai safely groups the chain under the Caddy peer address.

## Frontend

Frontend lives in `client/` and is already configured for:

- Preact (`jsxImportSource: "preact"` in `tsconfig`)
- state with signals
- routing with `preact-iso`

Included pages:

- `/`
- `/register`
- `/forgot-password`
- `/reset-password`
- `/confirm-email`
- `/login`
- `/users`
- `/users/:id`
- `/assets`
- `/profile`

## CLI

Available commands:

```bash
# Create user
bun run cli/user.ts create <username> [password] [email]

# Reset password (username or email)
bun run cli/user.ts reset-password <username|email>

# Activate a user (username or email)
bun run cli/user.ts activate <username|email>

# Run expired session and token cleanup once
bun run maintenance

# Install/remove the OS-level Bun.cron job (default schedule: @hourly)
bun run maintenance:install
bun run maintenance:install -- "0 3 * * *"
bun run maintenance:remove

# Seed demo users (49 user + 1 admin)
bun run seed
```

`create` uses the regular registration flow: it requires the mail configuration and creates an inactive user who must confirm their email. Use `activate` when an administrator needs to activate the account directly.

The server does not start this job automatically, preventing multiple replicas from registering competing copies. Installation uses the operating system scheduler and is idempotent for the current user. The scheduled process must receive `DATABASE_URL` from its own environment; system schedulers do not necessarily inherit variables from the web service.

## Bun 1.4 checks and diagnostics

```bash
# Isolated parallel suite; test:serial remains available for debugging
bun run test
bun run test:changed
bun run test:serial

# Dependencies and licenses
bun run audit
bun run deps:check
bun run licenses

# Markdown profiles for terminal or automated analysis
bun --cpu-prof-md index.ts
bun --heap-prof-md index.ts

# Inspect a bundle without changing the application's runtime path
bun build ./client/index.html --outdir ./dist --target browser --metafile-md=./dist/metafile.md
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
- Security audit and residual risks: `SECURITY_AUDIT.md`
- Coding agent instructions: `AGENTS.md`
