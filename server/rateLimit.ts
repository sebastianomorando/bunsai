import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { sql } from "bun";
import { RateLimitError } from "./errors";

const SECOND = 1_000;
function positiveEnv(name: string, fallback: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return fallback;
  return parsed;
}

export const RATE_LIMIT_POLICIES = {
  login: {
    scope: "auth.login",
    limit: positiveEnv("RATE_LIMIT_LOGIN_MAX", 10, 10_000),
    windowMs: positiveEnv("RATE_LIMIT_LOGIN_WINDOW_SECONDS", 15 * 60, 86_400) * SECOND,
  },
  register: {
    scope: "auth.register",
    limit: positiveEnv("RATE_LIMIT_REGISTER_MAX", 5, 10_000),
    windowMs: positiveEnv("RATE_LIMIT_REGISTER_WINDOW_SECONDS", 60 * 60, 86_400) * SECOND,
  },
  passwordResetRequest: {
    scope: "auth.password-reset-request",
    limit: positiveEnv("RATE_LIMIT_PASSWORD_RESET_REQUEST_MAX", 5, 10_000),
    windowMs: positiveEnv("RATE_LIMIT_PASSWORD_RESET_REQUEST_WINDOW_SECONDS", 60 * 60, 86_400) * SECOND,
  },
  passwordReset: {
    scope: "auth.password-reset",
    limit: positiveEnv("RATE_LIMIT_PASSWORD_RESET_MAX", 10, 10_000),
    windowMs: positiveEnv("RATE_LIMIT_PASSWORD_RESET_WINDOW_SECONDS", 60 * 60, 86_400) * SECOND,
  },
  emailConfirmation: {
    scope: "auth.email-confirmation",
    limit: positiveEnv("RATE_LIMIT_EMAIL_CONFIRMATION_MAX", 10, 10_000),
    windowMs: positiveEnv("RATE_LIMIT_EMAIL_CONFIRMATION_WINDOW_SECONDS", 60 * 60, 86_400) * SECOND,
  },
  imageTransform: {
    scope: "assets.transform",
    limit: positiveEnv("RATE_LIMIT_IMAGE_TRANSFORM_MAX", 30, 100_000),
    windowMs: positiveEnv("RATE_LIMIT_IMAGE_TRANSFORM_WINDOW_SECONDS", 60, 86_400) * SECOND,
  },
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitRecord = {
  count: number;
  windowStartedAt: Date;
  expiresAt: Date;
};

export type RateLimitStore = (input: {
  scope: string;
  keyHash: string;
  maxCount: number;
  now: Date;
  resetBefore: Date;
  expiresAt: Date;
}) => Promise<RateLimitRecord>;

function rateLimitSecret(): string {
  const configured = process.env.RATE_LIMIT_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("RATE_LIMIT_SECRET deve contenere almeno 32 caratteri in produzione");
  }
  return "bunsai-development-rate-limit-secret";
}

export function validateRateLimitConfiguration(): void {
  void rateLimitSecret();
}

const postgresRateLimitStore: RateLimitStore = async ({
  scope,
  keyHash,
  maxCount,
  now,
  resetBefore,
  expiresAt,
}) => {
  const rows = await sql`
    INSERT INTO rate_limits (scope, key_hash, window_started_at, request_count, expires_at)
    VALUES (${scope}, ${keyHash}, ${now}, 1, ${expiresAt})
    ON CONFLICT (scope, key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN rate_limits.window_started_at <= ${resetBefore} THEN ${now}
        ELSE rate_limits.window_started_at
      END,
      request_count = CASE
        WHEN rate_limits.window_started_at <= ${resetBefore} THEN 1
        ELSE LEAST(rate_limits.request_count + 1, ${maxCount})
      END,
      expires_at = CASE
        WHEN rate_limits.window_started_at <= ${resetBefore} THEN ${expiresAt}
        ELSE rate_limits.expires_at
      END
    RETURNING request_count, window_started_at, expires_at
  `;
  const row = rows[0] as {
    request_count: number | string;
    window_started_at: Date | string;
    expires_at: Date | string;
  };
  return {
    count: Number(row.request_count),
    windowStartedAt: new Date(row.window_started_at),
    expiresAt: new Date(row.expires_at),
  };
};

export function rateLimitKeyHash(scope: string, key: string): string {
  return createHmac("sha256", rateLimitSecret())
    .update(scope)
    .update("\0")
    .update(key)
    .digest("hex");
}

function normalizedIp(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^\[|\]$/g, "");
  const withoutMappedPrefix = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  return isIP(withoutMappedPrefix) ? withoutMappedPrefix : null;
}

function trustedProxyAddresses(): Set<string> {
  const configured = process.env.TRUSTED_PROXY_IPS ?? "127.0.0.1,::1";
  return new Set(
    configured
      .split(",")
      .map((value) => normalizedIp(value))
      .filter((value): value is string => value !== null)
  );
}

export function requestClientAddress(
  req: Bun.BunRequest,
  server: Bun.Server<unknown>
): string {
  const peer = normalizedIp(server.requestIP?.(req)?.address) ?? "unknown";
  if (!trustedProxyAddresses().has(peer)) return peer;

  const forwarded = req.headers.get("x-forwarded-for")?.split(",") ?? [];
  if (forwarded.length !== 1) return peer;
  return normalizedIp(forwarded[0]) ?? peer;
}

export async function enforceRateLimit(
  policyName: RateLimitPolicyName,
  discriminator: "ip" | "key",
  key: string,
  options: { now?: Date; store?: RateLimitStore } = {}
): Promise<void> {
  const policy = RATE_LIMIT_POLICIES[policyName];
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + policy.windowMs);
  const scope = `${policy.scope}.${discriminator}`;
  const record = await (options.store ?? postgresRateLimitStore)({
    scope,
    keyHash: rateLimitKeyHash(scope, key),
    maxCount: policy.limit + 1,
    now,
    resetBefore: new Date(now.getTime() - policy.windowMs),
    expiresAt,
  });

  if (record.count <= policy.limit) return;

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((record.expiresAt.getTime() - now.getTime()) / SECOND)
  );
  throw new RateLimitError("Troppe richieste, riprova più tardi", {
    details: { retryAfterSeconds },
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

export async function enforceRequestRateLimit(
  policyName: RateLimitPolicyName,
  req: Bun.BunRequest,
  server: Bun.Server<unknown>,
  secondaryKey?: string
): Promise<void> {
  await enforceRateLimit(policyName, "ip", requestClientAddress(req, server));
  const normalizedKey = secondaryKey?.trim().toLowerCase();
  if (normalizedKey) {
    await enforceRateLimit(policyName, "key", normalizedKey);
  }
}
