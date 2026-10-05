# Bunsai

<p align="center">
  <img src="./client/assets/bunsai-logo.svg" alt="Logo di Bunsai" width="180">
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

## Configurazione del primo amministratore

Dopo le migrazioni, apri l’app nel browser. Se non è mai stato creato un amministratore, vieni indirizzato automaticamente a `/setup`: inserisci email, username e una password da 12 a 128 caratteri. L’account viene creato con ruolo `admin`, subito attivo, senza invio di email; poi accedi dalla pagina di login.

Imposta `APP_URL` all’origine esatta del browser (schema, host e porta). In sviluppo, se `APP_URL` è locale, il setup accetta anche gli alias `localhost`, `127.0.0.1` e `[::1]` con lo stesso schema e porta; Docker Compose rispetta un eventuale `APP_URL` impostato in `.env`. In produzione il setup richiede HTTPS e l’origine esatta. Completa la configurazione prima di rendere raggiungibile una nuova installazione a utenti non fidati: il primo visitatore può scegliere l’amministratore iniziale.

La migrazione `0007_initial_setup.sql` riconosce gli amministratori già presenti, inclusi quelli creati dal seed, e non mostra il form. Dopo il completamento, il setup non si riapre se l’ultimo admin viene cancellato, disattivato o perde il ruolo; un recupero richiede un intervento autorizzato sul database. Cambiare email o username nel form non promuove un utente esistente.

`GET /api/setup` restituisce solo `{ required: boolean }`; `POST /api/setup` crea il primo admin una sola volta con controlli di origine, dimensione e rate limit (5 tentativi per IP ogni 15 minuti). Puoi configurare il limite tramite `RATE_LIMIT_SETUP_*` in `.env.example`. Concorrenza tra repliche e richieste simultanee è serializzata da PostgreSQL.

Per le regressioni reali prepara un database usa e getta `bunsai_setup_tests`, applica le migrazioni, quindi esegui `SETUP_INTEGRATION=1 bun test server/setup.integration.test.ts` con `DATABASE_URL` di quel database. Questi test modificano utenti e stato di installazione e sono esclusi dalla suite standard.

## Sviluppo con Docker Compose

Con Docker e Compose v2.24 o successivo puoi avviare Bun, PostgreSQL, Mailpit e MinIO senza installarli sul computer:

```bash
docker compose up -d
docker compose logs -f bun
```

Il file `.env` è opzionale; se esiste, Bun ne carica le impostazioni. Compose sovrascrive database, SMTP e S3 con gli indirizzi dei container locali. Bun installa le dipendenze dal lockfile, esegue le migrazioni dopo che PostgreSQL è pronto e avvia `dev` con reload automatico. Il codice è montato in sola lettura; dipendenze e dati usano volumi Docker separati. Non vengono creati utenti demo automaticamente.

| Servizio | Indirizzo dal computer |
| --- | --- |
| App Bun | http://localhost:3030 |
| PostgreSQL | `localhost:5432`, database `database`, utente `postgres`, password `password` |
| Mailpit, interfaccia email | http://localhost:8025 |
| Mailpit, SMTP | `localhost:1025`, senza autenticazione o TLS |
| MinIO, API S3 | http://localhost:9000 |
| MinIO, console | http://localhost:9001 |

MinIO usa le credenziali locali `bunsai` / `bunsai-local-password`. Crea il bucket privato `bunsai` una volta, usando il client incluso nel container:

```bash
docker compose exec minio sh -ec 'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb --ignore-existing local/bunsai'
```

Se imposti `S3_BUCKET`, sostituisci `bunsai` nel comando con quel nome. Il container Bun riceve `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`, `S3_BUCKET` e le credenziali `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`. Imposta `ASSET_STORAGE=s3` in `.env` e ricrea Bun con `docker compose up -d bun` per salvare i nuovi asset in MinIO. Per test eseguiti sul computer usa invece `http://localhost:9000`. I download passano dall’applicazione, quindi il browser non deve raggiungere il nome interno `minio`.

Le porte e le credenziali sono modificabili tramite le variabili commentate in `.env.example`; `PORT` controlla la porta dell’app sul computer. Per PostgreSQL usa una password URL-safe perché Compose la inserisce in `DATABASE_URL`. Le credenziali di PostgreSQL vengono inizializzate solo alla creazione del volume: modificarle nel file `.env` non aggiorna un database già esistente.

```bash
docker compose exec bun bun run seed # opzionale, solo dati demo locali
docker compose down                 # conserva i dati
```

`docker compose down -v` elimina definitivamente tutti i volumi del progetto. Questa configurazione è destinata ai test locali: espone le porte solo su localhost, usa HTTP e credenziali note. MinIO Community non è più mantenuto; la release fissata deve rimanere confinata a dati di test (vedi `SECURITY_AUDIT.md`).

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

Per usare Amazon S3, MinIO, R2 o un servizio compatibile, applica la migrazione `0006_asset_storage.sql` con `bun run migrate` e configura:

```dotenv
ASSET_STORAGE=s3
S3_BUCKET=bunsai
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
# Per AWS puoi omettere l’endpoint; per MinIO fuori Docker:
S3_ENDPOINT=http://localhost:9000
S3_VIRTUAL_HOSTED_STYLE=false
```

L’implementazione usa [Bun.S3Client](https://bun.sh/docs/runtime/s3), senza SDK aggiuntivi. Sono supportati anche `S3_SESSION_TOKEN` per credenziali temporanee e i fallback `AWS_*`. `S3_VIRTUAL_HOSTED_STYLE=true` abilita gli endpoint con il bucket nel nome host. In produzione gli endpoint espliciti devono usare HTTPS; il bucket deve già esistere e restare privato. Non vengono impostate ACL pubbliche. Servono permessi `GetObject`, `PutObject` e `DeleteObject` sul bucket dedicato, più quelli necessari agli upload multipart.

`ASSET_STORAGE` sceglie il backend dei nuovi upload. Ogni riga conserva `storage_backend`, mentre quelle esistenti vengono marcate `local`; cambiare modalità non trasferisce i file. Mantieni disponibili il filesystem e la configurazione S3 finché esistono righe che li usano. Tutti gli asset S3 usano il bucket configurato: cambiarlo richiede trasferire gli oggetti, conservando le chiavi UUID.

Gli originali S3 sono scaricati dall’app con limiti di dimensione e concorrenza, e serviti dallo stesso URL `/assets/:id`. `MAX_ASSET_BYTES` è 25 MiB per default, configurabile fino a 100 MiB; questo limite vale anche per i download S3. Upload S3 e download degli originali S3 hanno rate limit condivisi per IP, rispettivamente 10 e 60 richieste al minuto, configurabili tramite `RATE_LIMIT_S3_ASSET_*` in `.env.example`. La cache delle varianti resta locale e viene letta senza contattare S3. Un errore del provider non provoca fallback al filesystem; la risposta usa `503 ASSET_STORAGE_UNAVAILABLE` senza dettagli o credenziali. La cancellazione elimina prima il file e poi la riga, così un errore storage lascia un record su cui ritentare.

Il Compose costruisce MinIO e `mc` da release ufficiali fissate in `docker/minio/Dockerfile`, perché l’immagine precompilata non è più accessibile. Il primo avvio richiede rete e qualche minuto di compilazione; il build non include codice applicativo o `.env`.

Per eseguire anche le regressioni delle API reali, prepara un database **usa e getta** chiamato `bunsai_asset_tests`, applica le migrazioni e configura un bucket privato di test. Con `ASSETS_DIR` e `ASSET_CACHE_DIR` su directory temporanee separate, esegui `ASSET_INTEGRATION=1 bun test server/assets.integration.test.ts`. La suite standard esclude questi test, che creano utenti e oggetti e verificano anche l’isolamento tra proprietari.

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

## Pannello database PostgreSQL

Gli amministratori attivi trovano **Database** nel menu (`/database`). La pagina riprende il gestore di `bun-hex-battles`, integrato con Preact, signals e preact-iso. Mostra le tabelle e le viste dello schema `public`, ricerca delle tabelle, struttura delle colonne, chiavi primarie/esterne, valori predefiniti e campi generati. I dati hanno paginazione, ordinamento e filtri per uguaglianza, contenuto testuale e NULL.

Le tabelle applicative aggiunte al progetto supportano inserimento, modifica ed eliminazione, anche con chiavi primarie composte. L'editor distingue valore vuoto, NULL e valore predefinito; JSON, numeri grandi e date mantengono la rappresentazione PostgreSQL senza conversioni JavaScript che perderebbero precisione. Per JSON usa testo JSON valido, per array la sintassi PostgreSQL. I campi generati sono gestiti dal database. Prima dell'eliminazione compare una conferma; i vincoli e le eventuali eliminazioni a cascata restano quelli del database. Un record cambiato nel frattempo restituisce un conflitto: aggiorna e ripeti la modifica.

Le tabelle senza chiave primaria consentono solo lettura e inserimento; le viste, incluse quelle materializzate, sono in sola lettura. `users` permette soltanto la modifica di `username`, `assets` soltanto di `title`. Per le altre operazioni usa le pagine/API dedicate, che gestiscono password, sessioni e file. `sessions`, `password_resets`, `rate_limits`, `app_setup` e `migrations` sono in sola lettura. Password, token, segreti e identificativi di sessione non vengono restituiti, filtrati né modificati.

Il pannello usa la connessione PostgreSQL del progetto: non richiede nuove dipendenze o migrazioni, né accetta connessioni arbitrarie o query SQL libere. Le API `/api/database/tables` e `/api/database/tables/:table[/rows]` verificano a ogni richiesta sessione, ruolo e attivazione. Le scritture richiedono l'origine consentita da `APP_URL`, come il setup iniziale.

Limiti: 500 tabelle, 128 colonne, fino a 50 record per pagina (ridotti per tabelle larghe), 2000 pagine e circa un milione di caratteri per pagina. Ogni valore ha un massimo di 4096 caratteri; quelli più lunghi sono troncati e non modificabili dall'editor. I payload di scrittura sono limitati a 8 KiB. I limiti condivisi sono 120 letture e 30 scritture al minuto per IP; ogni query ha timeout di 3 secondi, attesa lock di 1 secondo e al massimo 4 operazioni database simultanee per processo.

Verifica di integrazione: su un database **temporaneo** chiamato `bunsai_database_tests`, applica le migrazioni ed esegui `DATABASE_ADMIN_INTEGRATION=1 bun test server/databaseAdmin.integration.test.ts`. Usa un database vuoto: i test creano utenti, sessioni, tabelle e viste di prova. I test unitari di sicurezza fanno parte della suite standard.

## Ritaglio della foto profilo

La foto profilo può essere regolata prima del caricamento: scegli il file, spostalo nell'anteprima circolare e regola lo zoom, quindi conferma. Puoi anche usare **Regola la foto selezionata** per ritagliare un tuo asset esistente. Il risultato è un nuovo PNG 512×512; l'originale viene conservato. Premi **Salva profilo** per applicarlo. Sono supportati JPEG, PNG, WebP, GIF e BMP fino a 20 MiB e 40 megapixel; GIF vengono convertite in un'immagine statica.

### Gestione utenti e inviti

Dalla pagina **Utenti**, gli amministratori attivi possono creare account con username, email, password iniziale (12–128 caratteri), ruolo e stato. Il dettaglio utente permette di modificarli, inviare una mail di reset password e consultare le sessioni con IP, browser, date e stato; è possibile revocare una singola sessione o tutte. Cambiare email, ruolo o stato revoca le sessioni e i reset pendenti. Non è possibile disattivare o demotare il proprio account admin; deve restare almeno un admin attivo. Le modifiche concorrenti richiedono di aggiornare i dati prima di salvare nuovamente.

**Utenti → Inviti** invia link personali validi 7 giorni, in italiano o inglese, con ruolo assegnato dall'amministratore. Il destinatario sceglie username e password su `/accept-invitation`: l'email è quella invitata e l'account è subito attivo. Nessuna password viene inviata per email. Sono disponibili elenco paginato, nuovo invio (invalida il vecchio link) e revoca; gli inviti non promuovono account esistenti. L'admin che invita deve restare attivo e mantenere il ruolo per consentire l'accettazione.

Applicare `bun run migrate` per la migration `0008_user_management.sql` (Compose la esegue al riavvio del servizio Bun). Configurare `APP_URL` con l'URL raggiungibile dai destinatari e le variabili `MAIL_*`; in locale le email arrivano su Mailpit, `http://127.0.0.1:8025`. Il reset scade dopo un'ora. Gli invii sono limitati a 20/ora per IP e 3/ora per destinatario.

I test di integrazione richiedono un database **temporaneo** chiamato `bunsai_user_admin_tests`, tutte le migration applicate e Mailpit su SMTP `127.0.0.1:1025` / API `127.0.0.1:8025`. Eseguire `USER_ADMIN_INTEGRATION=1 DATABASE_URL=postgres://…/bunsai_user_admin_tests bun test server/userAdmin.integration.test.ts --timeout 30000`. Il test cancella i dati di questo database; non usare il database applicativo.

## Notifiche, chat interna e comunicazioni admin

Gli utenti attivi autenticati hanno una campanella con notifiche lette/non lette e **Chat** per conversazioni private dirette o di gruppo. Gli avvisi dell'app usano toast chiudibili. Gli amministratori attivi hanno **Comunicazioni** per inviare notifiche personalizzate, email o entrambe a tutti gli utenti attivi, a utenti selezionati oppure a gruppi salvati, con anteprima e cronologia delle consegne. Le chat sono accessibili solo ai partecipanti, anche per gli admin; le tabelle delle comunicazioni sono escluse dalla console database generica.

Applicare `0009_communications.sql` con `bun run migrate` oppure `docker compose restart bun`. La coda persistente usa le impostazioni `MAIL_*` esistenti; le consegne locali sono visibili in Mailpit. Consultare [COMMUNICATIONS.md](COMMUNICATIONS.md) per tentativi di consegna, realtime, limiti, conservazione e test. Il modulo è adattato da Fabulab CMS, consultato tramite il plugin GitHub.

## Libreria media

La pagina **Asset** riprende il frontend di Fabulab CMS: caricamento multiplo e drag & drop, griglia/elenco, ricerca, filtri, ordinamento, paginazione, selezione/cancellazione multipla e pannello dettagli con modifica di titolo/nome e copia dei link ottimizzati. Adattata a Bunsai, tradotta in italiano/inglese e compatibile con storage locale e MinIO/S3. Nessuna nuova migrazione. Dettagli e limiti in [ASSET_MANAGEMENT.md](ASSET_MANAGEMENT.md).
