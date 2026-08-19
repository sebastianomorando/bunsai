import { createHash, randomBytes } from "node:crypto";
import { sendEmail } from "./mail";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password.";

export function createPasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildPasswordResetUrl(token: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("APP_URL non configurata");
  const url = new URL("/reset-password", baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_URL deve usare http o https");
  }
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function passwordResetMessage(resetUrl: string) {
  const safeUrl = escapeHtml(resetUrl);
  return {
    subject: "Reimposta la password",
    text: `Hai richiesto di reimpostare la password. Apri questo link entro un'ora: ${resetUrl}\n\nSe non hai effettuato tu la richiesta, ignora questa email.`,
    html: `<p>Hai richiesto di reimpostare la password.</p><p><a href="${safeUrl}">Reimposta la password</a></p><p>Il link scade tra un'ora. Se non hai effettuato tu la richiesta, ignora questa email.</p>`,
  };
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const resetUrl = buildPasswordResetUrl(token);
  await sendEmail({
    to: email,
    ...passwordResetMessage(resetUrl),
  });
}
