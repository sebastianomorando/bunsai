# Security audit

Data dell’audit: 19 agosto 2026.

Questo documento riassume l’audit statico del repository e gli interventi applicati. Non sostituisce un penetration test sul deployment reale, che dipende anche dalla configurazione di Caddy, PostgreSQL, SMTP e sistema operativo.

## Interventi completati

### Dipendenze email

- `nodemailer` è stato aggiornato dalla serie 8 alla versione `9.0.5`.
- L’advisory `GHSA-p6gq-j5cr-w38f`, corretto a partire dalla `9.0.1`, non risulta più applicabile.

### Middleware globali

Prima dell’intervento, specificare middleware per una route sostituiva l’intera catena globale. Le route decorate passavano inoltre sempre un array, anche vuoto, e potevano quindi evitare silenziosamente middleware globali di autenticazione o hardening.

Ora Bundana compone la catena nel seguente ordine:

1. middleware globali registrati prima della route;
2. middleware specifici della route;
3. handler.

È stato aggiunto un test di regressione anche per le route registrate tramite decorator.

### Isolamento degli asset

- `GET /api/assets` filtra per `uploaded_by` usando l’utente della sessione.
- `GET /api/assets/:id` verifica che l’utente sia il proprietario, senza bypass amministrativo.
- Gli URL `/assets/:id` restano pubblici per scelta progettuale; la modifica riguarda listing e metadati autenticati.

### Cookie di sessione dietro Caddy

Caddy protegge il tratto browser–reverse proxy con HTTPS, ma questo non aggiunge automaticamente l’attributo `Secure` al cookie creato dall’applicazione.

Il cookie di sessione ora riceve `Secure` quando:

- `APP_URL` usa `https://`;
- oppure `NODE_ENV=production`;
- oppure `SESSION_COOKIE_SECURE=true` è configurato esplicitamente.

Per un deployment dietro Caddy, `APP_URL` deve rappresentare l’origine pubblica HTTPS, anche quando Caddy comunica con Bun tramite HTTP sulla rete interna.

### Conferma dell’indirizzo email

- La registrazione crea utenti inattivi e invia un link di conferma valido 24 ore.
- Il token casuale contiene 256 bit; nel database viene conservato solo il relativo hash SHA-256.
- Il token è inserito nel frammento dell’URL e quindi non viene inviato nella richiesta iniziale della pagina.
- `POST /api/email-confirmation` consuma il token e attiva l’account.
- Il login rifiuta gli account inattivi.
- Anche il cambio di indirizzo email richiede una nuova conferma e revoca sessioni/API token.
- La migration `0003_email_confirmation.sql` aggiunge scadenza e indice univoco del token.

### Amministrazione utenti

- È disponibile il nuovo guard `@RequireRole("admin")`.
- La dashboard permette agli amministratori di attivare o disattivare gli utenti.
- Un amministratore non può disattivare il proprio account dalla sessione corrente.
- La disattivazione revoca tutte le sessioni e l’API token dell’utente.
- Il comando `bun run cli/user.ts activate <username|email>` consente l’attivazione da CLI.

### Cambio password

Ogni chiamata al metodo di aggiornamento password ora revoca tutte le sessioni e l’API token. Questo vale sia per il profilo sia per il reset da CLI; il reset via email applicava già la stessa politica.

## Finding ancora aperti

Questi punti erano emersi durante l’audit ma non facevano parte degli interventi richiesti in questa iterazione:

### Priorità alta

- Manca un rate limit centralizzato per login, registrazione e richieste di reset/conferma.
- Le trasformazioni immagini pubbliche possono generare molte varianti persistenti senza quota o eviction della cache.
- Il seed usa credenziali demo note e non deve essere eseguito in ambienti esposti.

### Priorità media

- La protezione CSRF si basa principalmente su `SameSite=Lax`; non sono ancora verificati `Origin`/`Sec-Fetch-Site` e non è usato un token/header CSRF dedicato.
- L’endpoint `GET /api/users/by-token` riceve l’API token nella query string, che può finire nei log.
- L’upload controlla la dimensione effettiva solo dopo il parsing di `formData()`.
- SMTP usa STARTTLS quando disponibile, ma non imposta ancora `requireTLS: true`.
- Il middleware Basic Auth usa confronti stringa ordinari e considera non valide password contenenti `:`.

## Verifiche automatiche

Le modifiche sono coperte da test per composizione middleware, guard di ruolo, token di conferma email e selezione dell’attributo `Secure`. Prima del rilascio devono essere eseguiti almeno:

```bash
bun run migrate
bun run typecheck
bun test
bun audit
```

Risultato della verifica locale: typecheck superato, 65 test superati, bundle frontend generato correttamente e nessun advisory rilevato da `bun audit`. La migration è stata aggiunta al repository ma non applicata automaticamente a un database esistente.
