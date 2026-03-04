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
