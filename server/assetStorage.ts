import { S3Client } from "bun";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BadRequestError, HttpError, NotFoundError, RateLimitError, ValidationError } from "./errors";

export type AssetStorageKind = "local" | "s3";
export const ASSETS_DIR = resolve(process.env.ASSETS_DIR ?? "./data/assets");
const configuredMaxBytes = Number(process.env.MAX_ASSET_BYTES ?? 25 * 1024 * 1024);
export const MAX_ASSET_BYTES = Number.isSafeInteger(configuredMaxBytes)
  && configuredMaxBytes > 0 && configuredMaxBytes <= 100 * 1024 * 1024
  ? configuredMaxBytes : 25 * 1024 * 1024;

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new BadRequestError("Storage key non valida");
}

export function assetPath(key: string): string {
  validateStorageKey(key);
  return join(ASSETS_DIR, key);
}

export interface AssetStorage {
  readonly kind: AssetStorageKind;
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string): Promise<Blob>;
  remove(key: string): Promise<void>;
}

type Environment = Record<string, string | undefined>;

export function assetStorageKind(value = process.env.ASSET_STORAGE ?? "local"): AssetStorageKind {
  if (value !== "local" && value !== "s3") throw new Error("ASSET_STORAGE deve essere local o s3");
  return value;
}

export function assetS3Options(env: Environment = process.env): Bun.S3Options {
  const bucket = (env.S3_BUCKET ?? env.AWS_BUCKET)?.trim();
  const accessKeyId = (env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID)?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    || bucket.includes("..") || !accessKeyId || !secretAccessKey) {
    throw new Error("Configurazione S3 incompleta o non valida");
  }
  const endpoint = (env.S3_ENDPOINT ?? env.AWS_ENDPOINT)?.trim() || undefined;
  if (endpoint) {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error("S3_ENDPOINT non valido"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || (env.NODE_ENV === "production" && url.protocol !== "https:")) {
      throw new Error("S3_ENDPOINT non valido: usare HTTPS in produzione e nessuna credenziale nell’URL");
    }
  }
  const virtualHostedStyle = env.S3_VIRTUAL_HOSTED_STYLE ?? "false";
  if (!["true", "false"].includes(virtualHostedStyle)) throw new Error("S3_VIRTUAL_HOSTED_STYLE non valido");
  return {
    bucket, accessKeyId, secretAccessKey, endpoint,
    region: env.S3_REGION ?? env.AWS_REGION ?? "us-east-1",
    sessionToken: env.S3_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN ?? "",
    virtualHostedStyle: virtualHostedStyle === "true",
    retry: 2,
    queueSize: 2,
    partSize: 5 * 1024 * 1024,
  };
}

function storageError(error: unknown): Error {
  const code = (error as { code?: string } | null)?.code;
  if (code === "NoSuchKey" || code === "NotFound" || code === "ENOENT") {
    return new NotFoundError("File asset non trovato");
  }
  // Do not retain the provider error: it can contain credentials, URLs or XML.
  return new HttpError(503, "Storage asset non disponibile", { code: "ASSET_STORAGE_UNAVAILABLE" });
}

function checkUpload(bytes: Uint8Array): void {
  if (!bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES) throw new ValidationError("File troppo grande o vuoto");
}

export class LocalAssetStorage implements AssetStorage {
  readonly kind = "local";
  constructor(private readonly root = ASSETS_DIR) {}
  private path(key: string): string { validateStorageKey(key); return join(this.root, key); }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const target = this.path(key);
    checkUpload(bytes);
    const temporary = join(this.root, `.tmp-${Bun.randomUUIDv7()}`);
    try {
      await mkdir(this.root, { recursive: true });
      await Bun.write(Bun.file(temporary, { type: contentType }), bytes);
      await rename(temporary, target);
    } catch (error) { throw storageError(error); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  async read(key: string): Promise<Blob> {
    const file = Bun.file(this.path(key));
    try {
      if (!await file.exists()) throw new NotFoundError("File asset non trovato");
      return file;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      throw storageError(error);
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.path(key);
    try { await rm(path, { force: true }); } catch (error) { throw storageError(error); }
  }
}

export class S3AssetStorage implements AssetStorage {
  readonly kind = "s3";
  private readonly client: S3Client;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: Bun.S3Options = assetS3Options()) { this.client = new S3Client(options); }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= 4) {
      if (this.waiters.length >= 32) throw new RateLimitError("Storage asset occupato");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else this.active += 1;
    try { return await operation(); }
    finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    validateStorageKey(key);
    checkUpload(bytes);
    await this.run(async () => {
      try { await this.client.write(key, bytes, { type: contentType }); }
      catch (error) { throw storageError(error); }
    });
  }

  async read(key: string): Promise<Blob> {
    validateStorageKey(key);
    return this.run(async () => {
      try {
        const file = this.client.file(key);
        const info = await file.stat();
        if (!Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_ASSET_BYTES) {
          throw new ValidationError("File asset troppo grande");
        }
        // Bound the range even if the object changes between HEAD and GET.
        const reader = file.slice(0, MAX_ASSET_BYTES + 1).stream().getReader();
        const chunks: ArrayBuffer[] = [];
        let totalBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_ASSET_BYTES) throw new ValidationError("File asset troppo grande");
            chunks.push(new Uint8Array(value).buffer);
          }
          return new Blob(chunks);
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        throw storageError(error);
      }
    });
  }

  async remove(key: string): Promise<void> {
    validateStorageKey(key);
    await this.run(async () => {
      try { await this.client.delete(key); }
      catch (error) {
        if (storageError(error) instanceof NotFoundError) return;
        throw storageError(error);
      }
    });
  }
}

const localStorage = new LocalAssetStorage();
let s3Storage: S3AssetStorage | undefined;

export function getAssetStorage(kind: AssetStorageKind = assetStorageKind()): AssetStorage {
  if (kind === "local") return localStorage;
  if (kind !== "s3") throw new Error("Backend asset non valido");
  return s3Storage ??= new S3AssetStorage();
}

export function validateAssetStorageConfiguration(): void {
  getAssetStorage();
}
