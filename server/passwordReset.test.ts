import { afterEach, describe, expect, it } from "bun:test";
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
  passwordResetMessage,
} from "./passwordReset";

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }
});

describe("password reset", () => {
  it("genera token casuali URL-safe e conserva solo un hash deterministico", () => {
    const first = createPasswordResetToken();
    const second = createPasswordResetToken();

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashPasswordResetToken(first)).toHaveLength(64);
    expect(hashPasswordResetToken(first)).toBe(hashPasswordResetToken(first));
    expect(hashPasswordResetToken(first)).not.toContain(first);
  });

  it("costruisce il link pubblico senza concatenare manualmente il token", () => {
    process.env.APP_URL = "https://app.example.com/base";
    const url = new URL(buildPasswordResetUrl("a token&value"));

    expect(url.origin).toBe("https://app.example.com");
    expect(url.pathname).toBe("/reset-password");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("a token&value");
  });

  it("rifiuta di generare link senza un'origine pubblica esplicita", () => {
    delete process.env.APP_URL;
    expect(() => buildPasswordResetUrl("token")).toThrow("APP_URL non configurata");
  });

  it("escapa il link inserito nel corpo HTML", () => {
    const message = passwordResetMessage("https://example.com/reset?token=a&next=<script>");

    expect(message.html).toContain("token=a&amp;next=&lt;script&gt;");
    expect(message.html).not.toContain("<script>");
  });
});
