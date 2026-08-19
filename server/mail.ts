import nodemailer from "nodemailer";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function readPort(value: string | undefined): number {
  const port = Number(value ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MAIL_PORT non valida");
  }
  return port;
}

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.MAIL_SERVER?.trim();
  if (!host) throw new Error("MAIL_SERVER non configurato");

  const username = process.env.MAIL_USERNAME?.trim();
  const password = process.env.MAIL_PASSWORD;
  if (username && !password) throw new Error("MAIL_PASSWORD non configurata");

  transporter = nodemailer.createTransport({
    host,
    port: readPort(process.env.MAIL_PORT),
    secure: process.env.MAIL_SECURE === "true",
    auth: username ? { user: username, pass: password } : undefined,
  });
  return transporter;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const fromEmail = (process.env.MAIL_FROM_EMAIL ?? process.env.MAIL_USERNAME)?.trim();
  if (!fromEmail) throw new Error("MAIL_FROM_EMAIL non configurata");

  await getTransporter().sendMail({
    from: {
      name: process.env.MAIL_FROM_NAME?.trim() || "Bunsai",
      address: fromEmail,
    },
    ...options,
  });
}
