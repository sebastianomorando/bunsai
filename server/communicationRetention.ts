export function communicationRetentionCutoff(
  kind: "notifications" | "chat" | "campaigns",
  now: Date,
): Date {
  const name =
    kind === "chat" ? "CHAT_RETENTION_DAYS" : "NOTIFICATION_RETENTION_DAYS";
  const raw = process.env[name];
  const days = raw === undefined ? (kind === "chat" ? 730 : 365) : Number(raw);
  if (!Number.isSafeInteger(days) || days < 30 || days > 3650)
    throw new TypeError(`${name} must be 30–3650 days`);
  return new Date(now.getTime() - days * 86400000);
}
