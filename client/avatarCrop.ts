export const MAX_AVATAR_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_AVATAR_PIXELS = 40_000_000;
export const AVATAR_SIZE = 512;
export type CropPosition = { x: number; y: number; zoom: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function avatarCropRectangle(width: number, height: number, position: CropPosition) {
  if (![width, height, position.x, position.y, position.zoom].every(Number.isFinite) || width <= 0 || height <= 0 || width * height > MAX_AVATAR_PIXELS) throw new Error('Invalid image dimensions');
  const size = Math.min(width, height) / clamp(position.zoom, 1, 4);
  return { x: clamp(position.x, 0, 1) * (width - size), y: clamp(position.y, 0, 1) * (height - size), size };
}
export function panAvatarCrop(width: number, height: number, position: CropPosition, deltaX: number, deltaY: number, viewport: number): CropPosition {
  if (![deltaX, deltaY, viewport].every(Number.isFinite) || viewport <= 0) return position;
  const crop = avatarCropRectangle(width, height, position);
  return { ...position,
    x: width === crop.size ? position.x : clamp(position.x - deltaX * crop.size / viewport / (width - crop.size), 0, 1),
    y: height === crop.size ? position.y : clamp(position.y - deltaY * crop.size / viewport / (height - crop.size), 0, 1),
  };
}
export function supportedAvatarBytes(bytes: Uint8Array): boolean {
  return (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)
    || (String.fromCharCode(...bytes.slice(0,6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0,6)) === 'GIF89a')
    || (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP')
    || (bytes[0] === 0x42 && bytes[1] === 0x4d);
}
export function validAvatarFile(file: Pick<File, 'size' | 'type'>): boolean {
  return file.size > 0 && file.size <= MAX_AVATAR_FILE_BYTES && ['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/x-ms-bmp'].includes(file.type);
}
