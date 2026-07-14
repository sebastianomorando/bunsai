import { useEffect, useRef, useState } from "preact/hooks";
import { deleteAsset, fetchAssets, uploadAsset } from "../api.ts";
import { t } from "../i18n.ts";
import { assetsState, errorMessage, pendingState, sessionState, setError, setNotice } from "../state.ts";
import type { Asset } from "../types.ts";

const previewUrl = (asset: Asset) =>
  asset.format ? `${asset.url}?key=system-medium-contain&format=webp` : asset.url;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function AssetsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!sessionState.value) return;
    void fetchAssets().catch((error) => setError(errorMessage(error)));
  }, [sessionState.value?.userId]);

  if (!sessionState.value) {
    return (
      <div class="panel">
        <h2>{t("assets.authRequiredTitle")}</h2>
        <p>{t("assets.authRequiredText")}</p>
        <a class="button" href="/login">{t("users.goToLogin")}</a>
      </div>
    );
  }

  const onUpload = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!file) return;
    try {
      await uploadAsset(file, title);
      setFile(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      setNotice(t("assets.uploadSuccess"));
    } catch (error) {
      setError(errorMessage(error));
    }
  };

  const onCopy = async (asset: Asset) => {
    try {
      await navigator.clipboard.writeText(new URL(asset.url, location.origin).href);
      setNotice(t("assets.copySuccess"));
    } catch {
      setError(t("assets.copyError"));
    }
  };

  const onDelete = async (asset: Asset) => {
    if (!confirm(t("assets.deleteConfirm", { filename: asset.filename }))) return;
    try {
      await deleteAsset(asset.id);
      setNotice(t("assets.deleteSuccess"));
    } catch (error) {
      setError(errorMessage(error));
    }
  };

  return (
    <div class="asset-page">
      <section class="panel asset-upload">
        <div>
          <h2>{t("assets.title")}</h2>
          <p>{t("assets.description")}</p>
        </div>
        <form class="asset-upload-form" onSubmit={onUpload}>
          <label>
            <span>{t("assets.file")}</span>
            <input ref={inputRef} type="file" required onChange={(event) => setFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
          </label>
          <label>
            <span>{t("assets.assetTitle")}</span>
            <input value={title} maxLength={255} placeholder={t("assets.titlePlaceholder")} onInput={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <button class="button" type="submit" disabled={!file || pendingState.value}>
            {pendingState.value ? t("assets.uploading") : t("assets.upload")}
          </button>
        </form>
      </section>

      <div class="asset-list-heading">
        <h3>{t("assets.library")}</h3>
        <button class="button ghost" type="button" disabled={pendingState.value} onClick={() => void fetchAssets().catch((error) => setError(errorMessage(error)))}>
          {t("users.refresh")}
        </button>
      </div>

      {assetsState.value.length === 0 ? (
        <div class="panel asset-empty"><p>{t("assets.empty")}</p></div>
      ) : (
        <div class="asset-grid">
          {assetsState.value.map((asset) => (
            <article class="asset-card" key={asset.id}>
              <a class="asset-preview" href={asset.url} target="_blank" rel="noreferrer">
                {asset.format ? <img src={previewUrl(asset)} alt={asset.title || asset.filename} loading="lazy" /> : <span class="asset-file-icon" aria-hidden="true">{asset.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>}
              </a>
              <div class="asset-info">
                <strong title={asset.filename}>{asset.title || asset.filename}</strong>
                {asset.title && <span class="asset-filename">{asset.filename}</span>}
                <span>{formatBytes(asset.size)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</span>
              </div>
              <div class="asset-actions">
                <button class="button ghost" type="button" onClick={() => void onCopy(asset)}>{t("assets.copyUrl")}</button>
                <button class="button danger" type="button" disabled={pendingState.value} onClick={() => void onDelete(asset)}>{t("assets.delete")}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
