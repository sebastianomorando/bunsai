# Error Handling HTTP

Questo progetto usa errori applicativi tipizzati per trasformare automaticamente i `throw` in risposte HTTP coerenti.

## File coinvolti

- `server/errors.ts`: definizione classi errore + funzione `errorToResponse`.
- `server/decorators.ts`: intercetta gli errori lanciati dai metodi decorati e applica il mapping HTTP.
- `entities/User.ts`: usa gli errori tipizzati invece di `Error` generico.

## Errori disponibili

Tutti estendono `HttpError`.

| Classe | Status | Code |
| --- | --- | --- |
| `BadRequestError` | 400 | `BAD_REQUEST` |
| `NotAuthenticatedError` | 401 | `NOT_AUTHENTICATED` |
| `NotAuthorizedError` | 403 | `NOT_AUTHORIZED` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |
| `RateLimitError` | 429 | `RATE_LIMITED` |

## Mapping automatico

Se un metodo decorato lancia:

- `HttpError`: risposta JSON con lo `status` specifico.
- `SyntaxError` (tipicamente body JSON invalido): `400 BAD_REQUEST`.
- Qualsiasi altro errore: `500 INTERNAL_SERVER_ERROR`.

Formato risposta:

```json
{
  "error": "messaggio",
  "code": "ERROR_CODE",
  "details": {}
}
```

`details` è opzionale.

## Esempi rapidi

```ts
import { NotFoundError, NotAuthorizedError } from "../server/errors";

if (!user) {
  throw new NotFoundError("Utente non trovato");
}

if (!canAccessResource) {
  throw new NotAuthorizedError("Accesso negato");
}
```

## Convenzioni consigliate

- Usa `NotAuthenticatedError` quando manca login/sessione valida (`401`).
- Usa `NotAuthorizedError` quando l'utente è autenticato ma non ha permesso (`403`).
- Usa `NotFoundError` per risorse inesistenti (`404`).
- Usa `ConflictError` per vincoli univoci/stato incompatibile (`409`).
- Evita `throw new Error(...)` nei metodi esposti via route, salvo errori tecnici non gestibili.
