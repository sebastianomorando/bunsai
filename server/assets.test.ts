import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { ASSET_CACHE_DIR, parseAssetTransform, transformAsset } from "./assets";

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

  test("transforms and caches an image with Bun.Image", async () => {
    const input = `/tmp/bunsai-asset-${Bun.randomUUIDv7()}.png`;
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    await Bun.write(input, png);
    const id = Bun.randomUUIDv7();
    const options = parseAssetTransform(new URL("http://localhost/assets/id?width=1&format=webp"))!;
    const first = await transformAsset(input, id, options);
    const second = await transformAsset(input, id, options);
    expect(await first.exists()).toBe(true);
    expect(second.name).toBe(first.name);
    expect((await first.arrayBuffer()).byteLength).toBeGreaterThan(0);
    await rm(input, { force: true });
  });
});

afterAll(async () => {
  await rm(ASSET_CACHE_DIR, { recursive: true, force: true });
});
