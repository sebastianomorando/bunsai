import { afterAll, describe, expect, test } from "bun:test";
import { rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { ASSET_CACHE_DIR, ensureAssetDirectories, evictAssetCache, parseAssetTransform, transformAsset } from "./assets";

describe("asset transformations", () => {
  test("parses Directus-style resize options", () => {
    const transform = parseAssetTransform(
      new URL("http://localhost/assets/id?width=300&height=200&quality=70&fit=contain&format=webp&withoutEnlargement=true")
    );
    expect(transform).toMatchObject({
      width: 300, height: 200, quality: 70, fit: "inside",
      format: "webp", withoutEnlargement: true,
    });
  });

  test("supports presets and browser format negotiation", () => {
    const transform = parseAssetTransform(
      new URL("http://localhost/assets/id?key=system-medium-contain&format=auto"),
      "image/avif,image/webp,*/*"
    );
    expect(transform).toMatchObject({ width: 300, fit: "inside", format: "webp" });
  });

  test("rejects dimensions beyond the configured limit", () => {
    expect(() => parseAssetTransform(new URL("http://localhost/assets/id?width=999999"))).toThrow();
  });

  test("rejects asset ids that could escape the cache directory", async () => {
    const options = parseAssetTransform(new URL("http://localhost/assets/id?width=1"))!;
    expect(transformAsset("/tmp/source.png", "../outside", options)).rejects.toThrow("Asset id non valido");
  });

  test("transforms and caches an image with Bun.Image", async () => {
    const input = `/tmp/bunsai-asset-${Bun.randomUUIDv7()}.png`;
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    await Bun.write(input, png);
    const id = Bun.randomUUIDv7();
    const options = parseAssetTransform(new URL("http://localhost/assets/id?width=1&format=webp"))!;
    let generated = 0;
    const beforeGenerate = () => { generated += 1; };
    const first = await transformAsset(input, id, options, { beforeGenerate });
    const second = await transformAsset(input, id, options, { beforeGenerate });
    expect(await first.exists()).toBe(true);
    expect(second.name).toBe(first.name);
    expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(generated).toBe(1);
    await rm(input, { force: true });
  });

  test("preserves aspect ratio when only height is provided", async () => {
    const input = `/tmp/bunsai-asset-${Bun.randomUUIDv7()}.png`;
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    await new Bun.Image(png).resize(2, 1).png().write(input);

    try {
      const options = parseAssetTransform(new URL("http://localhost/assets/id?height=2&format=png&withoutEnlargement=false"))!;
      const output = await transformAsset(input, Bun.randomUUIDv7(), options);
      expect(await new Bun.Image(output).metadata()).toMatchObject({ width: 4, height: 2 });
    } finally {
      await rm(input, { force: true });
    }
  });

  test("evicts the least recently used variants beyond the per-asset quota", async () => {
    await ensureAssetDirectories();
    const assetId = Bun.randomUUIDv7();
    const paths = ["a", "b", "c"].map((digest) =>
      join(ASSET_CACHE_DIR, `${assetId}-${digest.repeat(64)}.webp`)
    );
    for (let index = 0; index < paths.length; index += 1) {
      await Bun.write(paths[index]!, new Uint8Array([index]));
      const usedAt = new Date(Date.now() - (paths.length - index) * 60_000);
      await utimes(paths[index]!, usedAt, usedAt);
    }

    const result = await evictAssetCache({
      maxVariantsPerAsset: 2,
      maxBytes: 1024,
      respectGracePeriod: false,
    });

    expect(result.quotaSatisfied).toBe(true);
    expect(result.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(await Bun.file(paths[0]!).exists()).toBe(false);
    expect(await Bun.file(paths[2]!).exists()).toBe(true);
  });

  test("rejects a new protected variant when the byte quota cannot be satisfied", async () => {
    await ensureAssetDirectories();
    const assetId = Bun.randomUUIDv7();
    const protectedPath = join(ASSET_CACHE_DIR, `${assetId}-${"d".repeat(64)}.png`);
    await Bun.write(protectedPath, new Uint8Array(32));

    const result = await evictAssetCache({
      protectedPath,
      maxVariantsPerAsset: 2,
      maxBytes: 8,
    });

    expect(result.quotaSatisfied).toBe(false);
    expect(await Bun.file(protectedPath).exists()).toBe(false);
  });

  test("limits the global cache file count independently from its byte size", async () => {
    await rm(ASSET_CACHE_DIR, { recursive: true, force: true });
    await ensureAssetDirectories();
    const paths = ["e", "f"].map((digest) =>
      join(ASSET_CACHE_DIR, `${Bun.randomUUIDv7()}-${digest.repeat(64)}.png`)
    );
    for (let index = 0; index < paths.length; index += 1) {
      await Bun.write(paths[index]!, new Uint8Array([index]));
      const usedAt = new Date(Date.now() - (paths.length - index) * 60_000);
      await utimes(paths[index]!, usedAt, usedAt);
    }

    const result = await evictAssetCache({
      maxFiles: 1,
      maxVariantsPerAsset: 20,
      maxBytes: 1024,
      respectGracePeriod: false,
    });

    expect(result.quotaSatisfied).toBe(true);
    expect(await Bun.file(paths[0]!).exists()).toBe(false);
    expect(await Bun.file(paths[1]!).exists()).toBe(true);
  });

  test("removes stale temporary files during maintenance eviction", async () => {
    await ensureAssetDirectories();
    const temporaryPath = join(ASSET_CACHE_DIR, `.tmp-${Bun.randomUUIDv7()}`);
    await Bun.write(temporaryPath, new Uint8Array(16));
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await utimes(temporaryPath, staleAt, staleAt);

    const result = await evictAssetCache({ respectGracePeriod: false });

    expect(result.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(await Bun.file(temporaryPath).exists()).toBe(false);
  });
});

afterAll(async () => {
  await rm(ASSET_CACHE_DIR, { recursive: true, force: true });
});
