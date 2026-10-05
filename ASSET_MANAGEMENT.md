# Libreria asset

Il frontend di `/assets` è adattato da [AssetsPage di Fabulab CMS](https://github.com/Fabulab/fabulab-cms/blob/main/client/pages/AssetsPage.tsx), consultato tramite il plugin GitHub. Il sorgente usa MIT, copyright 2026 Sebastiano Morando, come il [LICENSE](LICENSE) di Bunsai. Layout e testi seguono il tema e le traduzioni italiano/inglese di Bunsai; stato condiviso con signals, componenti Preact e routing preact-iso.

## Funzioni

- Caricamento multiplo, selezione tramite file picker o drag & drop, fino a 20 file, con avanzamento per file. Il massimo per file viene fornito dal server (`MAX_ASSET_BYTES`, default 25 MiB).
- Un caricamento parzialmente fallito mantiene solo i file ancora da caricare: il retry non duplica quelli riusciti. I limiti S3 esistenti restano attivi (default 10 upload/minuto per IP, configurabili con `RATE_LIMIT_S3_ASSET_UPLOAD_MAX` e `RATE_LIMIT_S3_ASSET_UPLOAD_WINDOW_SECONDS`); per batch più grandi può essere necessario attendere prima di riprovare.
- Griglia ed elenco, ricerca letterale per titolo/nome, filtri immagini/video/audio/documenti/altri file, ordinamento per data/titolo/nome/dimensione, paginazione da 12/24/48/96 elementi.
- Selezione della pagina o di singoli file e cancellazione multipla con conferma. La cancellazione è sequenziale: un errore conserva in libreria gli elementi non eliminati.
- Pannello dettagli con anteprima, modifica di titolo/nome, MIME type, dimensioni, data, ID, apertura originale e copia del collegamento. Per immagini riconosciute dal server: copia di varianti miniatura/grande WebP generate e messe in cache alla prima richiesta.
- Il pannello usa un dialog nativo con focus confinato, chiusura da tastiera e pulsante esplicito. SVG e altri file non riconosciuti dal decoder immagini sono mostrati come icone, senza incorporare HTML/documenti caricati.

La libreria mostra soltanto i file del proprietario corrente. Rinominare modifica il nome visualizzato e quello suggerito al download, senza spostare file o oggetti S3. Le revisioni dei metadati impediscono di sovrascrivere una modifica concorrente: in caso di conflitto ricaricare la pagina. I link `/assets/:id` continuano ad avere la semantica pubblica già prevista da Bunsai: chi conosce il link può scaricare il file. La cancellazione può interrompere collegamenti o immagini profilo che utilizzano quell'asset.

## API e compatibilità

`GET /api/assets` restituisce `items`, `total`, `limit`, `offset`, `sortBy`, `sortDir`, `maxFileBytes`. Parametri: `q` (massimo 100 caratteri), `type`, `sortBy`, `sortDir`, `limit` (1–100) e `offset` (0–100000). Senza parametri il limite è 24; l'helper chiamato senza opzioni conserva 100 elementi per il selettore del profilo. Le API di libreria e metadati non espongono chiavi storage, bucket o credenziali.

`PATCH /api/assets/:id` richiede sessione attiva del proprietario, Origin consentita e JSON con `title` (stringa/null), `filename` e `version` restituita dal server. Titolo e nome sono limitati a 255 caratteri; percorsi, controlli, campi extra e modifiche storage vengono rifiutati. Payload fino a 8 KiB verificati anche in streaming. Identità, stato account e sessione sono ricontrollati nella transazione con timeout; il ruolo admin non consente modifiche dei metadati altrui attraverso questa API. Le autorizzazioni preesistenti della cancellazione, compreso il bypass admin, restano invariate.

Anche upload e cancellazione richiedono ora un'Origin valida secondo `APP_URL`. Eventuali client HTTP personalizzati devono inviare questa intestazione. Letture libreria: 120/minuto; modifiche metadati: 30/minuto, per IP e account. Le risposte di lista/modifica hanno `Cache-Control: no-store`. Non sono necessarie nuove migrazioni o dipendenze. Funziona con storage locale e S3 compatibile/MinIO tramite le API esistenti.

## Verifica

Test di validazione e isolamento delle risposte asincrone in `server/assetManagement.test.ts` e `client/assetApi.test.ts`. La suite esistente `server/assets.integration.test.ts` include paginazione, ricerca, metadati, concorrenza e CSRF oltre ai controlli local/S3. Richiede il database temporaneo `bunsai_asset_tests`, directory temporanee e un bucket MinIO dedicato: non usare database o bucket applicativi. I controlli di sicurezza sono descritti in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
