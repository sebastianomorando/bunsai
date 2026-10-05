import { describe, expect, test } from "bun:test";
import {
  audienceInput,
  campaignInput,
  fields,
  readCommunicationJson,
  safeActionUrl,
  text,
  userIds,
} from "./communicationValidation";
import { campaignMail } from "./communicationMail";
const id = Bun.randomUUIDv7();
describe("communication validation", () => {
  test("strict audience and campaign fields prevent privilege injection", () => {
    for (const input of [null, [], { admin: true }])
      expect(() => fields(input, [])).toThrow();
    for (const input of [
      { mode: "all", userIds: [id] },
      { mode: "group", groupId: "bad" },
      { mode: "users", userIds: [] },
      { mode: "users", userIds: [id], groupId: id },
      { mode: "everyone" },
    ])
      expect(() => audienceInput(input)).toThrow();
    expect(userIds([id, id])).toEqual([id]);
    expect(() => userIds(Array(501).fill(id))).toThrow();
    const campaign = {
      clientId: id,
      title: " title ",
      body: " message ",
      channel: "both",
      severity: "info",
      audience: { mode: "all" },
    };
    expect(campaignInput(campaign)).toMatchObject({
      title: "title",
      body: "message",
      actionUrl: null,
    });
    expect(() => campaignInput({ ...campaign, createdBy: id })).toThrow();
    expect(() => campaignInput({ ...campaign, channel: "sms" })).toThrow();
    expect(() => campaignInput({ ...campaign, severity: "fatal" })).toThrow();
  });
  test("blocks external, encoded and backslash notification destinations", () => {
    for (const value of [
      "https://attacker.test",
      "//attacker.test",
      "/\\attacker.test",
      "/%5cattacker.test",
      "/%2f%2fattacker.test",
      "/ bad",
      "/\n",
      "javascript:alert(1)",
      "/%00",
      "/%ZZ",
    ])
      expect(() => safeActionUrl(value)).toThrow();
    expect(safeActionUrl("/chat?conversation=" + id)).toBe(
      "/chat?conversation=" + id,
    );
    expect(safeActionUrl("")).toBeNull();
  });
  test("bounds messages and removes no user content silently", () => {
    expect(text(" hello\nworld ", 4000)).toBe("hello\nworld");
    for (const value of ["", 42, "x".repeat(4001), "bad\0message"])
      expect(() => text(value, 4000)).toThrow();
  });
  test("email HTML escapes user content and subjects reject header injection", () => {
    const mail = campaignMail(
      "Title\r\nBcc: injected",
      "<script>alert(1)</script>\n&message",
    );
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.subject).not.toContain("\n");
    expect(mail.text).toContain("<script>");
  });
  test("JSON is bounded in streaming, malformed and non-JSON inputs fail", async () => {
    for (const body of ["{", "x".repeat(32769)])
      await expect(
        readCommunicationJson(
          new Request("http://localhost", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      readCommunicationJson(
        new Request("http://localhost", { method: "POST", body: "{}" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    let cancelled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(20000));
        c.enqueue(new Uint8Array(20000));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readCommunicationJson(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stream,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(cancelled).toBe(true);
  });
});

describe("communication retention", () => {
  test("validates bounded retention and uses the supplied cutoff", async () => {
    const { communicationRetentionCutoff } = await import(
      "./communicationRetention"
    );
    const previous = process.env.CHAT_RETENTION_DAYS;
    try {
      delete process.env.CHAT_RETENTION_DAYS;
      const now = new Date("2026-10-05T12:00:00Z");
      expect(communicationRetentionCutoff("chat", now).getTime()).toBe(
        now.getTime() - 730 * 86400000,
      );
      for (const value of ["0", "29", "3651", "bad"]) {
        process.env.CHAT_RETENTION_DAYS = value;
        expect(() => communicationRetentionCutoff("chat", now)).toThrow();
      }
    } finally {
      if (previous === undefined) delete process.env.CHAT_RETENTION_DAYS;
      else process.env.CHAT_RETENTION_DAYS = previous;
    }
  });
});
