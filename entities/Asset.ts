import { sql } from "bun";
import Session from "./Session";
import { Args, Param, Req, RequireAuth, RequireOwner, Route, Server } from "../server/decorators";
import { BadRequestError, NotFoundError, ValidationError } from "../server/errors";
import { MAX_ASSET_BYTES, inspectImage, parseAssetTransform, removeAssetFiles, transformAsset } from "../server/assets";
import { getAssetStorage } from "../server/assetStorage";
import type { AssetStorageKind } from "../server/assetStorage";
import { enforceRequestRateLimit } from "../server/rateLimit";

type AssetRecord = {
  id: string; storage_key: string; storage_backend: AssetStorageKind; filename: string; title: string | null;
  mime_type: string; size: number; width: number | null; height: number | null;
  image_format: string | null; uploaded_by: string; date_created: Date; date_updated: Date | null;
};

function publicAsset(row: AssetRecord) {
  return {
    id: row.id, filename: row.filename, title: row.title, mimeType: row.mime_type,
    size: Number(row.size), width: row.width, height: row.height, format: row.image_format,
    uploadedBy: row.uploaded_by, dateCreated: row.date_created, dateUpdated: row.date_updated,
    url: `/assets/${row.id}`,
  };
}

function imageMime(format: string | undefined) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "gif") return "image/gif";
  if (format === "bmp") return "image/bmp";
  return null;
}

async function findAsset(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundError("Asset non trovato");
  const rows = await sql`SELECT * FROM assets WHERE id = ${id}`;
  if (!rows.length) throw new NotFoundError("Asset non trovato");
  return rows[0] as AssetRecord;
}

class Asset {
  @Route("POST", "/api/assets")
  @RequireAuth()
  @Args(Req(), Server())
  static async upload(req: Bun.BunRequest, server: Bun.Server<unknown>) {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_ASSET_BYTES + 1_000_000) throw new ValidationError("File troppo grande");
    const storage = getAssetStorage();
    if (storage.kind === "s3") await enforceRequestRateLimit("s3AssetUpload", req, server);
    const form = await req.formData().catch(() => { throw new BadRequestError("Richiesta multipart/form-data non valida"); });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Il campo file è obbligatorio");
    if (!file.size || file.size > MAX_ASSET_BYTES) throw new ValidationError(`Il file deve essere inferiore a ${MAX_ASSET_BYTES} byte`);
    const session = await Session.getFromRequest(req);
    if (!session) throw new BadRequestError("Sessione non disponibile");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = await inspectImage(bytes);
    const id = Bun.randomUUIDv7();
    const storageKey = Bun.randomUUIDv7();
    const mimeType = imageMime(image?.format) ?? (file.type || "application/octet-stream");
    await storage.write(storageKey, bytes, mimeType);
    try {
      const rows = await sql`
        INSERT INTO assets (id, storage_key, storage_backend, filename, title, mime_type, size, width, height, image_format, uploaded_by)
        VALUES (${id}, ${storageKey}, ${storage.kind}, ${file.name.slice(0, 255) || "file"}, ${String(form.get("title") || "").slice(0, 255) || null}, ${mimeType}, ${file.size}, ${image?.width ?? null}, ${image?.height ?? null}, ${image?.format ?? null}, ${session.userId})
        RETURNING *`;
      return Response.json(publicAsset(rows[0] as AssetRecord), { status: 201 });
    } catch (error) {
      await removeAssetFiles(storageKey, id, storage.kind).catch(() => undefined);
      throw error;
    }
  }

  @Route("GET", "/api/assets")
  @RequireAuth()
  @Args(Req())
  static async list(req: Bun.BunRequest) {
    const session = await Session.getFromRequest(req);
    if (!session) throw new BadRequestError("Sessione non disponibile");
    const rows = await sql`
      SELECT * FROM assets
      WHERE uploaded_by = ${session.userId}
      ORDER BY date_created DESC
      LIMIT 100
    `;
    return { items: (rows as AssetRecord[]).map(publicAsset) };
  }

  @Route("GET", "/api/assets/:id")
  @RequireOwner({
    param: "id",
    bypassRoles: [],
    resolve: async (req) => (await findAsset((req as Bun.BunRequest & { params?: Record<string, string> }).params?.id ?? "")).uploaded_by,
  })
  @Args(Param("id"))
  static async metadata(id: string) {
    return publicAsset(await findAsset(id));
  }

  @Route("GET", "/assets/:id")
  @Args(Param("id"), Req(), Server())
  static async download(id: string, req: Bun.BunRequest, server: Bun.Server<unknown>) {
    const asset = await findAsset(id);
    const transform = parseAssetTransform(new URL(req.url), req.headers.get("accept") || "");
    if (transform && !asset.image_format) throw new ValidationError("Questo asset non è un'immagine trasformabile");
    const storage = getAssetStorage(asset.storage_backend);
    if (!transform && storage.kind === "s3") await enforceRequestRateLimit("s3AssetDownload", req, server);
    const file = transform
      ? await transformAsset(() => storage.read(asset.storage_key), asset.id, transform, {
          beforeGenerate: () => enforceRequestRateLimit("imageTransform", req, server),
        })
      : await storage.read(asset.storage_key);
    const headers = new Headers({
      "Content-Type": transform ? file.type : asset.mime_type,
      "Cache-Control": transform ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "Content-Disposition": `${asset.image_format ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      "X-Content-Type-Options": "nosniff",
    });
    return new Response(file, { headers });
  }

  @Route("DELETE", "/api/assets/:id")
  @RequireOwner({ param: "id", resolve: async (req) => (await findAsset((req as any).params?.id)).uploaded_by })
  @Args(Param("id"))
  static async delete(id: string) {
    const asset = await findAsset(id);
    await removeAssetFiles(asset.storage_key, asset.id, asset.storage_backend);
    await sql`DELETE FROM assets WHERE id = ${id}`;
    return new Response(null, { status: 204 });
  }
}

export default Asset;
