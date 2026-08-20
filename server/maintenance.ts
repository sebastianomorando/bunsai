import { sql } from "bun";
import { evictAssetCache } from "./assets";

export const MAINTENANCE_JOB_TITLE = "bunsai-maintenance";
export const DEFAULT_MAINTENANCE_SCHEDULE = "@hourly";

export type CleanupTarget = "sessions" | "passwordResets" | "activationTokens" | "rateLimits";

export type MaintenanceResult = Record<CleanupTarget, number> & {
  assetCacheFiles: number;
  assetCacheBytes: number;
};

export type CleanupExecutor = (
  target: CleanupTarget,
  expiredBefore: Date
) => Promise<number>;

export function validateMaintenanceSchedule(value: string): string {
  if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9*,/@ -]+$/.test(value)) {
    throw new TypeError("Schedule di manutenzione non valida");
  }
  try {
    Bun.cron.parse(value);
  } catch {
    throw new TypeError("Schedule di manutenzione non valida");
  }
  return value;
}

const cleanupWithPostgres: CleanupExecutor = async (target, expiredBefore) => {
  switch (target) {
    case "sessions": {
      const rows = await sql`
        DELETE FROM sessions
        WHERE expires_at <= ${expiredBefore}
        RETURNING id
      `;
      return rows.length;
    }
    case "passwordResets": {
      const rows = await sql`
        DELETE FROM password_resets
        WHERE expires_at <= ${expiredBefore}
        RETURNING id
      `;
      return rows.length;
    }
    case "activationTokens": {
      const rows = await sql`
        UPDATE users
        SET activation_token = NULL, activation_token_expires_at = NULL
        WHERE activation_token_expires_at <= ${expiredBefore}
        RETURNING id
      `;
      return rows.length;
    }
    case "rateLimits": {
      const rows = await sql`
        DELETE FROM rate_limits
        WHERE expires_at <= ${expiredBefore}
        RETURNING scope
      `;
      return rows.length;
    }
  }
};

/**
 * Remove expired authentication records using a single cutoff timestamp.
 * Operations are idempotent, so a partially completed run can be retried safely.
 */
export async function runMaintenance(
  expiredBefore = new Date(),
  execute: CleanupExecutor = cleanupWithPostgres,
  evictCache: typeof evictAssetCache = evictAssetCache
): Promise<MaintenanceResult> {
  const result: MaintenanceResult = {
    sessions: 0,
    passwordResets: 0,
    activationTokens: 0,
    rateLimits: 0,
    assetCacheFiles: 0,
    assetCacheBytes: 0,
  };

  const targets: CleanupTarget[] = ["sessions", "passwordResets", "activationTokens", "rateLimits"];
  for (const target of targets) {
    result[target] = await execute(target, expiredBefore);
  }

  const cacheResult = await evictCache({ respectGracePeriod: false });
  result.assetCacheFiles = cacheResult.filesRemoved;
  result.assetCacheBytes = cacheResult.bytesRemoved;

  return result;
}

export function maintenanceSummary(result: MaintenanceResult): string {
  return [
    `sessioni=${result.sessions}`,
    `reset_password=${result.passwordResets}`,
    `token_attivazione=${result.activationTokens}`,
    `rate_limit=${result.rateLimits}`,
    `file_cache=${result.assetCacheFiles}`,
    `byte_cache=${result.assetCacheBytes}`,
  ].join(" ");
}

export default {
  async scheduled(_controller: Bun.CronController): Promise<void> {
    try {
      const result = await runMaintenance();
      console.log(`Manutenzione completata: ${maintenanceSummary(result)}`);
    } catch {
      throw new Error("Manutenzione fallita");
    }
  },
};
