import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { LocalAssetStorage, MAX_ASSET_BYTES, S3AssetStorage, assetS3Options, assetStorageKind } from "./assetStorage";
import { errorToResponse } from "./errors";

const root = `/tmp/bunsai-storage-${Bun.randomUUIDv7()}`;
const local = new LocalAssetStorage(root);
const objects = new Map<string, Uint8Array>();
const requests: Array<{ method: string; path: string; signed: boolean; acl: string | null }> = [];
let fail = false;
let declaredSize: number | undefined;
let ignoreRange = false;
let pause: Promise<void> | undefined;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    requests.push({ method: req.method, path, signed: req.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256") ?? false, acl: req.headers.get("x-amz-acl") });
    await pause;
    if (fail) return new Response('<Error><Code>AccessDenied</Code><Message>secret-provider-detail</Message></Error>', { status: 403, headers: { "Content-Type": "application/xml" } });
    if (req.method === "PUT") {
      objects.set(path, new Uint8Array(await req.arrayBuffer()));
      return new Response(null, { headers: { ETag: '"test"' } });
    }
    if (req.method === "DELETE") { objects.delete(path); return new Response(null, { status: 204 }); }
    const bytes = objects.get(path);
    if (!bytes) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
    const headers = { "Content-Length": String(declaredSize ?? bytes.byteLength), "Last-Modified": new Date(0).toUTCString(), ETag: '"test"' };
    if (req.method === "HEAD") return new Response(null, { headers });
    if (req.headers.has("range") && !ignoreRange) {
      return new Response(new Uint8Array(bytes).buffer, { status: 206, headers: { ...headers, "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` } });
    }
    return new Response(new Uint8Array(bytes).buffer, { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
  },
});

const configuration = {
  S3_BUCKET: "bunsai-test", S3_ACCESS_KEY_ID: "test-access-key", S3_SECRET_ACCESS_KEY: "test-secret-key",
  S3_ENDPOINT: `http://127.0.0.1:${server.port}`, S3_REGION: "us-east-1",
};
const remote = new S3AssetStorage(assetS3Options(configuration));

describe("asset storage", () => {
  test("defaults to local and rejects unknown backends", () => {
    expect(assetStorageKind("local")).toBe("local");
    expect(assetStorageKind("s3")).toBe("s3");
    expect(() => assetStorageKind("other")).toThrow();
  });

  test("validates credentials and endpoint without echoing secrets", () => {
    expect(() => assetS3Options({})).toThrow("Configurazione S3");
    for (const endpoint of ["file:///etc/passwd", "http://user:secret@host", "https://host?secret=x", "https://host#fragment"]) {
      expect(() => assetS3Options({ ...configuration, S3_ENDPOINT: endpoint })).toThrow("S3_ENDPOINT non valido");
    }
    expect(() => assetS3Options({ ...configuration, NODE_ENV: "production" })).toThrow("HTTPS");
    expect(assetS3Options({ ...configuration, NODE_ENV: "production", S3_ENDPOINT: "https://storage.example.com" }).endpoint).toBe("https://storage.example.com");
    expect(assetS3Options({ ...configuration, S3_VIRTUAL_HOSTED_STYLE: "true" }).virtualHostedStyle).toBe(true);
    expect(() => assetS3Options({ ...configuration, S3_VIRTUAL_HOSTED_STYLE: "invalid" })).toThrow();
  });

  test("rejects traversal and URL keys before touching storage or the network", async () => {
    const before = requests.length;
    for (const storage of [local, remote]) {
      for (const key of ["../outside", "https://attacker.example/file", "s3://other/key", "/absolute", "id?query", "id\0"]) {
        await expect(storage.write(key, new Uint8Array([1]), "text/plain")).rejects.toThrow("Storage key");
        await expect(storage.read(key)).rejects.toThrow("Storage key");
        await expect(storage.remove(key)).rejects.toThrow("Storage key");
      }
    }
    expect(requests.length).toBe(before);
  });

  test("uploads, downloads and idempotently removes local and S3 objects", async () => {
    for (const storage of [local, remote]) {
      const key = Bun.randomUUIDv7();
      await storage.write(key, new TextEncoder().encode("asset content"), "text/plain");
      expect(await (await storage.read(key)).text()).toBe("asset content");
      await storage.remove(key);
      await storage.remove(key);
      await expect(storage.read(key)).rejects.toMatchObject({ status: 404 });
    }
    expect(requests.every((request) => request.signed)).toBe(true);
    expect(requests.every((request) => request.acl === null)).toBe(true);
    expect(requests.every((request) => /^\/bunsai-test\/[0-9a-f-]{36}$/.test(request.path))).toBe(true);
  });

  test("rejects oversized uploads before a provider request", async () => {
    const before = requests.length;
    await expect(remote.write(Bun.randomUUIDv7(), new Uint8Array(MAX_ASSET_BYTES + 1), "application/octet-stream")).rejects.toMatchObject({ status: 422 });
    expect(requests.length).toBe(before);
  });

  test("rejects oversized remote metadata before GET", async () => {
    const key = Bun.randomUUIDv7();
    await remote.write(key, new Uint8Array([1]), "application/octet-stream");
    const before = requests.length;
    declaredSize = MAX_ASSET_BYTES + 1;
    try {
      await expect(remote.read(key)).rejects.toMatchObject({ status: 422 });
      expect(requests.slice(before).map((request) => request.method)).toEqual(["HEAD"]);
    } finally { declaredSize = undefined; }
  });

  test("bounds downloads when provider ignores Range and the object changes", async () => {
    const key = Bun.randomUUIDv7();
    objects.set(`/bunsai-test/${key}`, new Uint8Array(MAX_ASSET_BYTES + 1));
    declaredSize = 1;
    ignoreRange = true;
    try { await expect(remote.read(key)).rejects.toMatchObject({ status: 422 }); }
    finally { declaredSize = undefined; ignoreRange = false; }
  });

  test("returns safe retryable errors without exposing provider details", async () => {
    fail = true;
    try {
      const key = Bun.randomUUIDv7();
      for (const action of [() => remote.read(key), () => remote.write(key, new Uint8Array([1]), "text/plain"), () => remote.remove(key)]) {
        try { await action(); throw new Error("Expected storage failure"); }
        catch (error) {
          expect(error).toMatchObject({ status: 503, code: "ASSET_STORAGE_UNAVAILABLE" });
          expect((error as Error).cause).toBeUndefined();
          const response = errorToResponse(error);
          expect(response.status).toBe(503);
          expect(await response.text()).not.toContain("secret-provider-detail");
        }
      }
    } finally { fail = false; }
  });

  test("bounds concurrent S3 operations and rejects requests beyond the queue", async () => {
    let resume!: () => void;
    pause = new Promise<void>((resolve) => { resume = resolve; });
    const uploads = Array.from({ length: 36 }, () => remote.write(Bun.randomUUIDv7(), new Uint8Array([1]), "application/octet-stream"));
    try {
      await expect(remote.write(Bun.randomUUIDv7(), new Uint8Array([1]), "text/plain")).rejects.toMatchObject({ status: 429 });
    } finally { pause = undefined; resume(); await Promise.all(uploads); }
    const key = Bun.randomUUIDv7();
    await remote.write(key, new Uint8Array([1]), "text/plain");
    expect((await remote.read(key)).size).toBe(1);
  });
});

afterAll(async () => { server.stop(true); await rm(root, { recursive: true, force: true }); });
