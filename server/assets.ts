import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BadRequestError, RateLimitError, StorageQuotaError, ValidationError } from "./errors";

export const ASSETS_DIR = resolve(process.env.ASSETS_DIR ?? "./data/assets");
export const ASSET_CACHE_DIR = resolve(process.env.ASSET_CACHE_DIR ?? "./data/assets-cache");
export const MAX_ASSET_BYTES = Number(process.env.MAX_ASSET_BYTES) || 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = Number(process.env.MAX_IMAGE_PIXELS) || 40_000_000;
export const MAX_TRANSFORM_DIMENSION = Number(process.env.MAX_TRANSFORM_DIMENSION) || 4096;
export const MAX_ASSET_CACHE_BYTES = Number(process.env.MAX_ASSET_CACHE_BYTES) || 512 * 1024 * 1024;
export const MAX_ASSET_CACHE_FILES = Number(process.env.MAX_ASSET_CACHE_FILES) || 10_000;
export const MAX_ASSET_CACHE_VARIANTS_PER_ASSET = Number(process.env.MAX_ASSET_CACHE_VARIANTS_PER_ASSET) || 20;
export const MAX_CONCURRENT_IMAGE_TRANSFORMS = Number(process.env.MAX_CONCURRENT_IMAGE_TRANSFORMS) || 2;
export const MAX_QUEUED_IMAGE_TRANSFORMS = Number(process.env.MAX_QUEUED_IMAGE_TRANSFORMS) || 32;
export const ASSET_CACHE_EVICTION_GRACE_MS = Number(process.env.ASSET_CACHE_EVICTION_GRACE_MS) || 60_000;

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

export type TransformAssetOptions = {
  beforeGenerate?: () => void | Promise<void>;
};

export type AssetCacheEvictionResult = {
  filesRemoved: number;
  bytesRemoved: number;
  bytesRemaining: number;
  quotaSatisfied: boolean;
};

type CacheEntry = {
  assetId: string;
  path: string;
  size: number;
  lastUsed: number;
};

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CACHE_FILE_PATTERN = new RegExp(`^(${UUID_PATTERN})-[0-9a-f]{64}\\.(?:jpeg|png|webp)$`);
const TEMP_CACHE_FILE_PATTERN = new RegExp(`^\\.tmp-${UUID_PATTERN}$`);
const VALID_ASSET_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`);
const STALE_TEMP_CACHE_MS = 60 * 60 * 1_000;
const pendingTransforms = new Map<string, Promise<Bun.BunFile>>();
let activeTransforms = 0;
const transformWaiters: Array<() => void> = [];
let evictionQueue = Promise.resolve();

function positiveLimit(value: number, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

const cacheByteLimit = positiveLimit(MAX_ASSET_CACHE_BYTES, 512 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
const cacheFileLimit = positiveLimit(MAX_ASSET_CACHE_FILES, 10_000, 1_000_000);
const cacheVariantLimit = positiveLimit(MAX_ASSET_CACHE_VARIANTS_PER_ASSET, 20, 10_000);
const transformConcurrency = positiveLimit(MAX_CONCURRENT_IMAGE_TRANSFORMS, 2, 32);
const transformQueueLimit = positiveLimit(MAX_QUEUED_IMAGE_TRANSFORMS, 32, 10_000);
const evictionGraceMs = positiveLimit(ASSET_CACHE_EVICTION_GRACE_MS, 60_000, 86_400_000);

async function acquireTransformSlot(): Promise<() => void> {
  if (activeTransforms >= transformConcurrency) {
    if (transformWaiters.length >= transformQueueLimit) {
      throw new RateLimitError("Coda trasformazioni immagini piena", {
        details: { retryAfterSeconds: 1 },
        headers: { "Retry-After": "1" },
      });
    }
    await new Promise<void>((resolveWaiter) => transformWaiters.push(resolveWaiter));
  } else {
    activeTransforms += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = transformWaiters.shift();
    if (next) next();
    else activeTransforms -= 1;
  };
}

function serializeEviction<T>(operation: () => Promise<T>): Promise<T> {
  const run = evictionQueue.then(operation, operation);
  evictionQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function cacheEntries(): Promise<CacheEntry[]> {
  await ensureAssetDirectories();
  const entries = await readdir(ASSET_CACHE_DIR, { withFileTypes: true });
  const result: CacheEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = CACHE_FILE_PATTERN.exec(entry.name);
    if (!match) continue;
    const path = join(ASSET_CACHE_DIR, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    result.push({ assetId: match[1]!, path, size: info.size, lastUsed: info.mtimeMs });
  }
  return result;
}

async function removeCacheEntry(entry: CacheEntry): Promise<boolean> {
  try {
    await rm(entry.path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeStaleTemporaryFiles(cutoff: number): Promise<{ files: number; bytes: number }> {
  const directoryEntries = await readdir(ASSET_CACHE_DIR, { withFileTypes: true });
  let files = 0;
  let bytes = 0;
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !TEMP_CACHE_FILE_PATTERN.test(entry.name)) continue;
    const path = join(ASSET_CACHE_DIR, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info || info.mtimeMs > cutoff) continue;
    if (await removeCacheEntry({ assetId: "", path, size: info.size, lastUsed: info.mtimeMs })) {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

export function evictAssetCache(options: {
  protectedPath?: string;
  now?: Date;
  respectGracePeriod?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  maxVariantsPerAsset?: number;
  graceMs?: number;
} = {}): Promise<AssetCacheEvictionResult> {
  return serializeEviction(async () => {
    const now = options.now ?? new Date();
    const maxBytes = positiveLimit(options.maxBytes ?? cacheByteLimit, cacheByteLimit, Number.MAX_SAFE_INTEGER);
    const maxFiles = positiveLimit(options.maxFiles ?? cacheFileLimit, cacheFileLimit, 1_000_000);
    const maxVariants = positiveLimit(options.maxVariantsPerAsset ?? cacheVariantLimit, cacheVariantLimit, 10_000);
    const graceMs = positiveLimit(options.graceMs ?? evictionGraceMs, evictionGraceMs, 86_400_000);
    const cutoff = now.getTime() - (options.respectGracePeriod === false ? 0 : graceMs);
    const staleTemporary = options.respectGracePeriod === false
      ? await removeStaleTemporaryFiles(now.getTime() - STALE_TEMP_CACHE_MS)
      : { files: 0, bytes: 0 };
    const entries = await cacheEntries();
    const removed = new Set<string>();
    let filesRemoved = staleTemporary.files;
    let bytesRemoved = staleTemporary.bytes;

    const removeOldest = async (
      candidates: CacheEntry[],
      needed: () => boolean,
      onRemoved: (entry: CacheEntry) => void
    ) => {
      for (const entry of candidates.sort((left, right) => left.lastUsed - right.lastUsed)) {
        if (!needed()) break;
        if (entry.path === options.protectedPath || entry.lastUsed > cutoff) continue;
        if (await removeCacheEntry(entry)) {
          removed.add(entry.path);
          filesRemoved += 1;
          bytesRemoved += entry.size;
          onRemoved(entry);
        }
      }
    };

    const perAsset = new Map<string, CacheEntry[]>();
    for (const entry of entries) {
      const list = perAsset.get(entry.assetId) ?? [];
      list.push(entry);
      perAsset.set(entry.assetId, list);
    }
    for (const variants of perAsset.values()) {
      let remaining = variants.length;
      await removeOldest(variants, () => remaining > maxVariants, () => {
        remaining -= 1;
      });
    }

    let bytesRemaining = entries
      .filter((entry) => !removed.has(entry.path))
      .reduce((total, entry) => total + entry.size, 0);
    let filesRemaining = entries.length - removed.size;
    await removeOldest(
      entries.filter((entry) => !removed.has(entry.path)),
      () => bytesRemaining > maxBytes || filesRemaining > maxFiles,
      (entry) => {
        bytesRemaining -= entry.size;
        filesRemaining -= 1;
      }
    );
    bytesRemaining = entries
      .filter((entry) => !removed.has(entry.path))
      .reduce((total, entry) => total + entry.size, 0);

    let quotaSatisfied = bytesRemaining <= maxBytes
      && entries.length - removed.size <= maxFiles
      && [...perAsset.values()].every((variants) => variants.filter((entry) => !removed.has(entry.path)).length <= maxVariants);

    if (!quotaSatisfied && options.protectedPath) {
      const protectedEntry = entries.find((entry) => entry.path === options.protectedPath);
      if (protectedEntry && await removeCacheEntry(protectedEntry)) {
        removed.add(protectedEntry.path);
        filesRemoved += 1;
        bytesRemoved += protectedEntry.size;
        bytesRemaining -= protectedEntry.size;
      }
      quotaSatisfied = false;
    }

    return { filesRemoved, bytesRemoved, bytesRemaining, quotaSatisfied };
  });
}

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
  if (!VALID_ASSET_ID_PATTERN.test(storageKey)) throw new BadRequestError("Storage key non valida");
  return join(ASSETS_DIR, storageKey);
}

function validateAssetId(assetId: string): void {
  if (!VALID_ASSET_ID_PATTERN.test(assetId)) throw new BadRequestError("Asset id non valido");
}

export async function ensureAssetDirectories() {
  await Promise.all([mkdir(ASSETS_DIR, { recursive: true }), mkdir(ASSET_CACHE_DIR, { recursive: true })]);
}

export async function inspectImage(bytes: Uint8Array) {
  try {
    return await new Bun.Image(bytes, { maxPixels: MAX_IMAGE_PIXELS, autoOrient: true }).metadata();
  } catch {
    return null;
  }
}

export async function transformAsset(
  source: string,
  assetId: string,
  transform: AssetTransform,
  options: TransformAssetOptions = {}
) {
  validateAssetId(assetId);
  await ensureAssetDirectories();
  const signature = JSON.stringify(transform);
  const digest = new Bun.CryptoHasher("sha256").update(signature).digest("hex");
  const cachePath = join(ASSET_CACHE_DIR, `${assetId}-${digest}.${transform.format}`);
  const cached = Bun.file(cachePath);
  const cachedInfo = await stat(cachePath).catch(() => null);
  if (cachedInfo?.isFile()) {
    const now = new Date();
    if (cachedInfo.mtimeMs < now.getTime() - evictionGraceMs) {
      await utimes(cachePath, now, now).catch(() => undefined);
    }
    return cached;
  }

  const pending = pendingTransforms.get(cachePath);
  if (pending) return pending;

  const generation = (async () => {
    await options.beforeGenerate?.();
    const release = await acquireTransformSlot();
    const temporaryPath = join(ASSET_CACHE_DIR, `.tmp-${Bun.randomUUIDv7()}`);
    try {
      if (await Bun.file(cachePath).exists()) return Bun.file(cachePath);
      let image = new Bun.Image(Bun.file(source), { maxPixels: MAX_IMAGE_PIXELS, autoOrient: true });
      let resizeWidth = transform.width;
      if (resizeWidth === undefined && transform.height !== undefined) {
        const metadata = await image.metadata();
        resizeWidth = Math.max(1, Math.round(metadata.width * transform.height / metadata.height));
      }
      if (resizeWidth !== undefined) {
        image = image.resize(resizeWidth, transform.height, {
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
      await image.write(temporaryPath);
      await rename(temporaryPath, cachePath);

      const eviction = await evictAssetCache({ protectedPath: cachePath });
      if (!eviction.quotaSatisfied) {
        throw new StorageQuotaError("Quota della cache immagini esaurita");
      }
      return Bun.file(cachePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      release();
    }
  })();

  pendingTransforms.set(cachePath, generation);
  try {
    return await generation;
  } finally {
    pendingTransforms.delete(cachePath);
  }
}

export async function removeAssetFiles(storageKey: string, assetId: string) {
  validateAssetId(assetId);
  await rm(assetPath(storageKey), { force: true });
  const glob = new Bun.Glob(`${assetId}-*`);
  for await (const filename of glob.scan(ASSET_CACHE_DIR)) {
    await rm(join(ASSET_CACHE_DIR, filename), { force: true });
  }
}
