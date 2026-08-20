import { afterEach, describe, expect, it } from "bun:test";
import { errorToResponse, RateLimitError } from "./errors";
import {
  enforceRateLimit,
  rateLimitKeyHash,
  requestClientAddress,
  type RateLimitStore,
} from "./rateLimit";

const originalTrustedProxies = process.env.TRUSTED_PROXY_IPS;
const originalNodeEnv = process.env.NODE_ENV;
const originalRateLimitSecret = process.env.RATE_LIMIT_SECRET;

afterEach(() => {
  if (originalTrustedProxies === undefined) delete process.env.TRUSTED_PROXY_IPS;
  else process.env.TRUSTED_PROXY_IPS = originalTrustedProxies;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalRateLimitSecret === undefined) delete process.env.RATE_LIMIT_SECRET;
  else process.env.RATE_LIMIT_SECRET = originalRateLimitSecret;
});

describe("rate limit", () => {
  it("richiede un segreto dedicato in produzione", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.RATE_LIMIT_SECRET;
    const module = await import("./rateLimit");
    expect(() => module.validateRateLimitConfiguration()).toThrow("almeno 32 caratteri");
  });

  it("conserva soltanto un digest HMAC separato per scope", () => {
    const email = "person@example.com";
    const digest = rateLimitKeyHash("auth.login", email);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(email);
    expect(digest).not.toBe(rateLimitKeyHash("auth.register", email));
    expect(rateLimitKeyHash("auth.login.ip", email)).not.toBe(rateLimitKeyHash("auth.login.key", email));
  });

  it("calcola una finestra fissa e consente richieste entro il limite", async () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    let received: Parameters<RateLimitStore>[0] | undefined;
    await enforceRateLimit("login", "ip", "203.0.113.10", {
      now,
      store: async (input) => {
        received = input;
        return { count: 1, windowStartedAt: now, expiresAt: input.expiresAt };
      },
    });

    expect(received?.scope).toBe("auth.login.ip");
    expect(received?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(received?.maxCount).toBeGreaterThan(1);
    expect(received?.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    expect(received?.resetBefore.getTime()).toBeLessThan(now.getTime());
  });

  it("restituisce 429 e Retry-After quando la soglia è superata", async () => {
    const now = new Date("2026-08-21T10:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 30_000);
    let caught: unknown;
    try {
      await enforceRateLimit("register", "ip", "203.0.113.10", {
        now,
        store: async () => ({ count: Number.MAX_SAFE_INTEGER, windowStartedAt: now, expiresAt }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RateLimitError);
    const response = errorToResponse(caught);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({
      error: "Troppe richieste, riprova più tardi",
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: 30 },
    });
  });

  it("accetta X-Forwarded-For soltanto da un proxy esplicitamente fidato", () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
    const req = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "198.51.100.20" },
    }) as Bun.BunRequest;

    const trustedServer = {
      requestIP: () => ({ address: "127.0.0.1" }),
    } as unknown as Bun.Server<unknown>;
    const untrustedServer = {
      requestIP: () => ({ address: "203.0.113.8" }),
    } as unknown as Bun.Server<unknown>;

    expect(requestClientAddress(req, trustedServer)).toBe("198.51.100.20");
    expect(requestClientAddress(req, untrustedServer)).toBe("203.0.113.8");
  });

  it("rifiuta catene X-Forwarded-For non normalizzate", () => {
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
    const req = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "198.51.100.20, 203.0.113.8" },
    }) as Bun.BunRequest;
    const server = {
      requestIP: () => ({ address: "127.0.0.1" }),
    } as unknown as Bun.Server<unknown>;

    expect(requestClientAddress(req, server)).toBe("127.0.0.1");
  });
});
