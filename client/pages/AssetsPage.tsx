import { useEffect, useRef, useState } from "preact/hooks";
import { deleteAsset, fetchAssets, updateAsset, uploadAsset } from "../api";
import {
  assetsState,
  errorMessage,
  pendingState,
  sessionState,
  setError,
  setNotice,
} from "../state";
import { t, localeState } from "../i18n";
import type {
  Asset,
  AssetList,
  AssetSortBy,
  AssetType,
  SortDirection,
} from "../types";

const emptyList: AssetList = {
  items: [],
  total: 0,
  limit: 24,
  offset: 0,
  sortBy: "dateCreated",
  sortDir: "desc",
};
const typeLabels = (): Record<AssetType, string> => ({
  all: t("media.allMedia"),
  image: t("media.images"),
  video: t("media.video"),
  audio: t("media.audio"),
  document: t("media.documents"),
  other: t("media.other"),
});

const isImage = (asset: Asset) => !!asset.format;
const previewUrl = (asset: Asset) =>
  asset.format
    ? `${asset.url}?key=system-medium-contain&format=webp`
    : asset.url;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(
    localeState.value === "it" ? "it-IT" : "en-GB",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  ).format(new Date(value));
}

function AssetVisual({
  asset,
  compact = false,
}: {
  asset: Asset;
  compact?: boolean;
}) {
  if (isImage(asset))
    return (
      <img
        src={previewUrl(asset)}
        alt={asset.title || asset.filename}
        loading="lazy"
      />
    );
  return (
    <span
      class={`asset-file-icon${compact ? " is-compact" : ""}`}
      aria-hidden="true"
    >
      {asset.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}
    </span>
  );
}

function AssetPagination({
  list,
  busy,
  position,
  onOffset,
  onLimit,
}: {
  list: AssetList;
  busy: boolean;
  position: "top" | "bottom";
  onOffset: (offset: number) => void;
  onLimit: (limit: number) => void;
}) {
  const page = Math.floor(list.offset / list.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(list.total / list.limit));
  return (
    <nav
      class={`asset-pagination asset-pagination-${position}`}
      aria-label={t("media.pagination")}
    >
      <span>
        {t("media.pageSummary", { count: list.total, page, pages: totalPages })}
      </span>
      <label>
        <span class="visually-hidden">{t("media.perPage")}</span>
        <select
          aria-label={t("media.perPage")}
          value={String(list.limit)}
          onChange={(event) => onLimit(Number(event.currentTarget.value))}
        >
          <option value="12">12</option>
          <option value="24">24</option>
          <option value="48">48</option>
          <option value="96">96</option>
        </select>
      </label>
      <button
        type="button"
        class="button ghost"
        aria-label={t("media.previous")}
        disabled={busy || page <= 1}
        onClick={() => onOffset(Math.max(0, list.offset - list.limit))}
      >
        ←
      </button>
      <button
        type="button"
        class="button ghost"
        aria-label={t("media.next")}
        disabled={busy || page >= totalPages}
        onClick={() => onOffset(list.offset + list.limit)}
      >
        →
      </button>
    </nav>
  );
}

export function AssetsPage() {
  const owner = sessionState.value?.userId;
  if (!owner)
    return (
      <section class="panel">
        <h2>{t("assets.authRequiredTitle")}</h2>
        <p>{t("assets.authRequiredText")}</p>
        <a class="button" href="/login">
          {t("users.goToLogin")}
        </a>
      </section>
    );
  return <AssetWorkspace key={owner} owner={owner} />;
}
function AssetWorkspace({ owner }: { owner: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loadController = useRef<AbortController | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const busy = working || pendingState.value;
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [list, setList] = useState<AssetList>(emptyList);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [type, setType] = useState<AssetType>("all");
  const [sortBy, setSortBy] = useState<AssetSortBy>("dateCreated");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [limit, setLimit] = useState(24);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFilename, setEditFilename] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const detail =
    assetsState.value.find((asset) => asset.id === detailId) ?? null;

  const load = async (
    offset = 0,
    overrides: Partial<{
      q: string;
      type: AssetType;
      sortBy: AssetSortBy;
      sortDir: SortDirection;
      limit: number;
    }> = {},
  ) => {
    if (sessionState.value?.userId !== owner) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const result = await fetchAssets(
        {
          q: overrides.q ?? appliedQuery,
          type: overrides.type ?? type,
          sortBy: overrides.sortBy ?? sortBy,
          sortDir: overrides.sortDir ?? sortDir,
          limit: overrides.limit ?? limit,
          offset,
        },
        controller.signal,
      );
      if (controller.signal.aborted || sessionState.value?.userId !== owner)
        return;
      setList(result);
      setSelectedIds([]);
      if (detailId && !result.items.some((asset) => asset.id === detailId))
        setDetailId(null);
    } catch (error) {
      if (!controller.signal.aborted && sessionState.value?.userId === owner)
        setError(errorMessage(error));
    }
  };

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, []);
  useEffect(() => {
    if (detail) dialogRef.current?.showModal();
  }, [detailId]);
  const chooseFiles = (nextFiles: FileList | File[]) => {
    if (busy) return;
    const next = Array.from(nextFiles);
    const maximum = list.maxFileBytes ?? 25 * 1024 * 1024;
    if (
      next.length > 20 ||
      next.some((file) => !file.size || file.size > maximum)
    ) {
      setError(t("media.invalidFiles", { size: formatBytes(maximum) }));
      return;
    }
    setFiles(next);
  };
  const onUpload = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!files.length || working) return;
    setWorking(true);
    setProgress(0);
    let uploaded = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (sessionState.value?.userId !== owner) return;
        setProgress(index + 1);
        await uploadAsset(
          file,
          files.length === 1 || index === 0 ? title : undefined,
        );
        if (sessionState.value?.userId !== owner) return;
        uploaded += 1;
      }
      setFiles([]);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      setNotice(t("media.uploadedCount", { count: uploaded }));
      await load(0);
    } catch (error) {
      if (sessionState.value?.userId === owner) setError(errorMessage(error));
      setFiles(files.slice(uploaded));
      if (uploaded > 0) setTitle("");
      if (uploaded > 0) await load(0);
    } finally {
      setWorking(false);
    }
  };
  const copyUrl = async (asset: Asset, variant?: string) => {
    try {
      await navigator.clipboard.writeText(
        new URL(
          variant ? `${asset.url}?key=${variant}&format=webp` : asset.url,
          location.origin,
        ).href,
      );
      setNotice(t("assets.copySuccess"));
      if (detailId) {
        setDetailError(null);
        setDetailNotice(t("assets.copySuccess"));
      }
    } catch {
      setError(t("assets.copyError"));
      if (detailId) setDetailError(t("assets.copyError"));
    }
  };
  const openDetail = (asset: Asset) => {
    setDetailError(null);
    setDetailNotice(null);
    setDetailId(asset.id);
    setEditTitle(asset.title ?? "");
    setEditFilename(asset.filename);
  };
  const removeAssets = async (ids: string[]) => {
    if (
      !ids.length ||
      working ||
      !confirm(t("media.deleteConfirm", { count: ids.length }))
    )
      return;
    setWorking(true);
    let deleted = 0;
    try {
      for (const id of ids) {
        if (sessionState.value?.userId !== owner) return;
        await deleteAsset(id);
        if (sessionState.value?.userId !== owner) return;
        deleted += 1;
      }
      if (detailId && ids.includes(detailId)) setDetailId(null);
      setNotice(t("media.deleted", { count: deleted }));
      const remaining = Math.max(0, list.total - deleted);
      const lastOffset = Math.max(
        0,
        (Math.max(1, Math.ceil(remaining / list.limit)) - 1) * list.limit,
      );
      await load(Math.min(list.offset, lastOffset));
    } catch (error) {
      if (sessionState.value?.userId === owner) setError(errorMessage(error));
      if (deleted > 0) {
        const remaining = Math.max(0, list.total - deleted);
        const lastOffset = Math.max(
          0,
          (Math.max(1, Math.ceil(remaining / list.limit)) - 1) * list.limit,
        );
        await load(Math.min(list.offset, lastOffset));
      }
    } finally {
      setWorking(false);
    }
  };
  const saveMetadata = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!detail || working) return;
    setWorking(true);
    setDetailError(null);
    setDetailNotice(null);
    try {
      const updated = await updateAsset(detail.id, {
        title: editTitle || null,
        filename: editFilename,
        version: detail.version,
      });
      if (sessionState.value?.userId !== owner) return;
      setEditTitle(updated.title ?? "");
      setEditFilename(updated.filename);
      setNotice(t("media.metadataSaved"));
      setDetailNotice(t("media.metadataSaved"));
    } catch (error) {
      if (sessionState.value?.userId === owner) {
        setError(errorMessage(error));
        setDetailError(errorMessage(error));
      }
    } finally {
      setWorking(false);
    }
  };
  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const selectAll = () =>
    setSelectedIds(
      selectedIds.length === assetsState.value.length
        ? []
        : assetsState.value.map((asset) => asset.id),
    );
  const changeType = (nextType: AssetType) => {
    setType(nextType);
    void load(0, { type: nextType });
  };
  const changeSort = (nextSort: AssetSortBy, nextDirection = sortDir) => {
    setSortBy(nextSort);
    setSortDir(nextDirection);
    void load(0, { sortBy: nextSort, sortDir: nextDirection });
  };
  const changeLimit = (nextLimit: number) => {
    setLimit(nextLimit);
    void load(0, { limit: nextLimit });
  };

  return (
    <div class="asset-manager">
      <header class="asset-manager-header">
        <div>
          <p class="eyebrow">{t("media.library")}</p>
          <h1>{t("assets.title")}</h1>
          <p>{t("media.description")}</p>
        </div>
        <div class="rowactions">
          <button
            type="button"
            class="button ghost"
            disabled={busy}
            onClick={() => void load(list.offset)}
          >
            {t("users.refresh")}
          </button>
          <button
            type="button"
            class="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t("media.add")}
          </button>
        </div>
      </header>

      <section class="panel asset-upload-panel">
        <form onSubmit={onUpload}>
          <label
            class={`asset-dropzone${dragActive ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              chooseFiles(event.dataTransfer?.files ?? []);
            }}
          >
            <input
              disabled={busy}
              aria-label={t("assets.file")}
              ref={inputRef}
              type="file"
              multiple
              onChange={(event) => chooseFiles(event.currentTarget.files ?? [])}
            />
            <span class="asset-drop-icon" aria-hidden="true">
              ⇧
            </span>
            <strong>
              {files.length
                ? t("media.filesReady", { count: files.length })
                : t("media.drop")}
            </strong>
            <small>
              {t("media.dropHint", {
                size: formatBytes(list.maxFileBytes ?? 25 * 1024 * 1024),
              })}
            </small>
          </label>
          <div class="asset-upload-meta">
            <label>
              {t("media.title")}{" "}
              {files.length > 1 && <span>{t("media.firstTitle")}</span>}
              <input
                maxLength={255}
                value={title}
                onInput={(event) => setTitle(event.currentTarget.value)}
                placeholder={t("media.titlePlaceholder")}
              />
            </label>
            <button class="button" disabled={!files.length || busy}>
              {busy
                ? t("media.progress", {
                    current: progress,
                    total: files.length,
                  })
                : t("media.uploadLibrary")}
            </button>
          </div>
        </form>
      </section>

      <section class="panel asset-library-panel" aria-busy={busy}>
        <fieldset class="asset-library-controls" disabled={busy}>
          <div class="asset-manager-toolbar">
            <form
              class="asset-search"
              onSubmit={(event) => {
                event.preventDefault();
                const next = query.trim();
                setAppliedQuery(next);
                void load(0, { q: next });
              }}
            >
              <label>
                <span class="visually-hidden">{t("media.search")}</span>
                <input
                  maxLength={100}
                  value={query}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder={t("media.searchPlaceholder")}
                />
              </label>
              <button class="button ghost">{t("media.searchButton")}</button>
              {appliedQuery && (
                <button
                  type="button"
                  class="button text"
                  onClick={() => {
                    setQuery("");
                    setAppliedQuery("");
                    void load(0, { q: "" });
                  }}
                >
                  {t("media.reset")}
                </button>
              )}
            </form>
            <div class="asset-toolbar-controls">
              <label>
                <span class="visually-hidden">{t("media.mediaType")}</span>
                <select
                  aria-label={t("media.mediaType")}
                  value={type}
                  onChange={(event) =>
                    changeType(event.currentTarget.value as AssetType)
                  }
                >
                  {Object.entries(typeLabels()).map(([value, label]) => (
                    <option value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span class="visually-hidden">{t("media.sort")}</span>
                <select
                  aria-label={t("media.sort")}
                  value={sortBy}
                  onChange={(event) =>
                    changeSort(event.currentTarget.value as AssetSortBy)
                  }
                >
                  <option value="dateCreated">{t("media.created")}</option>
                  <option value="title">{t("media.title")}</option>
                  <option value="filename">{t("media.filename")}</option>
                  <option value="size">{t("media.size")}</option>
                </select>
              </label>
              <button
                type="button"
                class="asset-sort-direction"
                aria-label={
                  sortDir === "asc"
                    ? t("media.ascending")
                    : t("media.descending")
                }
                onClick={() =>
                  changeSort(sortBy, sortDir === "asc" ? "desc" : "asc")
                }
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
              <div
                class="asset-view-toggle"
                role="group"
                aria-label={t("media.view")}
              >
                <button
                  type="button"
                  aria-pressed={view === "grid"}
                  class={view === "grid" ? "is-active" : ""}
                  onClick={() => setView("grid")}
                  aria-label={t("media.grid")}
                >
                  ▦
                </button>
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  class={view === "list" ? "is-active" : ""}
                  onClick={() => setView("list")}
                  aria-label={t("media.list")}
                >
                  ☷
                </button>
              </div>
            </div>
          </div>

          <div class="asset-bulk-bar">
            <label>
              <input
                type="checkbox"
                checked={
                  assetsState.value.length > 0 &&
                  selectedIds.length === assetsState.value.length
                }
                onChange={selectAll}
              />{" "}
              {t("media.selectPage")}
            </label>
            {selectedIds.length > 0 && (
              <>
                <span>
                  {t("media.selected", { count: selectedIds.length })}
                </span>
                <button
                  type="button"
                  class="button danger"
                  disabled={busy}
                  onClick={() => void removeAssets(selectedIds)}
                >
                  {t("media.deleteSelected")}
                </button>
              </>
            )}
            <AssetPagination
              list={list}
              busy={busy}
              position="top"
              onOffset={(offset) => void load(offset)}
              onLimit={changeLimit}
            />
          </div>

          {assetsState.value.length === 0 ? (
            <div class="asset-manager-empty">
              <span aria-hidden="true">◇</span>
              <h3>{t("media.noResults")}</h3>
              <p>{t("media.noResultsHint")}</p>
            </div>
          ) : view === "grid" ? (
            <div class="asset-manager-grid">
              {assetsState.value.map((asset) => (
                <article
                  class={`asset-manager-card${selectedIds.includes(asset.id) ? " is-selected" : ""}`}
                  key={asset.id}
                >
                  <label class="asset-select">
                    <input
                      type="checkbox"
                      aria-label={t("media.select", {
                        filename: asset.filename,
                      })}
                      checked={selectedIds.includes(asset.id)}
                      onChange={() => toggleSelected(asset.id)}
                    />
                    <span class="visually-hidden">
                      {t("media.select", { filename: asset.filename })}
                    </span>
                  </label>
                  <button
                    type="button"
                    class="asset-preview"
                    onClick={() => openDetail(asset)}
                  >
                    <AssetVisual asset={asset} />
                  </button>
                  <button
                    type="button"
                    class="asset-card-info"
                    onClick={() => openDetail(asset)}
                  >
                    <strong title={asset.title || asset.filename}>
                      {asset.title || asset.filename}
                    </strong>
                    <span title={asset.filename}>{asset.filename}</span>
                    <small>
                      {formatBytes(asset.size)}
                      {asset.width && asset.height
                        ? ` · ${asset.width}×${asset.height}`
                        : ""}
                    </small>
                  </button>
                  <div class="asset-card-actions">
                    <button type="button" onClick={() => void copyUrl(asset)}>
                      {t("assets.copyUrl")}
                    </button>
                    <button type="button" onClick={() => openDetail(asset)}>
                      {t("media.details")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div class="asset-table-scroll">
              <table class="asset-manager-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>{t("assets.file")}</th>
                    <th>{t("media.type")}</th>
                    <th>{t("media.size")}</th>
                    <th>{t("media.uploaded")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {assetsState.value.map((asset) => (
                    <tr
                      class={
                        selectedIds.includes(asset.id) ? "is-selected" : ""
                      }
                      key={asset.id}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={t("media.select", {
                            filename: asset.filename,
                          })}
                          checked={selectedIds.includes(asset.id)}
                          onChange={() => toggleSelected(asset.id)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          class="asset-table-name"
                          onClick={() => openDetail(asset)}
                        >
                          <span class="asset-table-preview">
                            <AssetVisual asset={asset} compact />
                          </span>
                          <span>
                            <strong>{asset.title || asset.filename}</strong>
                            <small>{asset.filename}</small>
                          </span>
                        </button>
                      </td>
                      <td data-label={t("media.type")}>{asset.mimeType}</td>
                      <td data-label={t("media.size")}>
                        {formatBytes(asset.size)}
                      </td>
                      <td data-label={t("media.uploaded")}>
                        {formatDate(asset.dateCreated)}
                      </td>
                      <td>
                        <button
                          type="button"
                          class="button ghost"
                          onClick={() => openDetail(asset)}
                        >
                          {t("media.details")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AssetPagination
            list={list}
            busy={busy}
            position="bottom"
            onOffset={(offset) => void load(offset)}
            onLimit={changeLimit}
          />
        </fieldset>
      </section>

      {detail && (
        <dialog
          ref={dialogRef}
          class="asset-detail-panel"
          aria-labelledby="asset-detail-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!working) setDetailId(null);
          }}
        >
          <header>
            <div>
              <p class="eyebrow">{t("media.mediaDetails")}</p>
              <h2 id="asset-detail-title">{detail.title || detail.filename}</h2>
            </div>
            <button
              type="button"
              class="asset-detail-close"
              disabled={working}
              aria-label={t("media.closeDetails")}
              onClick={() => setDetailId(null)}
            >
              ×
            </button>
          </header>
          <div class="asset-detail-preview">
            <AssetVisual asset={detail} />
          </div>
          <form class="asset-detail-form" onSubmit={saveMetadata}>
            {detailError && (
              <p class="banner error" role="alert">
                {detailError}
              </p>
            )}
            {detailNotice && (
              <p class="banner success" role="status">
                {detailNotice}
              </p>
            )}
            <label>
              {t("media.title")}
              <input
                maxLength={255}
                value={editTitle}
                onInput={(event) => setEditTitle(event.currentTarget.value)}
              />
            </label>
            <label>
              {t("media.filename")}
              <input
                required
                maxLength={255}
                value={editFilename}
                onInput={(event) => setEditFilename(event.currentTarget.value)}
              />
            </label>
            <button class="button" disabled={busy}>
              {t("media.save")}
            </button>
          </form>
          <dl class="asset-detail-meta">
            <div>
              <dt>URL</dt>
              <dd>
                <button type="button" onClick={() => void copyUrl(detail)}>
                  {t("media.copyOriginal")}
                </button>
              </dd>
            </div>
            <div>
              <dt>{t("media.type")}</dt>
              <dd>{detail.mimeType}</dd>
            </div>
            <div>
              <dt>{t("media.size")}</dt>
              <dd>{formatBytes(detail.size)}</dd>
            </div>
            {detail.width && detail.height && (
              <div>
                <dt>{t("media.dimensions")}</dt>
                <dd>
                  {detail.width} × {detail.height} px
                </dd>
              </div>
            )}
            <div>
              <dt>{t("media.uploaded")}</dt>
              <dd>{formatDate(detail.dateCreated)}</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>{detail.id}</dd>
            </div>
          </dl>
          {detail.format && (
            <section class="asset-variants">
              <h3>{t("media.variants")}</h3>
              <p>{t("media.variantsHint")}</p>
              <div>
                <button
                  type="button"
                  onClick={() => void copyUrl(detail, "system-small-cover")}
                >
                  {t("media.thumbnail")}
                </button>
                <button
                  type="button"
                  onClick={() => void copyUrl(detail, "system-large-contain")}
                >
                  {t("media.large")}
                </button>
              </div>
            </section>
          )}
          <footer>
            <a
              class="button ghost"
              href={detail.url}
              target="_blank"
              rel="noreferrer"
            >
              {t("media.original")}
            </a>
            <button
              type="button"
              class="button danger"
              onClick={() => void removeAssets([detail.id])}
            >
              {t("media.deleteAsset")}
            </button>
          </footer>
        </dialog>
      )}
    </div>
  );
}
