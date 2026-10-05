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

### Configurazione del primo amministratore (5 ottobre 2026)

- Il frontend Preact verifica lo stato tramite un helper API centralizzato e signals; se l’installazione è aperta, `preact-iso` indirizza al form `/setup` con email, username e password. Errori di rete mostrano un’opzione per ritentare, senza avviare registrazione/login prima di aver controllato lo stato. Messaggi e form supportano inglese e italiano.
- La migrazione `0007_initial_setup.sql` conserva uno stato singleton e inizializza il completamento in base agli admin esistenti, anche inattivi. Un trigger chiude definitivamente il setup quando un admin viene inserito o assegnato tramite seed, CLI o altri percorsi autorizzati. Eliminare, disattivare o demotare l’ultimo admin non riapre l’endpoint pubblico; un controllo mancante fallisce chiuso.
- La creazione avviene in una transazione PostgreSQL con lock `FOR UPDATE` sul singleton e un nuovo controllo del ruolo admin. INSERT utente e completamento sono atomici, anche tra repliche. Un conflitto su username/email causa rollback, non la promozione di un account esistente. Il ruolo e l’attivazione sono fissati dal server; non arrivano dal payload.
- Username/email hanno limiti di lunghezza e non accettano caratteri di controllo. La password iniziale richiede 12–128 caratteri ed è conservata solo come hash Bun. JSON è limitato a 8 KiB anche senza `Content-Length` o con lunghezza falsa. Le query sono parametrizzate; risposte e serializzazione non restituiscono password, hash, email o identificativi del nuovo admin. Non vengono inviati link di attivazione: l’account scelto durante installazione è subito attivo, poi usa il login e i cookie esistenti.
- Il POST richiede `application/json`, un `Origin` uguale a `APP_URL` e non accetta `Sec-Fetch-Site: cross-site`. Se `APP_URL` manca, l’origine fidata è il localhost della porta applicativa, non l’hostname ricevuto dalla richiesta, per evitare DNS rebinding. In sviluppo, per un’origine configurata locale, sono accettati esclusivamente gli alias espliciti `localhost`, `127.0.0.1` e `[::1]` con identico schema e porta. Non sono accettati hostname ricavati da `Host` o header proxy, indirizzi LAN, porte diverse, origini assenti/nulle o URL con credenziali/path. In produzione l’origine deve coincidere esattamente e usare HTTPS. Docker Compose rispetta `APP_URL` esplicitamente configurato. Test di regressione coprono alias locali, origine remota, protocollo/porta, cross-site e produzione. Controlli di origine e rate limit precedono parsing e hashing.
- Il rate limit è condiviso in PostgreSQL per IP (5 tentativi ogni 15 minuti, configurabile). Al massimo due password sono elaborate contemporaneamente per processo; le richieste ulteriori ricevono un errore sicuro. Il lock non viene mantenuto durante l’hashing. I conflitti e gli errori non includono credenziali; stato e risposta di creazione usano `Cache-Control: no-store`.
- Rischio di deployment esplicito: come un installer pubblico, una nuova installazione senza admin può essere rivendicata dal primo visitatore. I controlli CSRF/rate limit non autenticano quel visitatore. Completare il setup su localhost o con accesso di rete ristretto prima dell’esposizione pubblica. Per un admin perso dopo il completamento, il recupero deve avvenire con accesso autorizzato al database, senza riaprire il wizard. Le altre API pubbliche mantengono il comportamento preesistente.
- Regressioni automatiche coprono validazione, body limit, origine/HTTPS, stato iniziale, collisioni, rollback, rate limit, richieste simultanee, hash/login e chiusura permanente via trigger. La verifica browser reale ha coperto redirect da `/register` a `/setup`, lingua italiana, password minima, creazione, redirect al login, chiusura del wizard e accesso dell’admin. Nessuna dipendenza o lockfile è stato modificato.
- Esito: typecheck e `git diff --check` superati, 103 test standard superati e 6 test setup con PostgreSQL reale superati. I test delle integrazioni esterne restano esclusi dalla suite standard. Le migrazioni sono state applicate esclusivamente a database temporanei; database applicativo e dati esistenti non sono stati modificati.

### Docker Compose per sviluppo locale (5 ottobre 2026)

- Tutte le porte pubblicate sono vincolate a `127.0.0.1`; database, SMTP e storage restano accessibili ai container tramite la rete Compose. Non vengono montati socket Docker e non viene usata la rete host.
- Il codice del computer è montato in sola lettura; dipendenze, asset, database, email e oggetti S3 restano in volumi dedicati. I container non sono privilegiati e usano `no-new-privileges`.
- Bun ignora gli header proxy (`TRUSTED_PROXY_IPS` vuoto) perché questo stack non contiene un reverse proxy. Autenticazione, autorizzazione e isolamento applicativi non cambiano; il seed con password note resta opzionale.
- Memoria e rotazione dei log sono limitate. Mailpit conserva al massimo 500 messaggi e accetta messaggi di massimo 10 MiB. I volumi PostgreSQL/MinIO e gli asset originali non hanno una quota disco: lo sviluppatore deve controllarne l’occupazione e usare solo dati di test.
- Le credenziali predefinite sono pubbliche e valide solo per sviluppo. SMTP e interfaccia Mailpit non richiedono autenticazione; email, token di conferma e link di reset catturati sono visibili agli utenti locali. HTTP locale non protegge il traffico e il cookie applicativo resta senza `Secure` con l’origine HTTP.
- `.env` non viene aggiunto al controllo versione. I segreti nei container restano leggibili da chi può accedere a Docker; evitare credenziali di produzione. Il bind mount include il repository: processi nel container Bun possono leggerne i file, ma non modificarli sul computer.
- Il bucket di test viene creato senza policy pubbliche. Le credenziali S3 locali sono quelle root di MinIO, quindi non rappresentano un modello di autorizzazione per produzione. Gli endpoint S3 sono fissi nella configurazione, non derivati da input HTTP.
- [MinIO Community è archiviato e non più mantenuto](https://github.com/minio/minio). L’immagine precedente è risultata inaccessibile al registry. Il Compose ora costruisce MinIO dalla [release ufficiale `RELEASE.2025-10-15T17-29-55Z`](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z), che include la correzione del bypass delle session policy, e `mc` da una release fissata. I moduli sono verificati dal checksum database Go; il contesto del build contiene solo il Dockerfile. Il runtime MinIO usa un utente senza privilegi root. Non viene garantita l’assenza di altre vulnerabilità né aggiornamenti futuri: usarlo solo con dati di test e porte loopback.
- Migrazioni e installazione dipendenze devono terminare correttamente prima dell’avvio. Non scalare il servizio Bun: il runner migration esistente non serializza l’applicazione concorrente di nuove migrazioni. Una modifica delle credenziali PostgreSQL non modifica automaticamente un volume già inizializzato.
- Regressioni in `docker-compose.test.ts`: 4 test superati per vincolo loopback, memoria e log limitati, assenza di container privilegiati/socket Docker, codice in sola lettura, proxy non fidati, limiti email e build MinIO senza segreti/con runtime non-root. Validazione statica tramite `docker compose --env-file .env.example config --quiet` e `git diff --check` superata. Dopo aver installato offline le dipendenze già nel lockfile, `bun run typecheck` è eseguibile e supera i controlli. Docker è accessibile fuori dal sandbox: build MinIO e avvio dell’intero Compose sono stati verificati in un progetto separato con dati temporanei. Bun ha installato il lockfile su mount readonly, applicato le migrazioni e servito la home (HTTP 200); una registrazione ha prodotto una email catturata da Mailpit.

### Gestione asset locale/S3 (5 ottobre 2026)

- Upload, lettura e cancellazione usano un adapter con il client S3 nativo di Bun. La migrazione `0006_asset_storage.sql` mantiene le righe precedenti sul backend locale e vincola `storage_backend` a `local`/`s3`. Le chiavi devono essere UUID: path, URL, bucket e prefissi ricevuti da utenti non possono modificare il percorso filesystem o la destinazione S3.
- Gli endpoint arrivano soltanto dall’ambiente del servizio; credenziali nell’URL, query, frammenti e protocolli diversi da HTTP/HTTPS vengono rifiutati. In produzione è richiesto HTTPS. DNS, proxy HTTP configurati dall’operatore e permessi di rete restano responsabilità del deployment; non vengono accettati endpoint dalle richieste API.
- La serializzazione pubblica non include backend, storage key, credenziali o endpoint. Gli errori storage vengono sostituiti con messaggi sicuri senza conservare `cause`; risposte e log non espongono XML, URL firmati o errori del provider. Le credenziali temporanee supportano `S3_SESSION_TOKEN` e non vengono persistite in PostgreSQL.
- Il bucket rimane privato: non vengono impostate ACL pubbliche e l’app serve gli oggetti. L’URL `/assets/:id` resta pubblico per scelta applicativa preesistente; questa feature non rende privati gli asset. Upload richiede autenticazione; metadata/lista rispettano il proprietario e DELETE mantiene le guard esistenti. In produzione usare un bucket dedicato e credenziali limitate alle operazioni necessarie.
- Gli upload rispettano `MAX_ASSET_BYTES` validato (default 25 MiB, massimo 100 MiB). I download S3 controllano HEAD e leggono uno stream limitato: superare la quota cancella la lettura, anche se il provider ignora Range o l’oggetto cambia durante il download. Le operazioni S3 hanno al massimo 4 trasferimenti attivi e 32 in attesa, poi restituiscono 429. Multipart ha parti da 5 MiB, coda 2 e 2 retry.
- Upload S3 e download originali S3 hanno rate limit PostgreSQL per IP prima del parsing multipart o del contatto con S3 (default 10 e 60 al minuto). IP e chiavi restano pseudonimizzati; 429 include `Retry-After`. Le trasformazioni usano il limite esistente, coalescono richieste concorrenti e caricano l’originale solo su cache miss e dopo il controllo del rate limit. Cache ed eviction restano locali.
- Un fallimento nell’INSERT provoca un tentativo di rimozione dell’oggetto appena scritto. DELETE rimuove lo storage prima della riga: se il provider fallisce, il record resta ritentabile. Non esiste una transazione distribuita tra PostgreSQL e S3: crash, fallimenti di cleanup o cancellazioni utenti con FK cascade possono lasciare oggetti orfani; un errore DB dopo la rimozione può lasciare metadata senza file. Servono riconciliazione operativa e lifecycle per multipart incompleti. Le cancellazioni concorrenti sono idempotenti nello storage; una trasformazione già in corso può lasciare una variante orfana, rimossa dalla manutenzione/eviction.
- Tutti gli asset S3 usano il bucket configurato; cambiare bucket richiede trasferire gli oggetti. Non viene eseguita migrazione automatica dei file locali. Il buffer di un originale S3 può occupare fino a `MAX_ASSET_BYTES`, oltre alle copie temporanee e alle risposte in uscita. I limiti per IP non sostituiscono quote per utente, budget del provider, limiti globali al reverse proxy e controllo dello spazio disco. Un provider irraggiungibile può trattenere slot fino al timeout nativo di rete; non viene applicato fallback che nasconda il guasto.
- Regressioni: client Bun reale contro HTTP S3 di test per firma, traversal, dimensioni, errori, ACL e coda; cache lazy e rate limit prima della lettura. Test opt-in contro PostgreSQL e MinIO reali per upload locale/S3, lettura dopo cambio backend, trasformazioni, proprietà tra utenti, bucket privato, rate limit e DELETE. I test richiedono un database usa e getta `bunsai_asset_tests` e directory asset temporanee.
- Esito finale: typecheck superato, 96 test standard superati e 4 test d’integrazione reali superati; le migrazioni sono state applicate solo ai database temporanei. La suite standard esclude i test d’integrazione. Non sono state modificate dipendenze Bun o lockfile.

Le modifiche sono coperte da test per composizione middleware, guard di ruolo, token di conferma email, selezione dell’attributo `Secure`, rate limit, proxy fidati, path traversal, trasformazioni e quote/eviction della cache. Prima del rilascio devono essere eseguiti almeno:

```bash
bun run migrate
bun run typecheck
bun run test
bun audit
```

Risultato della verifica locale: typecheck superato, 81 test paralleli superati, bundle frontend e metafile Markdown generati correttamente, nessun duplicato nel lockfile e nessun advisory rilevato da `bun audit` su 12 pacchetti. Le migration `0004_maintenance_indexes.sql` e `0005_rate_limits.sql` non sono state applicate automaticamente a un database.

### Gestore database PostgreSQL (5 ottobre 2026)

- Il codice di `bun-hex-battles` è stato usato come riferimento funzionale. Le query concatenate con input utente e l'assunzione di una colonna `id` sono sostituite da introspezione PostgreSQL, identificatori quotati/validati contro lo schema e valori parametrizzati. Schema sempre `public`; nessun endpoint esegue SQL arbitrario, DDL, connessioni esterne o accessi al filesystem.
- Il link è visibile solo agli admin attivi. Tutte le API verificano direttamente sessione non scaduta, ruolo corrente e `is_active`, prima di rate limit, parsing e introspezione. Un utente non admin non può leggere lo schema o accedere ai dati; un admin accede intenzionalmente a tutte le righe delle tabelle consentite. Revoca del ruolo e disattivazione hanno effetto sulla richiesta successiva. Le risposte, anche di errore, usano `Cache-Control: no-store`.
- Le scritture POST/PATCH/DELETE riusano la verifica Origin del setup: origine configurata, soli alias loopback in sviluppo, HTTPS e corrispondenza esatta in produzione; richieste cross-site, origini mancanti o nulle sono rifiutate. I payload JSON sono limitati a 8 KiB anche in streaming. I nomi di tabella e colonna devono esistere nel catalogo pubblico; ordinamento/direzione/operatori sono validati e i valori di ricerca non vengono inseriti nel testo SQL.
- Le operazioni su `users` consentono solo username validi; quelle su `assets` solo titolo. Questi aggiornamenti aggiornano `date_updated`. Password, ruolo, attivazione, email, proprietà dei file e backend storage restano affidati alle API dedicate. Tabelle di setup, migrazioni, sessioni, reset e rate limit sono in sola lettura: il pannello non può riaprire il setup, fabbricare sessioni o aggirare i limiti. Campi con nomi riconducibili a password/secret/token/credential/private_key/api_key/key_hash e ID di sessione non vengono selezionati, filtrati, ordinati o modificati; i loro default sono nascosti.
- Le chiavi primarie complete, anche composte, sono obbligatorie per modifica ed eliminazione. I valori della chiave non sono modificabili; `xmin` verifica la revisione letta dal browser. UPDATE/DELETE con revisione non corrispondente restituiscono 409 e la transazione viene annullata. Le viste sono in sola lettura; senza chiave primaria sono disponibili solo lettura/inserimento. Le eliminazioni hanno conferma esplicita nella UI; i vincoli PostgreSQL e i trigger continuano a essere applicati.
- Query e transazioni hanno timeout di 3 secondi e lock timeout di 1 secondo. Rate limit condivisi: 120 letture e 30 scritture per IP/minuto, dopo autorizzazione. Al massimo 4 operazioni simultanee per processo; elenchi e celle hanno limiti di quantità/lunghezza, senza COUNT completo o preload delle opzioni FK. La lunghezza di pagina viene ridotta sulle tabelle larghe. I valori troncati non sono modificabili dalla UI. Parametri numerici e date sono restituiti come testo, senza perdere precisione. JSON viene parametrizzato come testo con cast esplicito per evitare la doppia codifica del driver.
- PostgreSQL può includere dati della riga nei suoi errori: il pannello converte errori di vincoli, timeout e conflitti in messaggi generici, senza loggare messaggi originali, query, parametri o URL dei filtri. I dati sono resi come testo Preact, mai come HTML; stato condiviso in signals, richieste abortite al cambio pagina/sessione e dati azzerati al logout.
- Limiti di deployment: l'admin è un operatore privilegiato; modificare dati generici può attivare trigger o cascata definiti dallo schema. Le protezioni delle tabelle applicative sono esplicite e devono essere estese se il progetto aggiunge nuove tabelle di autenticazione o storage. Il riconoscimento dei segreti usa i nomi delle colonne: non identifica segreti inseriti dentro un campo generico o JSON, né sostituisce una classificazione dei dati del progetto. Vincoli CHECK/UNIQUE restano verificati da PostgreSQL; il pannello non modifica lo schema. `xmin` è un token operativo di concorrenza per modifiche immediate, non un identificatore persistente/a lungo termine; aggiornare la pagina prima di modificare dati rimasti aperti a lungo.
- Regressioni: utenti anonimi, non admin, inattivi e sessioni scadute; revoca del ruolo; CSRF; identificatori/filtri malevoli; segreti e campi protetti; body limit; chiavi composte; NULL/vuoto/default; JSON e bigint; aggiornamenti concorrenti e cancellazioni obsolete; vincoli, troncamento, timeout e rate limit. Verifica browser con database reale copre CRUD, struttura, contenuti XSS come testo, assenza del menu/API per non admin e layout da 320 a 1280 px. Nessuna nuova dipendenza.
- Esito: typecheck, build frontend e `git diff --check` superati; 109 test della suite generale superati (21 integrazioni opt-in escluse), più 8 test PostgreSQL reali superati. La suite generale è stata ripetuta con timeout di 30 secondi dopo un rallentamento dell'ambiente che aveva fatto scadere un test asset preesistente; quel test è passato anche separatamente. Database, server e browser temporanei sono stati rimossi, senza modificare i dati applicativi.
- Riferimenti tecnici: [API SQL e transazioni Bun](https://bun.sh/docs/runtime/sql) e [colonne di sistema PostgreSQL, incluso xmin](https://www.postgresql.org/docs/current/ddl-system-columns.html).

### Ritaglio della foto profilo (5 ottobre 2026)

- Le miniature profilo usano `fit=inside` e la visualizzazione circolare usa `object-fit: cover`: il server conserva le proporzioni delle foto rettangolari. Il caricamento apre un dialogo nativo con anteprima circolare, zoom, trascinamento anche touch, frecce da tastiera e annullamento; nessun asset viene caricato prima della conferma. Il salvataggio del profilo continua a usare l'API esistente con controllo di proprietà dell'asset.
- Il ritaglio è calcolato come un quadrato all'interno dell'immagine, senza stretching o letture fuori dai bordi. Il canvas esporta PNG 512×512; l'anteprima e il profilo mostrano il cerchio tramite maschera/CSS. L'immagine generata non mantiene EXIF/GPS o contenuti SVG. I file originali scelti dal dispositivo non vengono caricati separatamente. Se ritagli un asset esistente, l'originale viene conservato e il risultato è un nuovo asset soggetto allo storage locale/S3 e alle protezioni di upload esistenti.
- Input ammessi: JPEG, PNG, WebP, GIF e BMP, al massimo 20 MiB e 40 megapixel. MIME e firma raster vengono controllati prima dell'uso come immagine; dimensioni finite/positive e pixel totali vengono verificati dopo il caricamento nel decoder browser. Le protezioni client non sostituiscono quelle server: il raster esportato viene verificato nuovamente dalle API asset, con autenticazione, limiti e controllo di proprietà. La decodifica di immagini locali resta affidata al browser; la verifica delle dimensioni client avviene quando il browser rende disponibili le dimensioni intrinseche.
- Il ritaglio di asset esistenti usa un helper centralizzato: soltanto un UUID viene accettato, la URL è costruita internamente e la variante richiesta è limitata a 2048×2048 con proporzioni conservate. Download limitato a 20 MiB anche in streaming senza Content-Length; lettori cancellati e richieste abortite al cambio sessione/unmount. Gli object URL vengono revocati, senza una corsa con la lettura asincrona dell'header. Un upload concluso dopo il cambio utente non ripopola lo stato asset dell'altra sessione.
- I controlli sono disabilitati durante caricamento/salvataggio; annullare non cambia la foto selezionata. Il profilo viene aggiornato soltanto tramite “Salva profilo”; il ritaglio non modifica l'originale. I test coprono bordi/proporzioni di immagini landscape e portrait, pan/zoom estremi, dimensioni non valide, file troppo grandi/SVG/HTML camuffati, download oltre il limite, isolamento degli upload e thumbnail rettangolari. La verifica browser copre trascinamento, zoom, annullamento senza upload, loader, PNG 512×512, salvataggio, ritaglio di immagini esistenti e layout mobile. Nessuna dipendenza o migrazione aggiunta.
- Esito: 115 test standard superati, 21 integrazioni opt-in escluse, typecheck e build superati; verifica browser su API simulate senza modifiche ai dati applicativi.

### Gestione utenti, sessioni e inviti (5 ottobre 2026)

- Tutte le API `/api/admin/users*` e `/api/admin/invitations*` richiedono una sessione valida di un admin attualmente attivo. Le mutazioni riverificano il ruolo dentro la transazione; il gestore database riusa lo stesso controllo. Le sessioni degli account inattivi sono rifiutate anche dalle API esistenti. GET cross-site e mutazioni senza Origin valido sono respinti; JSON limitato a 8 KiB in streaming, campi extra rifiutati, UUID e paginazione validati. Risposte ed errori `no-store`, query parametrizzate, DTO con campi espliciti e dati UI escapati da Preact.
- Username 3–255, email normalizzata massimo 255, ruoli user/admin, stato booleano e password iniziale/invito 12–128. Hash Bun.password con massimo due operazioni amministrative concorrenti. Letture 120/min, scritture 30/min per IP; SMTP massimo 20/ora per IP e 3/ora per destinatario. Connessione/greeting SMTP limitati a 10 secondi, socket a 30 secondi. Le API pubbliche di ispezione e accettazione sono limitate a 30/min e 5/15 min per IP prima di validazione e hash.
- Advisory lock transazionale comune alle modifiche account e all'accettazione degli inviti, timeout query 3 secondi / lock 2 secondi, ruolo dell'actor riverificato e revisioni xmin per evitare aggiornamenti persi. Demozione/disattivazione del proprio admin vietate; controllo dell'ultimo admin attivo serializzato. L'endpoint storico di attivazione usa la stessa procedura. Anche il salvataggio del profilo acquisisce lo stesso lock, verifica account ancora attivo e identità corrente, conserva i token correnti per aggiornamenti ordinari e impedisce che il cambio email disattivi l'ultimo admin. Cambiare email/ruolo/stato elimina sessioni, reset e token API/conferma; aggiornare soltanto username conserva la conferma email. Il cambiamento dell'email da parte di un admin è un'operazione privilegiata e non richiede una seconda conferma.
- Le sessioni restituiscono `management_id` UUID casuali indipendenti dal cookie autenticante, senza token/session cookie in risposte o log. Revoche sono vincolate all'utente selezionato; revocare la sessione corrente cancella il cookie e lo stato client. IP deriva dalla configurazione proxy attendibile esistente; User-Agent senza controlli, massimo 255 caratteri. I campi identificano il client secondo le informazioni HTTP disponibili, non certificano identità o geolocalizzazione.
- Inviti: 256 bit casuali, solo hash SHA-256 in PostgreSQL, URL con token nel fragment rimosso subito dal browser, TTL 7 giorni, consumo atomico singolo, email/ruolo stabiliti dall'admin e mai accettati dal form pubblico. Inviter ancora attivo/admin controllato al consumo; nessun upgrade di utenti esistenti. Inviti pendenti unici per email; resend ruota il token e revoke lo elimina. Tabella inviti in sola lettura nel gestore database e hash nascosti. L'email prova il possesso tramite il link e l'account creato è attivo; le password non viaggiano nelle email.
- Reset admin: token hash, TTL un'ora, rotazione degli eventuali reset precedenti; email inviata con attesa e errore generico sicuro. Se SMTP fallisce si rimuove esclusivamente il reset appena creato o si revoca l'invito corrispondente. Invio email fuori dalla transazione: una modifica/revoca concorrente può rendere il link ricevuto inutilizzabile, senza ripristinare permessi o token. La consegna SMTP non equivale alla consegna finale alla casella; non c'è una coda di retry persistente. Resend resta disponibile manualmente entro i limiti.
- Rischi deployment: gli admin sono operatori fidati, autorizzati a leggere email/IP/sessioni e assegnare il ruolo admin. Usare HTTPS/Origin/cookie e proxy attendibili configurati correttamente; APP_URL deve essere raggiungibile dai destinatari. Mailpit e credenziali Compose sono soltanto per sviluppo. La cronologia inviti resta nel database (anche dopo scadenza/revoca) e richiede una politica di retention adeguata; la scadenza è verificata direttamente e non dipende dal cron. I limiti per IP non sostituiscono un controllo al proxy contro attacchi distribuiti. SMTP/backup/database sono servizi fidati che possono vedere i dati personali e i link inviati.
- Verifica: test unitari su whitelist/privilegi, limiti e token/escaping; integrazione reale su PostgreSQL temporaneo e Mailpit con sole email example.test: accessi anonimi/non admin/inattivi, CSRF, payload grandi, hash/DTO, sessioni opache e isolamento delle revoche, aggiornamenti concorrenti, revoca delle sessioni, conferma preservata, cambio ruolo, reset effettivo/riuso, invito SMTP/resend, consumo concorrente, scadenza/revoca/autorità dell'inviter, nessuna promozione tramite email esistente, limiti invio. Nessuna dipendenza applicativa aggiunta.

- Esito finale: 118 test standard e 17 test di integrazione PostgreSQL/Mailpit superati, typecheck superato; browser reale verificato per creazione, modifica, reset SMTP, invito SMTP e accettazione, oltre ai layout 320/375/768/1280 px, dettaglio e revoca delle sessioni nel browser e controlli admin nascosti agli utenti ordinari. I test di concorrenza verificano anche assenza di ripristino dei token/API key revocati da una richiesta profilo in attesa. Nessun dato applicativo modificato.
