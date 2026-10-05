import { randomBytes, createHash } from "node:crypto";
import { sendEmail } from "./mail";
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const createInvitationToken = () =>
  randomBytes(32).toString("base64url");
export const hashInvitationToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function invitationUrl(token: string): string {
  const base = process.env.APP_URL?.trim();
  if (!base) throw new Error("APP_URL non configurata");
  const url = new URL("/accept-invitation", base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
    url.username ||
    url.password
  )
    throw new Error("APP_URL non valida");
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}
export function invitationMessage(url: string, locale: "it" | "en") {
  const safe = url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return locale === "en"
    ? {
        subject: "You are invited to Bunsai",
        text: `You have been invited to create an account. Choose your username and password within 7 days: ${url}\n\nIf you did not expect this invitation, ignore this email.`,
        html: `<p>You have been invited to create an account.</p><p><a href="${safe}">Accept invitation</a></p><p>Choose your username and password within 7 days. If you did not expect this invitation, ignore this email.</p>`,
      }
    : {
        subject: "Sei invitato su Bunsai",
        text: `Sei stato invitato a creare un account. Scegli username e password entro 7 giorni: ${url}\n\nSe non ti aspettavi questo invito, ignora questa email.`,
        html: `<p>Sei stato invitato a creare un account.</p><p><a href="${safe}">Accetta invito</a></p><p>Scegli username e password entro 7 giorni. Se non ti aspettavi questo invito, ignora questa email.</p>`,
      };
}
export const sendInvitationEmail = (
  email: string,
  token: string,
  locale: "it" | "en",
) =>
  sendEmail({ to: email, ...invitationMessage(invitationUrl(token), locale) });
