import { BadRequestError, ValidationError } from "./errors";
import { requireUuid } from "./adminAuth";
export type Fields = Record<string, unknown>;
export function fields(value: unknown, allowed: string[]): Fields {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new ValidationError("Dati non validi");
  return value as Fields;
}
export function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string") throw new ValidationError("Testo non valido");
  const body = value.trim();
  if (
    body.length < min ||
    body.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body)
  )
    throw new ValidationError("Testo non valido");
  return body;
}
export function userIds(value: unknown, max = 500): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    throw new ValidationError("Destinatari non validi");
  return [...new Set(value.map(requireUuid))];
}
export const uuidArray = (values: string[]) =>
  `{${values.map(requireUuid).join(",")}}`;
export function safeActionUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 1000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\s\x00-\x1f\x7f]/.test(value)
  )
    throw new ValidationError("Destinazione non valida");
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.origin !== "https://internal.invalid") throw new Error();
    const decoded = decodeURIComponent(url.pathname);
    if (/[\\\x00-\x1f\x7f]/.test(decoded) || decoded.startsWith("//"))
      throw new Error();
  } catch {
    throw new ValidationError("Destinazione non valida");
  }
  return value;
}
export function audienceInput(value: unknown) {
  const data = fields(value, ["mode", "userIds", "groupId"]);
  if (
    data.mode === "all" &&
    data.userIds === undefined &&
    data.groupId === undefined
  )
    return { mode: "all" as const };
  if (data.mode === "users" && data.groupId === undefined)
    return { mode: "users" as const, userIds: userIds(data.userIds) };
  if (data.mode === "group" && data.userIds === undefined)
    return { mode: "group" as const, groupId: requireUuid(data.groupId) };
  throw new ValidationError("Destinatari non validi");
}
export function campaignInput(value: unknown) {
  const data = fields(value, [
    "clientId",
    "title",
    "body",
    "channel",
    "severity",
    "actionUrl",
    "audience",
  ]);
  if (
    !["notification", "email", "both"].includes(String(data.channel)) ||
    !["info", "success", "warning", "critical"].includes(String(data.severity))
  )
    throw new ValidationError("Canale o severità non validi");
  return {
    clientId: requireUuid(data.clientId),
    title: text(data.title, 200),
    body: text(data.body, 4000),
    channel: String(data.channel),
    severity: String(data.severity),
    actionUrl: safeActionUrl(data.actionUrl),
    audience: audienceInput(data.audience),
  };
}
export async function readCommunicationJson(req: Request): Promise<unknown> {
  if (
    req.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
      "application/json" ||
    !req.body
  )
    throw new BadRequestError("Richiesta JSON richiesta");
  const max = 32 * 1024;
  if (Number(req.headers.get("Content-Length")) > max)
    throw new BadRequestError("Richiesta troppo grande");
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new BadRequestError("Richiesta troppo grande");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new BadRequestError("JSON non valido");
  }
}
export function pageInput(req: Request) {
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
    throw new ValidationError("Pagina non valida");
  return { page, limit: 30, offset: (page - 1) * 30 };
}
