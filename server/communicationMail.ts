import { sql } from "bun";
import { sendEmail, type SendEmailOptions } from "./mail";
export function campaignMail(
  title: string,
  body: string,
): Pick<SendEmailOptions, "subject" | "text" | "html"> {
  const escape = (v: string) =>
    v
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  return {
    subject: title.replace(/[\r\n]/g, " "),
    text: body,
    html: `<h1>${escape(title)}</h1><p>${escape(body).replaceAll("\n", "<br>")}</p>`,
  };
}
let running = false;
export async function processCommunicationMail(
  send: typeof sendEmail = sendEmail,
): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    // Never retry an interrupted SMTP delivery automatically: it may already have
    // reached the recipient. The admin sees the uncertainty and can retry explicitly.
    await sql`UPDATE communication_email_jobs SET status='failed',error_code='DELIVERY_UNCERTAIN' WHERE status='processing' AND started_at<now()-interval '5 minutes'`;
    const jobs = await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout='3s'`;
      const rows =
        await tx`SELECT j.id FROM communication_email_jobs j WHERE j.status='pending' ORDER BY j.created_at,j.id LIMIT 2 FOR UPDATE SKIP LOCKED`;
      const claimed = [];
      for (const row of rows) {
        const [job] =
          await tx`UPDATE communication_email_jobs SET status='processing',attempt_id=${Bun.randomUUIDv7()},attempts=attempts+1,started_at=now(),error_code=NULL WHERE id=${row.id} RETURNING id,campaign_id,user_id,recipient_email,attempt_id`;
        claimed.push(job);
      }
      return claimed;
    });
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        const [data] =
          await sql`SELECT c.title,c.body,u.email,u.is_active FROM communication_campaigns c LEFT JOIN users u ON u.id=${job.user_id} WHERE c.id=${job.campaign_id}`;
        if (!data?.is_active || data.email !== job.recipient_email) {
          await sql`UPDATE communication_email_jobs SET status='cancelled',error_code='RECIPIENT_CHANGED' WHERE id=${job.id} AND attempt_id=${job.attempt_id} AND status='processing'`;
          return;
        }
        try {
          await send({
            to: job.recipient_email,
            ...campaignMail(data.title, data.body),
          });
        } catch {
          await sql`UPDATE communication_email_jobs SET status='failed',error_code='MAIL_DELIVERY_FAILED' WHERE id=${job.id} AND attempt_id=${job.attempt_id} AND status='processing'`;
          return;
        }
        // A failed status write after SMTP success stays processing/uncertain;
        // it must not be misclassified as a failed SMTP delivery.
        await sql`UPDATE communication_email_jobs SET status='sent',sent_at=now() WHERE id=${job.id} AND attempt_id=${job.attempt_id} AND status='processing'`;
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Email queue unavailable");
    return jobs.length;
  } finally {
    running = false;
  }
}
export function startCommunicationMailWorker(): () => void {
  const tick = () =>
    void processCommunicationMail().catch(() =>
      console.error("[communications] Email queue unavailable"),
    );
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
