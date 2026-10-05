import { useEffect, useRef, useState } from 'preact/hooks';
import { AVATAR_SIZE, avatarCropRectangle, panAvatarCrop, supportedAvatarBytes, validAvatarFile, type CropPosition } from '../avatarCrop';
import { t } from '../i18n';
import { errorMessage } from '../state';

type Props = { file: File; onCancel: () => void; onConfirm: (file: File) => Promise<void> };
export function AvatarCropper({ file, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [position, setPosition] = useState<CropPosition>({ x: 0.5, y: 0.5, zoom: 1 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => { modal?.close(); document.documentElement.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    const photo = new Image();
    void (async () => {
      if (!validAvatarFile(file) || !supportedAvatarBytes(new Uint8Array(await file.slice(0,32).arrayBuffer()))) throw new Error(t('profile.cropInvalid'));
      if (cancelled) return;
      url = URL.createObjectURL(file);
      photo.onload = () => {
        if (cancelled) return;
        try {
          avatarCropRectangle(photo.naturalWidth, photo.naturalHeight, {x:0.5,y:0.5,zoom:1});
          setImage(photo);
        } catch { setError(t('profile.cropInvalid')); }
      };
      photo.onerror = () => { if (!cancelled) setError(t('profile.cropInvalid')); };
      photo.src = url;
    })().catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; photo.onload = null; photo.onerror = null; photo.src = ''; if (url) URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!image || !context) return;
    const crop = avatarCropRectangle(image.naturalWidth, image.naturalHeight, position);
    context.clearRect(0,0,AVATAR_SIZE,AVATAR_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image,crop.x,crop.y,crop.size,crop.size,0,0,AVATAR_SIZE,AVATAR_SIZE);
  }, [image,position]);

  const confirm = async () => {
    if (!image || !canvas.current || saving) return;
    setSaving(true); setError(null);
    try {
      const output = document.createElement('canvas');
      output.width = output.height = AVATAR_SIZE;
      const context = output.getContext('2d');
      if (!context) throw new Error(t('profile.cropFailed'));
      const crop = avatarCropRectangle(image.naturalWidth,image.naturalHeight,position);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image,crop.x,crop.y,crop.size,crop.size,0,0,AVATAR_SIZE,AVATAR_SIZE);
      const blob = await new Promise<Blob>((resolve,reject) => output.toBlob(value => value ? resolve(value) : reject(new Error(t('profile.cropFailed'))), 'image/png'));
      // A fixed raster canvas strips EXIF/location metadata and never uploads SVG.
      await onConfirm(new File([blob], 'profile-picture.png', {type:'image/png'}));
    } catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  };

  return <dialog ref={dialog} class="avatar-crop-dialog" aria-labelledby="avatar-crop-title" aria-describedby="avatar-crop-instructions" onCancel={event => { event.preventDefault(); if (!saving) onCancel(); }}>
    <h2 id="avatar-crop-title">{t('profile.cropTitle')}</h2>
    <p id="avatar-crop-instructions" class="muted">{t('profile.cropInstructions')}</p>
    {!image ? <p role="status">{error ? t('profile.cropFailed') : t('profile.cropLoading')}</p> : <>
      <div class="avatar-crop-stage" role="group" aria-label={t('profile.cropArea')} tabIndex={0}
        onPointerDown={event => { if (saving) return; drag.current = {id:event.pointerId,x:event.clientX,y:event.clientY}; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
        onPointerMove={event => {
          const previous = drag.current;
          if (!previous || previous.id !== event.pointerId || saving) return;
          const dx=event.clientX-previous.x, dy=event.clientY-previous.y;
          drag.current = {...previous,x:event.clientX,y:event.clientY};
          const viewport=event.currentTarget.getBoundingClientRect().width;
          setPosition(current => panAvatarCrop(image.naturalWidth,image.naturalHeight,current,dx,dy,viewport));
        }}
        onPointerUp={() => drag.current = null} onPointerCancel={() => drag.current = null} onLostPointerCapture={() => drag.current = null}
        onKeyDown={event => {
          const moves: Record<string,[number,number]>={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]};
          const movement=moves[event.key];
          if (!movement || saving) return;
          event.preventDefault(); const width=event.currentTarget.getBoundingClientRect().width;
          setPosition(current => panAvatarCrop(image.naturalWidth,image.naturalHeight,current,...movement,width));
        }}>
        <canvas ref={canvas} width={AVATAR_SIZE} height={AVATAR_SIZE} aria-hidden="true" />
        <div class="avatar-crop-mask" aria-hidden="true" />
      </div>
      <label class="avatar-crop-zoom">{t('profile.cropZoom')}<input type="range" min="1" max="4" step="0.01" value={position.zoom} disabled={saving} onInput={event => setPosition(current => ({...current,zoom:Number(event.currentTarget.value)}))} /></label>
      <button type="button" class="linklike" disabled={saving} onClick={() => setPosition({x:0.5,y:0.5,zoom:1})}>{t('profile.cropReset')}</button>
    </>}
    {error && <p class="banner error" role="alert">{error}</p>}
    <div class="rowactions"><button type="button" class="button ghost" disabled={saving} onClick={onCancel}>{t('profile.cropCancel')}</button><button type="button" class="button" disabled={!image || saving} onClick={() => void confirm()}>{saving ? t('profile.cropUploading') : t('profile.cropConfirm')}</button></div>
  </dialog>;
}
