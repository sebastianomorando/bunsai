# Notifiche, toast, chat e comunicazioni admin

Il modulo riprende i flussi di [Fabulab CMS](https://github.com/Fabulab/fabulab-cms/blob/5ac6935905c1474a5e15e57ec877f5ffd06bc9b6/COMMUNICATIONS.md), consultati tramite il plugin GitHub: notifiche persistenti, toast con signals, chat e aggiornamenti WebSocket con fallback HTTP. L'implementazione è adattata a Bunsai, PostgreSQL, Preact e preact-iso. Non include chat pubbliche, visitatori o conversazioni legate ai progetti. Il progetto sorgente usa la licenza MIT, copyright 2026 Sebastiano Morando, come il [LICENSE](LICENSE) di questo repository.

## Uso

- La campanella mostra notifiche paginate, contatore delle non lette, lettura individuale/globale, rimozione e collegamenti interni opzionali. I nuovi avvisi ricevuti mentre l'app è aperta compaiono anche come toast.
- I messaggi di successo, errore e informazione dell'app usano toast accessibili e chiudibili. Errori e avvisi critici restano fino alla chiusura; gli altri scompaiono automaticamente. La coda mostra al massimo otto toast e accorpa duplicati identici.
- **Chat** (`/chat`) permette conversazioni dirette o di gruppo tra utenti attivi iscritti, fino a 20 partecipanti. Include storico paginato, conteggio non letti, stato aperta/chiusa e aggiornamenti automatici. I messaggi sono testo semplice. Solo i partecipanti possono accedere: il ruolo admin non conferisce accesso alle chat altrui.
- **Comunicazioni** (`/communications`), riservato agli amministratori attivi, permette notifiche, email o entrambe. Destinatari: tutti gli utenti attivi, uno o più utenti selezionati, oppure un gruppo salvato. Sono disponibili titolo, testo, gravità e collegamento interno della notifica.
- Prima dell'invio viene mostrato un riepilogo con il numero di destinatari idonei. Il backend rivaluta i destinatari nella transazione di creazione: cambiamenti intervenuti dopo l'anteprima possono cambiare il numero finale. La cronologia mostra il risultato effettivo, gli stati email e il dettaglio delle consegne.
- I gruppi di destinatari hanno nome e membri modificabili. Gli utenti inattivi possono restare nel gruppo, ma vengono esclusi dagli invii. Modifiche concorrenti richiedono di ricaricare il gruppo.

## Avvio e configurazione

Applicare `migrations/0009_communications.sql` con `bun run migrate`. Docker Compose applica le migrazioni all'avvio del servizio Bun: `docker compose restart bun`.

Le email usano la configurazione `MAIL_*` esistente. `APP_URL` deve corrispondere all'origine pubblica dell'app, con HTTPS in produzione; il proxy deve supportare l'upgrade WebSocket per gli aggiornamenti immediati. In Compose le email di sviluppo sono visibili in Mailpit su `http://127.0.0.1:8025`.

Il worker email parte con `bun run start` / `bun run dev` e controlla la coda ogni secondo, elaborando al massimo due consegne contemporaneamente per processo. Se si importa l'app in un server personalizzato, avviare anche `startCommunicationMailWorker()` da `server/communicationMail.ts`.

I WebSocket pubblicano soltanto segnali di aggiornamento, senza contenuti privati. Il client recupera i dati attraverso le API autenticate e controlla gli aggiornamenti ogni 15 secondi quando la pagina è visibile. Il server Bun singolo usato da Compose fornisce il realtime immediato; con più istanze i segnali non sono condivisi e il polling sincronizza gli altri client. I cursori dei messaggi usano UUIDv7 generati dall'app: mantenere gli orologi sincronizzati se si introducono più istanze.

## Consegne email

Le consegne sono persistenti in PostgreSQL e ogni email è inviata a un solo indirizzo. Il testo viene convertito in HTML con escaping; non è possibile inserire HTML arbitrario. L'indirizzo viene fissato alla creazione e ricontrollato prima dell'invio: account inattivi, eliminati o con email cambiata annullano la consegna.

Gli errori SMTP sono mostrati con codici generici. Un'elaborazione rimasta sospesa per oltre cinque minuti diventa `DELIVERY_UNCERTAIN`: potrebbe essere stata consegnata prima dell'interruzione. Non esiste un reinvio automatico. L'admin può richiedere esplicitamente un nuovo tentativo delle consegne fallite, fino a tre tentativi totali, oppure annullare quelle ancora in attesa. Una consegna già in corso non può essere richiamata. L'accettazione da parte del server SMTP non certifica la ricezione nella casella finale.

I client ID rendono idempotenti messaggi chat e campagne: una ripetizione identica non crea duplicati, mentre riutilizzare lo stesso ID con un contenuto differente restituisce un conflitto.

## Limiti e conservazione

Titoli fino a 200 caratteri, testi fino a 4000, richieste JSON fino a 32 KiB. Selezioni e gruppi salvati fino a 500 utenti; broadcast fino a 5000 utenti attivi; coda globale fino a 10000 consegne in attesa/in corso. Liste da 30 elementi, storico chat da 50 messaggi.

Limiti condivisi PostgreSQL per IP e account: 240 letture/minuto, 60 modifiche/minuto, 30 connessioni realtime/minuto, 20 nuove chat/ora, 30 messaggi/minuto e 6 richieste di invio/retry campagne/ora. Il limite aggiuntivo chat è 1000 messaggi/giorno per account. Anche i tentativi non validi e le ripetizioni consumano il limite pertinente. WebSocket: massimo 500 connessioni per processo e cinque per utente.

`bun run maintenance` elimina notifiche e campagne vecchie di `NOTIFICATION_RETENTION_DAYS` (default 365) e messaggi di `CHAT_RETENTION_DAYS` (default 730), con un massimo di 10000 record per categoria a ogni esecuzione. Entrambe le variabili accettano da 30 a 3650 giorni. Campagne con consegne ancora pendenti/in corso sono conservate; conversazioni vuote e inattive oltre il periodo vengono eliminate. Programmare la manutenzione con `bun run maintenance:install`; la sola configurazione delle variabili non esegue la pulizia.

Le tabelle delle comunicazioni sono escluse dalla console database generica, anche per gli admin, per preservare l'isolamento delle conversazioni e impedire modifiche fuori dalle API dedicate. Gli operatori con accesso diretto a PostgreSQL e ai backup restano amministratori dell'infrastruttura.

## Verifica

I test unitari e di sicurezza fanno parte di `bun test`. La suite di integrazione richiede PostgreSQL con un database **temporaneo** chiamato esattamente `bunsai_communication_tests`, tutte le migrazioni e Mailpit locale (SMTP `127.0.0.1:1025`, API `127.0.0.1:8025`):

```sh
COMMUNICATION_INTEGRATION=1 DATABASE_URL=postgres://…/bunsai_communication_tests bun test server/communications.integration.test.ts --timeout 30000
```

La suite svuota gli utenti e i contatori del database temporaneo: non utilizzare il database applicativo. Le email dei fixture usano esclusivamente indirizzi `example.test`. I rischi e i controlli di sicurezza sono documentati in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
