import { describe, expect, test } from "bun:test";
import { readSetupInput, validateSetupInput, validateSetupOrigin } from "./setup";

const valid = { username: " admin ", email: " ADMIN@EXAMPLE.COM ", password: "Administrator123!" };

describe("initial setup validation", () => {
  test("normalizes account fields without modifying the password", () => {
    expect(validateSetupInput(valid)).toEqual({ username: "admin", email: "admin@example.com", password: valid.password });
  });

  test("rejects malformed and oversized account fields", () => {
    for (const input of [null, [], {}, { ...valid, username: "ab" }, { ...valid, username: "a".repeat(256) },
      { ...valid, username: "admin\n" + "name" }, { ...valid, email: "invalid" }, { ...valid, email: "a\0@example.com" }, { ...valid, email: "a".repeat(256) + "@example.com" },
      { ...valid, password: "short" }, { ...valid, password: "a".repeat(129) }, { ...valid, password: 123 }]) {
      expect(() => validateSetupInput(input)).toThrow();
    }
  });

  test("rejects cross-origin, absent and null origins", () => {
    const url = process.env.APP_URL || `http://localhost:${Number(process.env.PORT) || 3000}`;
    for (const origin of [undefined, "null", "https://attacker.example"]) {
      const request = new Request(url, { method: "POST", headers: origin ? { Origin: origin } : {} });
      expect(() => validateSetupOrigin(request)).toThrow("Origine");
    }
    const origin = new URL(url).origin;
    expect(() => validateSetupOrigin(new Request(url, { headers: { Origin: origin } }))).not.toThrow();
    expect(() => validateSetupOrigin(new Request(url, { headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" } }))).toThrow();
  });

  test("requires JSON and rejects malformed input", async () => {
    await expect(readSetupInput(new Request("http://localhost", { method: "POST", body: "username=admin" }))).rejects.toMatchObject({ status: 400 });
    await expect(readSetupInput(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).rejects.toMatchObject({ status: 400 });
    expect(await readSetupInput(new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }))).toEqual(valid);
  });

  test("uses the configured public origin rather than a request-controlled hostname", () => {
    expect(() => validateSetupOrigin(new Request("https://attacker.invalid/api/setup", {
      headers: { Origin: "https://attacker.invalid" },
    }))).toThrow("Origine");
  });

  test("requires HTTPS for installation in production", () => {
    const previousUrl = process.env.APP_URL;
    const previousEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      process.env.APP_URL = "http://site.example";
      expect(() => validateSetupOrigin(new Request("http://site.example", { headers: { Origin: "http://site.example" } }))).toThrow();
      process.env.APP_URL = "https://site.example";
      expect(() => validateSetupOrigin(new Request("https://site.example", { headers: { Origin: "https://site.example" } }))).not.toThrow();
    } finally {
      if (previousUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousUrl;
      if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    }
  });

  test("accepts explicit loopback aliases in development only on the configured scheme and port", () => {
    const previousUrl = process.env.APP_URL;
    const previousPort = process.env.PORT;
    const previousEnv = process.env.NODE_ENV;
    const request = (origin: string, extra: Record<string, string> = {}) => new Request("http://localhost:3030/api/setup", {
      method: "POST", headers: { Origin: origin, ...extra },
    });
    try {
      process.env.NODE_ENV = "development";
      process.env.PORT = "3030";
      for (const configured of [undefined, "http://localhost:3030", "http://127.0.0.1:3030", "http://[::1]:3030"]) {
        if (configured === undefined) delete process.env.APP_URL; else process.env.APP_URL = configured;
        for (const origin of ["http://localhost:3030", "http://127.0.0.1:3030", "http://[::1]:3030"]) {
          expect(() => validateSetupOrigin(request(origin, { "Sec-Fetch-Site": "same-origin" }))).not.toThrow();
        }
        for (const origin of ["null", "invalid", "http://127.0.0.1:3000", "https://localhost:3030", "http://localhost.attacker.test:3030", "http://192.168.1.2:3030", "http://127.0.0.1:3030/path", "http://attacker@localhost:3030"]) {
          expect(() => validateSetupOrigin(request(origin))).toThrow("Origine");
        }
        expect(() => validateSetupOrigin(request("http://127.0.0.1:3030", { "Sec-Fetch-Site": "cross-site" }))).toThrow("Origine");
      }
      process.env.APP_URL = "https://site.example";
      expect(() => validateSetupOrigin(request("http://127.0.0.1:3030"))).toThrow("Origine");
      process.env.NODE_ENV = "production";
      process.env.APP_URL = "https://localhost:3030";
      expect(() => validateSetupOrigin(request("https://127.0.0.1:3030"))).toThrow("Origine");
      expect(() => validateSetupOrigin(request("https://localhost:3030"))).not.toThrow();
    } finally {
      if (previousUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousUrl;
      if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
      if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    }
  });

  test("bounds streamed JSON even when Content-Length is missing or dishonest", async () => {
    for (const length of [undefined, "1", "9000"]) {
      const request = new Request("http://localhost", { method: "POST", headers: {
        "Content-Type": "application/json", ...(length ? { "Content-Length": length } : {}),
      }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9000)); controller.close(); } }) });
      await expect(readSetupInput(request)).rejects.toMatchObject({ status: 400 });
    }
  });
});
