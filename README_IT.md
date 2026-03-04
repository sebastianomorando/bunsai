# Bunsai

`Bunsai` non nasce come framework da installare, ma come **repo da clonare e hackerare**.

L'idea: darti una base full stack Bun pronta all'uso, con il minimo livello di astrazione possibile sulle API native di Bun, così puoi piegarla alle tue esigenze senza combattere contro convenzioni rigide.

## Filosofia

- Clone > install: forka/clona il progetto e personalizzalo.
- Thin layer: `Bundana` è uno strato leggero sopra `Bun.serve()`.
- Full stack essenziale: backend, frontend, auth di esempio, migrazioni DB, CLI.
- Type-safe by default: tutto in TypeScript con configurazione strict.
- Due stili di routing: express-style classico **oppure** decorators su classi/entity.

## Cosa include il progetto

- Backend HTTP su Bun (`lib/Bundana.ts` + `server/*`)
- Routing express-style (`app.get/post/put/...`) e routing decorator-based
- Sistema decorators avanzato:
  - binding argomenti (`@Args`, `Param`, `Body`, `Query`, ...)
  - auth/ownership (`@RequireAuth`, `@RequireOwner`)
  - serializzazione (`@Serialize`)
  - mapping errori HTTP tipizzati
- Auth di esempio con sessioni cookie-based
- Frontend con:
  - `preact`
  - `@preact/signals`
  - `preact-iso` (routing client-side)
- Migrazioni SQL (`migrations/*.sql`) + runner (`migrate.ts`)
- CLI di utilità (`cli/user.ts`)

## Prerequisiti

- Bun (consigliato `>= 1.3.x`)
- PostgreSQL

## Quickstart

1. Installa dipendenze

```bash
bun install
```

2. Configura env

```bash
cp .env.example .env
```

Imposta almeno:

- `DATABASE_URL`
- `PORT` (opzionale, default 3000)

3. Esegui migrazioni

```bash
bun run migrate.ts
```

4. (Opzionale) Seed utenti demo

```bash
bun run seed.ts
```

Questo crea 50 utenti totali (49 standard + 1 admin) ed è rilanciabile senza problemi.

- Admin: `admin` / `admin123!`
- Utente demo: `user001` / `user123!`

5. Avvia app

```bash
bun run index.ts
```

## Bootstrap con `bun create` (opzionale)

Se vuoi partire direttamente da un template/repo usando Bun:

```bash
bun create <github-user>/<repo> my-bunsai-app
cd my-bunsai-app
cp .env.example .env
bun run migrate.ts
bun run index.ts
```

Note:

- Sostituisci `<github-user>/<repo>` con il repository reale.
- `bun create` può installare automaticamente le dipendenze e inizializzare la cartella progetto.
- Riferimento ufficiale: https://bun.com/docs/runtime/templating/create

## Struttura (high-level)

```txt
client/        # Frontend Preact + signals + preact-iso
entities/      # Dominio/model (User, Session) con business logic
server/        # App server, decorators, error handling
lib/           # Bundana (layer HTTP sottile sopra Bun)
migrations/    # SQL migrations
cli/           # Comandi utili (creazione/reset utenti)
index.ts       # Entry point applicazione
migrate.ts     # Migration runner
seed.ts        # Seeder dati demo (50 utenti incluso admin)
```

## Routing: due modalità

### 1) Express-style (Bundana)

```ts
import app from "./server/app";

app.get("/health", () => Response.json({ ok: true }));
app.post("/echo", async (req) => Response.json(await req.json()));
```

### 2) Decorator-based su classi/entity

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

In `index.ts` le route decorate vengono registrate con:

```ts
registerClassRoutes(app, User);
```

## Auth e autorizzazione (stato attuale)

- Login/logout via sessione cookie (`session_id`)
- `@RequireAuth()` -> blocca richieste non autenticate (`401`)
- `@RequireOwner(...)` -> accesso solo al proprietario (`403`)
- Bypass admin: per default utenti con `role = "admin"` non hanno restrizioni owner
- Lista utenti:
  - utente normale: vede solo sé stesso
  - admin: vede tutti gli utenti

## API demo (pratiche)

Esempio flusso con cookie jar:

```bash
# Register
curl -i -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret"}'

# Login (salva cookie)
curl -i -c cookie.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}'

# Lista utenti (autenticato, paginata + ordinabile)
curl -i -b cookie.txt "http://localhost:3000/api/users?page=1&limit=10&sortBy=date_created&sortDir=desc"

# Dettaglio utente
curl -i -b cookie.txt http://localhost:3000/api/users/<user-id>

# Logout
curl -i -b cookie.txt -X POST http://localhost:3000/api/logout
```

`GET /api/users` supporta paginazione e ordinamento:
- `page`, `limit` (default `1`/`10`, max `100`)
- `sortBy`: `date_created`, `username`, `email`, `role`, `is_active`
- `sortDir`: `asc`, `desc`

## Frontend

Il frontend è in `client/` ed è già configurato per:

- Preact (`jsxImportSource: "preact"` nel `tsconfig`)
- stato con signals
- routing con `preact-iso`

Pagine incluse:

- `/register`
- `/login`
- `/users`
- `/users/:id`

## CLI

Comandi disponibili:

```bash
# Crea utente
bun run cli/user.ts create <username> [password] [email]

# Reset password (username o email)
bun run cli/user.ts reset-password <username|email>

# Seed utenti demo (49 user + 1 admin)
bun run seed.ts
```

## Obiettivo tecnico

Bunsai vuole restare:

- leggibile
- modificabile
- pragmatico

Nessun lock-in: il codice è tuo, puoi cambiare naming, convenzioni, sicurezza, dominio, UI e workflow in base al prodotto reale.

## Documentazione interna

- Decorators: `server/DECORATORS.md`
- Error handling HTTP: `server/ERRORS.md`
- Istruzioni coding agents: `AGENTS.md`
