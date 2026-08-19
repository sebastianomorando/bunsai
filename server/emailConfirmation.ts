import { createHash, randomBytes } from "node:crypto";
import { sendEmail } from "./mail";

export const EMAIL_CONFIRMATION_TTL_MS = 24 * 60 * 60 * 1000;

export function createEmailConfirmationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashEmailConfirmationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildEmailConfirmationUrl(token: string): string {
  const baseUrl = process.env.APP_URL?.trim();
  if (!baseUrl) throw new Error("APP_URL non configurata");
  const url = new URL("/confirm-email", baseUrl);
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

export function emailConfirmationMessage(confirmationUrl: string) {
  const safeUrl = escapeHtml(confirmationUrl);
  return {
    subject: "Conferma il tuo indirizzo email",
    text: `Conferma il tuo indirizzo email aprendo questo link entro 24 ore: ${confirmationUrl}\n\nSe non hai creato tu questo account, ignora questa email.`,
    html: `<p>Conferma il tuo indirizzo email per attivare l'account.</p><p><a href="${safeUrl}">Conferma email</a></p><p>Il link scade tra 24 ore. Se non hai creato tu questo account, ignora questa email.</p>`,
  };
}

export async function sendEmailConfirmation(email: string, token: string): Promise<void> {
  await sendEmail({
    to: email,
    ...emailConfirmationMessage(buildEmailConfirmationUrl(token)),
  });
}
