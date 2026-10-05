import { sql } from "bun";
import { Args, Req, Route, Server } from "./decorators";
import { BadRequestError, ConflictError, NotAuthorizedError, ValidationError } from "./errors";
import { enforceRequestRateLimit } from "./rateLimit";

const MAX_SETUP_BODY_BYTES = 8192;

export function validateSetupInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Dati di configurazione non validi");
  const value = input as Record<string, unknown>;
  const username = typeof value.username === "string" ? value.username.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  if (username.length < 3 || username.length > 255 || /[\x00-\x1f\x7f]/.test(username)) throw new ValidationError("Lo username deve contenere da 3 a 255 caratteri");
  if (email.length > 255 || /[\x00-\x1f\x7f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Email non valida");
  if (password.length < 12 || password.length > 128) throw new ValidationError("La password deve contenere da 12 a 128 caratteri");
  return { username, email, password };
}

export function validateSetupOrigin(req: Request): void {
  const publicUrl = new URL(process.env.APP_URL?.trim() || `http://localhost:${Number(process.env.PORT) || 3000}`);
  const origin = req.headers.get("origin");
  let allowed = origin === publicUrl.origin;
  // Local development can use any explicit loopback alias, but never a host
  // supplied by Host/X-Forwarded-Host (which would allow DNS rebinding).
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!allowed && origin && process.env.NODE_ENV !== "production" && loopbackHosts.has(publicUrl.hostname)) {
    try {
      const candidate = new URL(origin);
      allowed = origin === candidate.origin && loopbackHosts.has(candidate.hostname)
        && candidate.protocol === publicUrl.protocol && candidate.port === publicUrl.port;
    } catch { /* Invalid Origin values fail closed. */ }
  }
  if (!["http:", "https:"].includes(publicUrl.protocol)
    || (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:")
    || !allowed || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new NotAuthorizedError("Origine della richiesta non consentita");
  }
}

export async function readSetupInput(req: Request): Promise<unknown> {
  if (req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new BadRequestError("La richiesta deve essere JSON");
  }
  if (Number(req.headers.get("content-length")) > MAX_SETUP_BODY_BYTES || !req.body) throw new BadRequestError("Richiesta di configurazione non valida");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SETUP_BODY_BYTES) throw new BadRequestError("Richiesta di configurazione troppo grande");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new BadRequestError("JSON non valido"); }
}

export async function setupRequired(): Promise<boolean> {
  const [row] = await sql`
    SELECT NOT completed AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin') AS required
    FROM app_setup WHERE singleton = true
  `;
  // A missing control row must fail closed.
  return row?.required === true;
}

function setupClosed(): ConflictError {
  return new ConflictError("La configurazione iniziale è già completata", { code: "SETUP_COMPLETED" });
}

let activeSetups = 0;

export async function createInitialAdmin(input: unknown): Promise<void> {
  const { username, email, password } = validateSetupInput(input);
  if (!await setupRequired()) throw setupClosed();
  if (activeSetups >= 2) throw new ConflictError("Configurazione già in corso, riprova tra poco", { code: "SETUP_BUSY" });
  activeSetups += 1;
  try {
    const passwordHash = await Bun.password.hash(password);
    await sql.begin(async (transaction) => {
      const [state] = await transaction`SELECT completed FROM app_setup WHERE singleton = true FOR UPDATE`;
      if (!state || state.completed) throw setupClosed();
      const admins = await transaction`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
      if (admins.length) throw setupClosed();
      const existing = await transaction`SELECT id FROM users WHERE username = ${username} OR LOWER(email) = ${email} LIMIT 1`;
      if (existing.length) throw new ConflictError("Username o email già in uso", { code: "SETUP_ACCOUNT_EXISTS" });
      await transaction`
        INSERT INTO users (id, username, email, password, role, is_active, activation_token)
        VALUES (${Bun.randomUUIDv7()}, ${username}, ${email}, ${passwordHash}, 'admin', true, NULL)
      `;
      await transaction`UPDATE app_setup SET completed = true WHERE singleton = true`;
    });
  } catch (error) {
    if ((error as { code?: string; errno?: string })?.code === "23505" || (error as { errno?: string })?.errno === "23505") {
      throw new ConflictError("Username o email già in uso", { code: "SETUP_ACCOUNT_EXISTS" });
    }
    throw error;
  } finally { activeSetups -= 1; }
}

export default class Setup {
  @Route("GET", "/api/setup")
  static async status() {
    return Response.json({ required: await setupRequired() }, { headers: { "Cache-Control": "no-store" } });
  }

  @Route("POST", "/api/setup")
  @Args(Req(), Server())
  static async create(req: Bun.BunRequest, server: Bun.Server<unknown>) {
    validateSetupOrigin(req);
    await enforceRequestRateLimit("initialSetup", req, server);
    if (!await setupRequired()) throw setupClosed();
    await createInitialAdmin(await readSetupInput(req));
    return Response.json({ created: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  }
}
