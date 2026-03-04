# Decorators

Sistema di decorators per esporre metodi di classe come route HTTP senza cambiare la signature dei metodi.

## File chiave

- `server/decorators.ts`
- `server/errors.ts`
- `server/decorators.test.ts`

## Decorator disponibili

### `@Route(method, path)`

Registra una route HTTP per un metodo.

```ts
@Route("GET", "/api/users/:id")
static async getById(id: string) { ... }
```

### `@Use(...middlewares)`

Aggiunge middleware Bun/Bundana a livello route.

```ts
@Use(authMiddleware)
@Route("GET", "/api/private")
static private() { ... }
```

### `@Args(...binders)`

Mappa i parametri del metodo da `req/server`, senza cambiare la firma del metodo.

```ts
@Route("POST", "/api/login")
@Args(Body(), Req())
static async login(input: LoginInput, req: Bun.BunRequest) { ... }
```

### `@Serialize(serializer)`

Trasforma il payload prima della conversione in `Response`, utile per rimuovere campi sensibili.

```ts
@Route("GET", "/api/me")
@Serialize((user) => ({ id: user.id, username: user.username }))
static me() { ... }
```

### `@Guard(...guards)`

Decorator base per guardie custom.

```ts
@Guard(async (req) => { /* check custom */ })
```

### `@RequireAuth()`

Richiede sessione valida (`401` se assente).  
La sessione viene letta da `req.session` se presente, altrimenti da cookie (`Session.getFromRequest`).

### `@RequireOwner(...)`

Richiede che l’utente autenticato sia il proprietario della risorsa (`403` se mismatch).
Per default gli utenti con `role = "admin"` bypassano il controllo owner.

Forme supportate:

```ts
@RequireOwner("id") // prende req.params.id

@RequireOwner({ query: "userId" })

@RequireOwner({ bodyField: "userId" })

@RequireOwner({ bypassRoles: ["admin"] }) // default

@RequireOwner({
  resolve: async (req) => {
    // logica custom per risolvere ownerId
    return "...";
  }
})
```

## Binder disponibili (`@Args`)

- `Param(name)` -> `req.params[name]`
- `Query(name)` -> querystring (`new URL(req.url)`)
- `Body()` -> JSON body completo (con cache)
- `BodyField(name)` -> campo del JSON body
- `Req()` -> richiesta originale
- `Server()` -> server Bun

## Registrazione route

### `registerClassRoutes(app, Klass, basePath?)`

Legge metadata dei decorator su `Klass` e registra tutte le route.

```ts
registerClassRoutes(app, User);
```

### `registerMethodRoutes(app, Klass, bindings, basePath?)`

Alternativa senza decorator nella classe: binding esplicito esterno.
Supporta anche `serializer` e `guards` nel binding.

```ts
registerMethodRoutes(app, UserService, [
  {
    method: "GET",
    path: "/users/:id",
    call: "getById",
    args: [Param("id")],
    serializer: (u) => ({ id: u.id, username: u.username }),
  },
]);
```

## Ordine decorator

`@Use`, `@Args`, `@Guard`, `@Route` sono order-safe: puoi metterli sopra o sotto `@Route`.

## Error handling integrato

I metodi decorati vengono eseguiti in `try/catch`:

- `HttpError` custom -> status coerente (vedi `server/ERRORS.md`)
- `SyntaxError` parsing JSON -> `400`
- altri errori -> `500`

## Privacy by default

Quando un metodo ritorna entity/model completi, usa `@Serialize` per esporre solo i campi necessari.

## Esempio completo

```ts
class User {
  @Route("GET", "/api/users/:id")
  @RequireAuth()
  @RequireOwner("id")
  @Args(Param("id"))
  static async getById(id: string) {
    return await UserRepository.getById(id);
  }
}
```
