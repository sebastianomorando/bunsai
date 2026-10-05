import { ValidationError } from "./errors";
export const ASSET_TYPES = [
  "all",
  "image",
  "video",
  "audio",
  "document",
  "other",
] as const;
export const ASSET_SORT_FIELDS = [
  "dateCreated",
  "title",
  "filename",
  "size",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];
function integer(value: string | null, fallback: number, max: number, min = 0) {
  const number = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new ValidationError("Paginazione non valida");
  return number;
}
export function parseAssetListQuery(url: URL) {
  const params = url.searchParams,
    q = (params.get("q") ?? "").trim(),
    type = params.get("type") ?? "all",
    sortBy = params.get("sortBy") ?? "dateCreated",
    sortDir = params.get("sortDir") ?? "desc";
  if (
    q.length > 100 ||
    /[\x00-\x1f\x7f]/.test(q) ||
    !ASSET_TYPES.includes(type as AssetType) ||
    !ASSET_SORT_FIELDS.includes(sortBy as AssetSortField) ||
    !["asc", "desc"].includes(sortDir)
  )
    throw new ValidationError("Filtri non validi");
  return {
    q: q || null,
    type: type as AssetType,
    sortBy: sortBy as AssetSortField,
    sortDir: sortDir as "asc" | "desc",
    limit: integer(params.get("limit"), 24, 100, 1),
    offset: integer(params.get("offset"), 0, 100000),
  };
}
export function parseAssetMetadataInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("Metadati non validi");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["title", "filename", "version"].includes(key),
    ) ||
    typeof input.filename !== "string" ||
    typeof input.version !== "string" ||
    !/^\d{1,10}$/.test(input.version) ||
    (input.title !== null && typeof input.title !== "string")
  )
    throw new ValidationError("Metadati non validi");
  const filename = input.filename.trim(),
    title = typeof input.title === "string" ? input.title.trim() : "";
  if (
    !filename ||
    filename.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(filename) ||
    title.length > 255 ||
    /[\x00-\x1f\x7f]/.test(title)
  )
    throw new ValidationError("Nome file o titolo non valido");
  return { filename, title: title || null, version: input.version };
}
