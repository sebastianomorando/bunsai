# Bunsai

<p align="center">
  <img src="./client/assets/bunsai-logo.png" alt="Logo di Bunsai" width="180">
</p>

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
  - auth/ownership/ruoli (`@RequireAuth`, `@RequireOwner`, `@RequireRole`)
  - rate limit condiviso (`@RateLimit`)
  - serializzazione (`@Serialize`)
  - mapping errori HTTP tipizzati
- Auth di esempio con sessioni cookie-based
- Frontend con:
  - `preact`
  - `@preact/signals`
  - `preact-iso` (routing client-side)
- Migrazioni SQL (`migrations/*.sql`) + runner (`migrate.ts`)
- CLI per gestione utenti e manutenzione (`cli/*`)

## Prerequisiti

- Bun `>= 1.4.0`
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
- `APP_URL`, usato per costruire i link pubblici inviati via email
- `RATE_LIMIT_SECRET` di almeno 32 caratteri in produzione

`PORT` è opzionale: l’applicazione usa `3000` in assenza della variabile, mentre `.env.example` seleziona esplicitamente `3030`. Gli esempi HTTP seguenti usano il valore di `.env.example`.

Conferma email e reset password richiedono `MAIL_SERVER` e `MAIL_FROM_EMAIL`; porta, modalità TLS, credenziali e nome del mittente sono configurabili come mostrato in `.env.example`. `MAIL_USERNAME` e `MAIL_PASSWORD` servono soltanto se il server SMTP richiede autenticazione. Dietro Caddy imposta `APP_URL` all’origine pubblica `https://`: il cookie di sessione riceverà `Secure` anche se Caddy comunica con Bun via HTTP.

3. Esegui migrazioni

```bash
bun run migrate
```

4. (Opzionale) Seed utenti demo

```bash
bun run seed
```

Questo crea 50 utenti totali (49 standard + 1 admin) ed è rilanciabile senza problemi.

Il seed ripristina credenziali demo note a ogni esecuzione. Non eseguirlo mai in produzione o in un ambiente esposto a utenti non fidati.

- Admin: `admin` / `admin123!`
- Utente demo: `user001` / `user123!`

5. Avvia app

```bash
bun run start
```

## Bootstrap con `bun create` (opzionale)

Se vuoi partire direttamente da un template/repo usando Bun:

```bash
bun create sebastianomorando/bunsai my-bunsai-app
cd my-bunsai-app
cp .env.example .env
bun run migrate
bun run start
```

Note:

- `bun create` può installare automaticamente le dipendenze e inizializzare la cartella progetto.
- Riferimento ufficiale: https://bun.com/docs/runtime/templating/create

## Struttura (high-level)

```txt
client/        # Frontend Preact + signals + preact-iso
entities/      # Dominio/model (User, Session, Asset) con business logic
server/        # App server, decorators, error handling
lib/           # Bundana (layer HTTP sottile sopra Bun)
migrations/    # SQL migrations
cli/           # Comandi per gestione utenti e manutenzione
data/          # Storage locale di asset e cache delle trasformazioni
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

// Serve ./public tramite la directory route nativa di Bun.
// Il percorso della route deve terminare con /*.
app.static("/static/*", { dir: "./public" });
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
- `@RequireRole("admin")` -> accesso riservato agli amministratori (`403`)
- Bypass admin: per default utenti con `role = "admin"` non hanno restrizioni owner
- La registrazione invia un link di conferma valido 24 ore. Nel database resta solo l’hash del token e gli utenti inattivi non possono accedere.
- Gli amministratori possono attivare o disattivare utenti dalla dashboard; la disattivazione revoca sessioni e API token.
- Il reset password invia via email un link monouso valido un'ora. Il token resta nel frammento URL e non viene inviato nella richiesta della pagina; la risposta REST non lo include mai e non rivela se l'indirizzo esiste. Nel database viene conservato solo l'hash SHA-256. Il completamento del reset revoca sessioni e API token esistenti.
- Login, registrazione, conferma email e le due fasi del reset password hanno rate limit condivisi in PostgreSQL per IP e identificatore. Le chiavi sono pseudonimizzate con HMAC e le risposte limitate includono `Retry-After`.
- Lista utenti:
  - utente normale: vede solo sé stesso
  - admin: vede tutti gli utenti

## API demo (pratiche)

Esempio flusso con cookie jar:

```bash
# Register
curl -i -X POST http://localhost:3030/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"secret123"}'

# Apri il link di conferma ricevuto via email prima del login

# Login (salva cookie)
curl -i -c cookie.txt -X POST http://localhost:3030/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}'

# Lista utenti (autenticato, paginata + ordinabile)
curl -i -b cookie.txt "http://localhost:3030/api/users?page=1&limit=10&sortBy=date_created&sortDir=desc"

# Dettaglio utente
curl -i -b cookie.txt http://localhost:3030/api/users/<user-id>

# Logout
curl -i -b cookie.txt -X POST http://localhost:3030/api/logout
```

`GET /api/users` supporta paginazione e ordinamento:
- `page`, `limit` (default `1`/`10`, max `100`)
- `sortBy`: `date_created`, `username`, `email`, `role`, `is_active`
- `sortDir`: `asc`, `desc`

## API asset

Gli asset sono salvati sotto `data/assets` per impostazione predefinita, mentre i metadata vivono in PostgreSQL. Ogni utente autenticato può elencare e leggere i metadata soltanto dei propri asset; l’URL `/assets/:id` resta pubblico.

Le trasformazioni vengono generate solo alla prima richiesta e poi servite dalla cache. Una cache miss è soggetta a rate limit per IP; richieste identiche già in cache non consumano il limite. La cache usa eviction LRU con quota globale (512 MiB), massimo 10.000 file, massimo 20 varianti per asset e al massimo due trasformazioni concorrenti per processo. Il job `maintenance` elimina periodicamente record rate-limit scaduti e varianti oltre quota.

I limiti si configurano tramite le variabili documentate in `.env.example`, incluse `RATE_LIMIT_IMAGE_TRANSFORM_MAX`, `MAX_ASSET_CACHE_BYTES`, `MAX_ASSET_CACHE_FILES`, `MAX_ASSET_CACHE_VARIANTS_PER_ASSET` e `MAX_CONCURRENT_IMAGE_TRANSFORMS`.

Dietro Caddy, `X-Forwarded-For` viene accettato soltanto se contiene un singolo IP valido e l’indirizzo peer appartiene a `TRUSTED_PROXY_IPS`; il valore predefinito permette Caddy sullo stesso host. In produzione `RATE_LIMIT_SECRET` è obbligatorio e deve essere uguale su tutte le repliche.

Se davanti a Caddy è presente un altro proxy o una CDN, configurare in Caddy le opzioni globali `trusted_proxies` e `trusted_proxies_strict`, normalizzare l’header upstream con `header_up X-Forwarded-For {client_ip}` e inserire in `TRUSTED_PROXY_IPS` soltanto l’indirizzo dal quale Caddy raggiunge Bunsai. Senza normalizzazione Bunsai raggruppa in modo sicuro la catena nel bucket del peer Caddy.

## Frontend

Il frontend è in `client/` ed è già configurato per:

- Preact (`jsxImportSource: "preact"` nel `tsconfig`)
- stato con signals
- routing con `preact-iso`

Pagine incluse:

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

Comandi disponibili:

```bash
# Crea utente
bun run cli/user.ts create <username> [password] [email]

# Reset password (username o email)
bun run cli/user.ts reset-password <username|email>

# Attiva utente (username o email)
bun run cli/user.ts activate <username|email>

# Esegui una volta la pulizia di sessioni e token scaduti
bun run maintenance

# Installa/rimuovi il job Bun.cron di sistema (schedule predefinita: @hourly)
bun run maintenance:install
bun run maintenance:install -- "0 3 * * *"
bun run maintenance:remove

# Seed utenti demo (49 user + 1 admin)
bun run seed
```

`create` usa lo stesso flusso della registrazione: richiede la configurazione mail e crea un utente inattivo che deve confermare l’indirizzo email. Usa `activate` quando un amministratore deve attivare direttamente l’account.

Il job non viene avviato automaticamente dal server: in questo modo più repliche non registrano copie concorrenti. L’installazione usa il task scheduler del sistema operativo ed è idempotente per l’utente corrente. Il processo schedulato deve ricevere `DATABASE_URL` dal proprio ambiente; i cron di sistema non ereditano necessariamente le variabili del servizio web.

## Verifica e diagnostica Bun 1.4

```bash
# Suite isolata e parallela; per il debug resta disponibile test:serial
bun run test
bun run test:changed
bun run test:serial

# Dipendenze e licenze
bun run audit
bun run deps:check
bun run licenses

# Profili Markdown leggibili da terminale o strumenti automatici
bun --cpu-prof-md index.ts
bun --heap-prof-md index.ts

# Analisi di un bundle senza cambiare il runtime dell'applicazione
bun build ./client/index.html --outdir ./dist --target browser --metafile-md=./dist/metafile.md
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
- Audit di sicurezza e rischi residui: `SECURITY_AUDIT.md`
- Istruzioni coding agents: `AGENTS.md`
