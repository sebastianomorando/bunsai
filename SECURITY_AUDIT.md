# Security audit

Data dell’audit: 21 agosto 2026.

Questo documento riassume l’audit statico del repository e gli interventi applicati. Non sostituisce un penetration test sul deployment reale, che dipende anche dalla configurazione di Caddy, PostgreSQL, SMTP e sistema operativo.

## Interventi completati

### Adozione di Bun 1.4

- La versione minima, il package manager dichiarato e `@types/bun` sono allineati a Bun 1.4.
- Le route usano direttamente `Bun.Serve.Routes` e `Bun.Serve.DirectoryRouteOptions`; i path letterali propagano i parametri tipizzati agli handler.
- Le trasformazioni usano il tipo pubblico `Bun.Image` senza accessi tramite `any`, mantenendo `maxPixels`, limiti sulle dimensioni e validazione delle opzioni.
- La suite predefinita usa processi paralleli isolati; resta disponibile una modalità seriale per il debug.
- `bun audit`, `bun dedupe --check` e il riepilogo delle licenze sono esposti come script espliciti. `bun audit fix` non viene eseguito automaticamente perché modifica dipendenze e lockfile.

### Manutenzione dei record di autenticazione

- `bun run maintenance` elimina sessioni e richieste di reset scadute e azzera i token di attivazione scaduti.
- Tutte le query hanno struttura statica e cutoff parametrizzato; nessun token, identificativo utente o segreto viene scritto nei log.
- Le operazioni sono idempotenti e usano lo stesso timestamp per l’intera esecuzione, quindi un job interrotto può essere rilanciato.
- Gli indici sulle scadenze di sessioni, reset password e token di attivazione evitano scansioni complete durante la pulizia periodica.
- La schedule passata alla CLI ha caratteri e lunghezza limitati ed è validata anche dal parser di `Bun.cron`.
- Il job non parte automaticamente con il server. `maintenance:install` registra una sola entry OS-level dal titolo fisso per l’utente corrente, evitando un job in-process per ogni replica applicativa.

### Rate limit centralizzato

- Login, registrazione, conferma email, richiesta di reset e consumo del token di reset hanno finestre fisse atomiche condivise in PostgreSQL.
- Ogni operazione è limitata sia per indirizzo client sia per identificatore normalizzato; anche utenti o token inesistenti consumano il limite, evitando differenze utili all’enumerazione.
- IP, email, username e token non vengono conservati nella tabella: la chiave è un digest HMAC-SHA-256 separato per scope. `RATE_LIMIT_SECRET` è obbligatorio in produzione e condiviso tra repliche.
- Le risposte oltre soglia usano `429`, codice `RATE_LIMITED`, dettaglio del tempo residuo e header standard `Retry-After`; non vengono scritte una per una nell’error log per evitare log flooding.
- `X-Forwarded-For` è considerato solo quando contiene un singolo IP valido e il peer TCP appartiene all’elenco esatto `TRUSTED_PROXY_IPS`, che include loopback per Caddy sullo stesso host. Un client diretto o una catena non normalizzata non possono cambiare bucket falsificando l’header.
- I record scaduti vengono eliminati dal job di manutenzione tramite indice su `expires_at`.

### Quota ed eviction della cache immagini

- Solo una cache miss consuma il rate limit delle trasformazioni; varianti identiche già presenti non richiedono nuovo lavoro CPU.
- Le generazioni concorrenti della stessa variante vengono aggregate e il numero complessivo di pipeline `Bun.Image` simultanee è limitato per processo.
- La cache applica LRU tramite `mtime`, una quota globale predefinita di 512 MiB, massimo 10.000 file e massimo 20 varianti per asset. I limiti sono configurabili ma validati entro soglie finite, proteggendo sia spazio sia inode.
- Le nuove varianti sono scritte su file temporaneo e rinominate atomicamente, evitando che una risposta serva contenuti parziali.
- La manutenzione elimina anche file temporanei rimasti da processi interrotti, ma soltanto dopo un’ora per non interferire con trasformazioni attive.
- Una finestra di grazia protegge i file usati recentemente dall’eviction durante le richieste; se non è possibile fare spazio, la nuova variante viene rimossa e la risposta usa `507 STORAGE_QUOTA_EXCEEDED`.
- Asset id e nomi cache sono validati prima di costruire percorsi o glob, con test di regressione per path traversal.
- Il job di manutenzione applica periodicamente l’eviction senza finestra di grazia e riporta soltanto conteggi e byte rimossi.

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

- Il seed usa credenziali demo note e non deve essere eseguito in ambienti esposti.

### Priorità media

- La protezione CSRF si basa principalmente su `SameSite=Lax`; non sono ancora verificati `Origin`/`Sec-Fetch-Site` e non è usato un token/header CSRF dedicato.
- L’endpoint `GET /api/users/by-token` riceve l’API token nella query string, che può finire nei log.
- L’upload controlla la dimensione effettiva solo dopo il parsing di `formData()`.
- SMTP usa STARTTLS quando disponibile, ma non imposta ancora `requireTLS: true`.
- Il middleware Basic Auth usa confronti stringa ordinari e considera non valide password contenenti `:`.

### Dipendenze dal deployment

- Il job OS-level è unico per utente del sistema operativo. Installazioni eseguite con utenti OS differenti possono comunque creare più job; le query idempotenti rendono questa eventualità sicura, ma il deployment deve scegliere un solo responsabile della schedulazione.
- Il processo avviato dal task scheduler deve ricevere `DATABASE_URL` dal proprio ambiente; non deve essere inserito nella schedule o negli argomenti del processo, dove il segreto sarebbe esposto.
- La quota filesystem viene serializzata nel singolo processo. Con una cache condivisa in rete tra più repliche, due eviction possono temporaneamente osservare lo stesso stato; scritture atomiche e manutenzione correggono l’eccesso, ma per una quota rigidamente globale va assegnata una cache separata a ogni replica o un unico processo responsabile delle trasformazioni.
- Se Caddy è a sua volta dietro un proxy o una CDN, il deployment deve configurare `trusted_proxies` e `trusted_proxies_strict` in Caddy e sovrascrivere l’header upstream con `header_up X-Forwarded-For {client_ip}`. Bunsai deve fidarsi soltanto dell’indirizzo con cui Caddy raggiunge l’applicazione; in caso contrario una catena multi-hop viene ignorata e tutte quelle richieste condividono il bucket del peer Caddy.

## Verifiche automatiche

Le modifiche sono coperte da test per composizione middleware, guard di ruolo, token di conferma email, selezione dell’attributo `Secure`, rate limit, proxy fidati, path traversal, trasformazioni e quote/eviction della cache. Prima del rilascio devono essere eseguiti almeno:

```bash
bun run migrate
bun run typecheck
bun run test
bun audit
```

Risultato della verifica locale: typecheck superato, 81 test paralleli superati, bundle frontend e metafile Markdown generati correttamente, nessun duplicato nel lockfile e nessun advisory rilevato da `bun audit` su 12 pacchetti. Le migration `0004_maintenance_indexes.sql` e `0005_rate_limits.sql` non sono state applicate automaticamente a un database.
