# AGENTS.md

Istruzioni operative per coding agents su questo repository.

## Frontend stack obbligatorio

Per tutto il codice frontend usare queste tecnologie:

- `preact` per componenti UI
- `@preact/signals` per stato condiviso/reactive state
- `preact-iso` per routing client-side

## Regole pratiche frontend

- Non introdurre altri router o state manager (es. React Router, Zustand, Redux).
- Le nuove pagine devono essere collegate al router di `preact-iso`.
- Lo stato applicativo globale deve vivere in signals (`signal`, `computed` quando serve).
- Le chiamate API devono passare da helper centralizzati e gestire errori utente.

## Verifica di sicurezza obbligatoria

Dopo l’aggiunta o la modifica di una feature, prima di considerare il lavoro completato, eseguire sempre una verifica di sicurezza proporzionata alla superficie interessata.

Controllare almeno:

- autenticazione, autorizzazione e isolamento dei dati tra utenti;
- validazione e limiti degli input, serializzazione degli output e assenza di dati sensibili nelle risposte o nei log;
- gestione di sessioni, cookie, token, password e segreti;
- possibili SQL injection, XSS, CSRF, path traversal, SSRF e abusi di filesystem o rete quando pertinenti;
- possibilità di brute force, consumo incontrollato di CPU, memoria, storage o servizi esterni;
- comportamento sicuro degli errori e dei casi concorrenti;
- nuove dipendenze o aggiornamenti, eseguendo `bun audit` quando cambiano `package.json` o `bun.lock`.

Aggiungere test di regressione per i controlli di sicurezza introdotti. Se rimangono rischi noti o dipendenti dal deployment, documentarli esplicitamente in `SECURITY_AUDIT.md` o nella documentazione pertinente.
