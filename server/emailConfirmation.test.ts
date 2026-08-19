import { afterEach, describe, expect, it } from "bun:test";
import {
  buildEmailConfirmationUrl,
  createEmailConfirmationToken,
  emailConfirmationMessage,
  hashEmailConfirmationToken,
} from "./emailConfirmation";

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe("email confirmation", () => {
  it("genera token URL-safe e conserva un hash deterministico", () => {
    const first = createEmailConfirmationToken();
    const second = createEmailConfirmationToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashEmailConfirmationToken(first)).toHaveLength(64);
    expect(hashEmailConfirmationToken(first)).toBe(hashEmailConfirmationToken(first));
  });

  it("inserisce il token nel frammento dell'URL pubblico", () => {
    process.env.APP_URL = "https://example.com/base";
    const url = new URL(buildEmailConfirmationUrl("secret-token"));
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/confirm-email");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe("secret-token");
  });

  it("escapa il link nel corpo HTML", () => {
    const message = emailConfirmationMessage('https://example.com/#token=<bad>"');
    expect(message.html).not.toContain("<bad>");
    expect(message.html).toContain("&lt;bad&gt;&quot;");
  });
});
