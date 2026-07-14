import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BadRequestError, ValidationError } from "./errors";

export const ASSETS_DIR = resolve(process.env.ASSETS_DIR ?? "./data/assets");
export const ASSET_CACHE_DIR = resolve(process.env.ASSET_CACHE_DIR ?? "./data/assets-cache");
export const MAX_ASSET_BYTES = Number(process.env.MAX_ASSET_BYTES) || 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = Number(process.env.MAX_IMAGE_PIXELS) || 40_000_000;
export const MAX_TRANSFORM_DIMENSION = Number(process.env.MAX_TRANSFORM_DIMENSION) || 4096;

export type ImageFormat = "jpeg" | "png" | "webp";
type ImageFit = "fill" | "inside";

export type AssetTransform = {
  width?: number;
  height?: number;
  quality: number;
  format: ImageFormat;
  fit: ImageFit;
  withoutEnlargement: boolean;
  rotate?: 0 | 90 | 180 | 270;
  flip: boolean;
  flop: boolean;
  brightness?: number;
  saturation?: number;
};

const presets: Record<string, Partial<AssetTransform>> = {
  "system-small-cover": { width: 64, height: 64, fit: "fill" },
  "system-small-contain": { width: 64, fit: "inside" },
  "system-medium-cover": { width: 300, height: 300, fit: "fill" },
  "system-medium-contain": { width: 300, fit: "inside" },
  "system-large-cover": { width: 800, height: 800, fit: "fill" },
  "system-large-contain": { width: 800, fit: "inside" },
};

function numberParam(value: string | null, name: string, min: number, max: number) {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${name} deve essere compreso tra ${min} e ${max}`);
  }
  return Math.round(parsed);
}

function booleanParam(value: string | null, name: string) {
  if (value === null) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new ValidationError(`${name} deve essere true o false`);
}

function outputFormat(value: string | null, accept: string): ImageFormat {
  if (!value || value === "auto") {
    return accept.includes("image/webp") ? "webp" : "jpeg";
  }
  if (value === "jpg" || value === "jpeg") return "jpeg";
  if (value === "png" || value === "webp") return value;
  throw new ValidationError("format deve essere auto, jpg, png o webp");
}

export function parseAssetTransform(url: URL, accept = ""): AssetTransform | null {
  const query = url.searchParams;
  const key = query.get("key");
  if (key && !presets[key]) throw new ValidationError("Preset asset non valido");
  const base = key ? presets[key]! : {};
  const hasTransform = key || ["width", "height", "quality", "format", "fit", "withoutEnlargement", "rotate", "flip", "flop", "brightness", "saturation"].some((name) => query.has(name));
  if (!hasTransform) return null;

  const fitValue = query.get("fit") ?? base.fit ?? "inside";
  const fit: ImageFit = fitValue === "contain" ? "inside" : fitValue as ImageFit;
  if (fit !== "fill" && fit !== "inside") {
    throw new ValidationError("fit deve essere fill, inside o contain");
  }
  const rotate = numberParam(query.get("rotate"), "rotate", 0, 270);
  if (rotate !== undefined && ![0, 90, 180, 270].includes(rotate)) {
    throw new ValidationError("rotate accetta solo 0, 90, 180 o 270");
  }

  return {
    width: numberParam(query.get("width"), "width", 1, MAX_TRANSFORM_DIMENSION) ?? base.width,
    height: numberParam(query.get("height"), "height", 1, MAX_TRANSFORM_DIMENSION) ?? base.height,
    quality: numberParam(query.get("quality"), "quality", 1, 100) ?? base.quality ?? 80,
    format: outputFormat(query.get("format") ?? (base.format ?? null), accept),
    fit,
    withoutEnlargement: booleanParam(query.get("withoutEnlargement"), "withoutEnlargement") ?? base.withoutEnlargement ?? true,
    rotate: rotate as AssetTransform["rotate"],
    flip: booleanParam(query.get("flip"), "flip") ?? false,
    flop: booleanParam(query.get("flop"), "flop") ?? false,
    brightness: numberParam(query.get("brightness"), "brightness", 0, 10),
    saturation: numberParam(query.get("saturation"), "saturation", 0, 10),
  };
}

export function assetPath(storageKey: string) {
  if (!/^[0-9a-f-]{36}$/.test(storageKey)) throw new BadRequestError("Storage key non valida");
  return join(ASSETS_DIR, storageKey);
}

export async function ensureAssetDirectories() {
  await Promise.all([mkdir(ASSETS_DIR, { recursive: true }), mkdir(ASSET_CACHE_DIR, { recursive: true })]);
}

export async function inspectImage(bytes: Uint8Array) {
  try {
    const ImageCtor = (Bun as any).Image;
    return await new ImageCtor(bytes, { maxPixels: MAX_IMAGE_PIXELS, autoOrient: true }).metadata() as { width: number; height: number; format: string };
  } catch {
    return null;
  }
}

export async function transformAsset(source: string, assetId: string, transform: AssetTransform) {
  await ensureAssetDirectories();
  const signature = JSON.stringify(transform);
  const digest = new Bun.CryptoHasher("sha256").update(signature).digest("hex");
  const cachePath = join(ASSET_CACHE_DIR, `${assetId}-${digest}.${transform.format}`);
  const cached = Bun.file(cachePath);
  if (await cached.exists()) return cached;

  const ImageCtor = (Bun as any).Image;
  let image = new ImageCtor(Bun.file(source), { maxPixels: MAX_IMAGE_PIXELS, autoOrient: true });
  if (transform.width || transform.height) {
    image = image.resize(transform.width, transform.height, {
      fit: transform.fit,
      withoutEnlargement: transform.withoutEnlargement,
    });
  }
  if (transform.rotate) image = image.rotate(transform.rotate);
  if (transform.flip) image = image.flip();
  if (transform.flop) image = image.flop();
  if (transform.brightness !== undefined || transform.saturation !== undefined) {
    image = image.modulate({ brightness: transform.brightness, saturation: transform.saturation });
  }
  if (transform.format === "jpeg") image = image.jpeg({ quality: transform.quality, progressive: true });
  if (transform.format === "png") image = image.png({ compressionLevel: 6 });
  if (transform.format === "webp") image = image.webp({ quality: transform.quality });
  await image.write(cachePath);
  return Bun.file(cachePath);
}

export async function removeAssetFiles(storageKey: string, assetId: string) {
  await rm(assetPath(storageKey), { force: true });
  const glob = new Bun.Glob(`${assetId}-*`);
  for await (const filename of glob.scan(ASSET_CACHE_DIR)) {
    await rm(join(ASSET_CACHE_DIR, filename), { force: true });
  }
}
