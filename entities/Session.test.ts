import { afterEach, describe, expect, it } from "bun:test";
import { sessionCookieSecure } from "./Session";

const originalAppUrl = process.env.APP_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalOverride = process.env.SESSION_COOKIE_SECURE;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalOverride === undefined) delete process.env.SESSION_COOKIE_SECURE;
  else process.env.SESSION_COOKIE_SECURE = originalOverride;
});

describe("session cookie", () => {
  it("usa Secure per un'origine pubblica HTTPS dietro reverse proxy", () => {
    delete process.env.SESSION_COOKIE_SECURE;
    process.env.APP_URL = "https://app.example.com";
    expect(sessionCookieSecure()).toBe(true);
  });

  it("consente HTTP locale e un override esplicito", () => {
    delete process.env.SESSION_COOKIE_SECURE;
    process.env.APP_URL = "http://localhost:3030";
    expect(sessionCookieSecure()).toBe(false);
    process.env.SESSION_COOKIE_SECURE = "true";
    expect(sessionCookieSecure()).toBe(true);
  });
});
