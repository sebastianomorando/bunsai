import { describe, expect, it } from "bun:test";
import {
  DEFAULT_MAINTENANCE_SCHEDULE,
  maintenanceSummary,
  runMaintenance,
  validateMaintenanceSchedule,
  type CleanupTarget,
} from "./maintenance";

describe("maintenance", () => {
  it("pulisce autenticazione e comunicazioni usando lo stesso riferimento temporale", async () => {
    const cutoff = new Date("2026-08-20T10:00:00.000Z");
    const calls: Array<{ target: CleanupTarget; cutoff: Date }> = [];
    const counts: Record<CleanupTarget, number> = {
      sessions: 3,
      passwordResets: 2,
      activationTokens: 1,
      rateLimits: 4,
      notifications: 5,
      chatMessages: 6,
      campaigns: 7,
    };

    const result = await runMaintenance(
      cutoff,
      async (target, expiredBefore) => {
        calls.push({ target, cutoff: expiredBefore });
        return counts[target];
      },
      async () => ({
        filesRemoved: 2,
        bytesRemoved: 1024,
        bytesRemaining: 2048,
        quotaSatisfied: true,
      }),
    );

    expect(result).toEqual({
      ...counts,
      assetCacheFiles: 2,
      assetCacheBytes: 1024,
    });
    expect(calls.map(({ target }) => target)).toEqual([
      "sessions",
      "passwordResets",
      "activationTokens",
      "rateLimits",
      "notifications",
      "chatMessages",
      "campaigns",
    ]);
    expect(calls.every(({ cutoff: received }) => received === cutoff)).toBe(
      true,
    );
  });

  it("propaga gli errori per permettere al runner di segnalarli", async () => {
    const failure = new Error("database non disponibile");
    expect(
      runMaintenance(
        new Date(),
        async () => {
          throw failure;
        },
        async () => ({
          filesRemoved: 0,
          bytesRemoved: 0,
          bytesRemaining: 0,
          quotaSatisfied: true,
        }),
      ),
    ).rejects.toBe(failure);
  });

  it("espone una schedule valida e un riepilogo senza dati sensibili", () => {
    expect(validateMaintenanceSchedule(DEFAULT_MAINTENANCE_SCHEDULE)).toBe(
      "@hourly",
    );
    expect(() => validateMaintenanceSchedule("@hourly\ncomando")).toThrow();
    expect(() => validateMaintenanceSchedule("x".repeat(129))).toThrow();
    expect(
      maintenanceSummary({
        sessions: 3,
        passwordResets: 2,
        activationTokens: 1,
        rateLimits: 4,
        notifications: 5,
        chatMessages: 6,
        campaigns: 7,
        assetCacheFiles: 2,
        assetCacheBytes: 1024,
      }),
    ).toBe(
      "sessioni=3 reset_password=2 token_attivazione=1 rate_limit=4 notifiche=5 messaggi_chat=6 campagne=7 file_cache=2 byte_cache=1024",
    );
  });
});
