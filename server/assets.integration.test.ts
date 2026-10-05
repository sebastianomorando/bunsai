import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

// Opt-in only: use a disposable database named bunsai_asset_tests and a private
// test bucket. Apply migrations and configure S3 before running this file.
const enabled = process.env.ASSET_INTEGRATION === "1";
const assetIds: string[] = [];
const userIds: string[] = [];
let server: Bun.Server<unknown>;
let origin: string;
let ownerCookie: string;
let otherCookie: string;
let localId: string;
let remoteId: string;
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

describe.skipIf(!enabled)("asset API with PostgreSQL and S3", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      url.pathname !== "/bunsai_asset_tests" ||
      process.env.NODE_ENV === "production"
    ) {
      throw new Error(
        "Integration tests require a disposable bunsai_asset_tests database",
      );
    }
    const temporaryRoot = `${resolve(tmpdir())}${sep}`;
    await sql`DELETE FROM rate_limits`;
    for (const value of [process.env.ASSETS_DIR, process.env.ASSET_CACHE_DIR]) {
      if (!value || !resolve(value).startsWith(temporaryRoot))
        throw new Error(
          "Integration tests require temporary asset directories",
        );
    }
    const { default: app } = await import("./app");
    const { default: Asset } = await import("../entities/Asset");
    const { default: Session } = await import("../entities/Session");
    const { registerClassRoutes } = await import("./decorators");
    registerClassRoutes(app, Asset);
    server = app.listen({ hostname: "127.0.0.1", port: 0 });
    origin = `http://127.0.0.1:${server.port}`;
    process.env.APP_URL = origin;
    for (let index = 0; index < 2; index += 1) {
      const id = Bun.randomUUIDv7();
      userIds.push(id);
      await sql`INSERT INTO users ${sql({ id, username: `asset-test-${id}`, email: `${id}@example.test`, password: "unused", is_active: true })}`;
      const session = await Session.initNewSession(id);
      if (index === 0) ownerCookie = `session_id=${session.id}`;
      else otherCookie = `session_id=${session.id}`;
    }
  });

  async function upload(backend: "local" | "s3"): Promise<string> {
    process.env.ASSET_STORAGE = backend;
    const form = new FormData();
    form.set("file", new File([png], "photo.png", { type: "image/png" }));
    const response = await fetch(`${origin}/api/assets`, {
      method: "POST",
      headers: { Cookie: ownerCookie, Origin: origin },
      body: form,
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.storage_key).toBeUndefined();
    expect(body.storage_backend).toBeUndefined();
    assetIds.push(body.id);
    const rows =
      await sql`SELECT storage_backend FROM assets WHERE id = ${body.id}`;
    expect(rows[0].storage_backend).toBe(backend);
    return body.id;
  }

  test("uploads to both backends and retains local reads after switching to S3", async () => {
    localId = await upload("local");
    remoteId = await upload("s3");
    for (const id of [localId, remoteId]) {
      const response = await fetch(`${origin}/assets/${id}`);
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      const transformed = await fetch(
        `${origin}/assets/${id}?width=1&format=webp`,
      );
      expect(transformed.status).toBe(200);
      expect(transformed.headers.get("Content-Type")).toBe("image/webp");
    }
  });

  test("keeps ownership checks and authenticated uploads for both backends", async () => {
    const anonymous = await fetch(`${origin}/api/assets`, { method: "POST" });
    expect(anonymous.status).toBe(401);
    for (const id of [localId, remoteId]) {
      expect(
        (
          await fetch(`${origin}/api/assets/${id}`, {
            headers: { Cookie: otherCookie, Origin: origin },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${origin}/api/assets/${id}`, {
            method: "DELETE",
            headers: { Cookie: otherCookie, Origin: origin },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${origin}/api/assets/${id}`, {
            headers: { Cookie: ownerCookie, Origin: origin },
          })
        ).status,
      ).toBe(200);
    }
    const list = await (
      await fetch(`${origin}/api/assets`, {
        headers: { Cookie: otherCookie, Origin: origin },
      })
    ).json();
    expect(list.items).toEqual([]);
    const [remote] =
      await sql`SELECT storage_key FROM assets WHERE id = ${remoteId}`;
    const unsigned = await fetch(
      `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${remote.storage_key}`,
    );
    expect(unsigned.status).toBe(403);
  });

  test("limits S3 transfer costs before downloads and multipart parsing", async () => {
    await sql`UPDATE rate_limits SET request_count = 100000 WHERE scope IN ('assets.s3-download.ip', 'assets.s3-upload.ip')`;
    try {
      const download = await fetch(`${origin}/assets/${remoteId}`);
      expect(download.status).toBe(429);
      expect(Number(download.headers.get("Retry-After"))).toBeGreaterThan(0);
      const upload = await fetch(`${origin}/api/assets`, {
        method: "POST",
        headers: { Cookie: ownerCookie, Origin: origin },
      });
      expect(upload.status).toBe(429);
      expect((await fetch(`${origin}/assets/${localId}`)).status).toBe(200);
      expect(
        (await fetch(`${origin}/assets/${remoteId}?width=1&format=webp`))
          .status,
      ).toBe(200);
    } finally {
      await sql`DELETE FROM rate_limits WHERE scope IN ('assets.s3-download.ip', 'assets.s3-upload.ip')`;
    }
  });

  test("library pagination, literal search and MIME filters isolate the owner", async () => {
    const get = async (query: string, cookie = ownerCookie) =>
      (
        await fetch(`${origin}/api/assets?${query}`, {
          headers: { Cookie: cookie },
        })
      ).json();
    const first = await get("limit=1&type=image");
    expect(first.total).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].storage_key).toBeUndefined();
    const second = await get("limit=1&type=image&offset=1");
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await get("type=document")).total).toBe(0);
    expect((await get("q=%25")).total).toBe(0);
    expect((await get("q=photo")).total).toBe(2);
    expect((await get("q=photo", otherCookie)).total).toBe(0);
    expect(
      (
        await fetch(`${origin}/api/assets?sortBy=storage_key`, {
          headers: { Cookie: ownerCookie },
        })
      ).status,
    ).toBe(422);
  });
  test("metadata edits require ownership, origin and revision and preserve storage for both backends", async () => {
    const patch = (
      id: string,
      body: unknown,
      cookie = ownerCookie,
      source = origin,
    ) =>
      fetch(`${origin}/api/assets/${id}`, {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          Origin: source,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    for (const id of [localId, remoteId]) {
      const original = await (
        await fetch(`${origin}/api/assets/${id}`, {
          headers: { Cookie: ownerCookie },
        })
      ).json();
      const input = {
        title: "<img src=x onerror=alert(1)>",
        filename: "renamed.png",
        version: original.version,
      };
      expect((await patch(id, input, otherCookie)).status).toBe(404);
      expect((await patch(id, input, "")).status).toBe(401);
      await sql`UPDATE users SET role='admin' WHERE id=${userIds[1]}`;
      expect((await patch(id, input, otherCookie)).status).toBe(404);
      await sql`UPDATE users SET role='user' WHERE id=${userIds[1]}`;
      expect(
        (await patch(id, input, ownerCookie, "https://attacker.test")).status,
      ).toBe(403);
      expect(
        (await patch(id, { ...input, storage_key: "../../secret" })).status,
      ).toBe(422);
      expect(
        (await patch(id, { ...input, filename: "../secret" })).status,
      ).toBe(422);
      const responses = await Promise.all([patch(id, input), patch(id, input)]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        responses.find((r) => r.status === 200)?.headers.get("Cache-Control"),
      ).toBe("no-store");
      const updated = await (
        await fetch(`${origin}/api/assets/${id}`, {
          headers: { Cookie: ownerCookie },
        })
      ).json();
      expect(updated.filename).toBe("renamed.png");
      expect(updated.version).not.toBe(original.version);
      expect(updated.mimeType).toBe(original.mimeType);
      expect(
        new Uint8Array(
          await (await fetch(`${origin}/assets/${id}`)).arrayBuffer(),
        ),
      ).toEqual(png);
      expect(
        (
          await patch(id, {
            ...input,
            version: updated.version,
            title: "a".repeat(9000),
          })
        ).status,
      ).toBe(400);
    }
  });
  test("asset upload and deletion reject cross-site mutations", async () => {
    for (const [url, method] of [
      ["/api/assets", "POST"],
      [`/api/assets/${localId}`, "DELETE"],
    ])
      expect(
        (
          await fetch(origin + url, {
            method,
            headers: { Cookie: ownerCookie, Origin: "https://attacker.test" },
          })
        ).status,
      ).toBe(403);
    expect((await sql`SELECT id FROM assets WHERE id=${localId}`).length).toBe(
      1,
    );
  });
  test("deletes original objects and metadata through the owner route", async () => {
    const { getAssetStorage } = await import("./assetStorage");
    for (const id of [localId, remoteId]) {
      const [asset] =
        await sql`SELECT storage_backend, storage_key FROM assets WHERE id = ${id}`;
      expect(
        (
          await fetch(`${origin}/api/assets/${id}`, {
            method: "DELETE",
            headers: { Cookie: ownerCookie, Origin: origin },
          })
        ).status,
      ).toBe(204);
      await expect(
        getAssetStorage(asset.storage_backend).read(asset.storage_key),
      ).rejects.toMatchObject({ status: 404 });
      expect((await sql`SELECT id FROM assets WHERE id = ${id}`).length).toBe(
        0,
      );
      expect((await fetch(`${origin}/assets/${id}`)).status).toBe(404);
    }
  });
});

afterAll(async () => {
  if (!enabled) return;
  const { removeAssetFiles } = await import("./assets");
  for (const id of assetIds) {
    const [asset] =
      await sql`SELECT storage_key, storage_backend FROM assets WHERE id = ${id}`;
    if (asset)
      await removeAssetFiles(asset.storage_key, id, asset.storage_backend);
  }
  for (const id of userIds) await sql`DELETE FROM users WHERE id = ${id}`;
  server?.stop(true);
  await sql.close();
});
