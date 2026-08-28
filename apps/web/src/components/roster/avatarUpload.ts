import { orderedDitherRgba, type UploadRendering } from "./dither.logic";

export const AVATAR_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
const AVATAR_UPLOAD_SIZE = 128;

export function exceedsAvatarUploadLimit(file: Pick<File, "size">): boolean {
  return file.size > AVATAR_UPLOAD_MAX_FILE_BYTES;
}

/** Crops an avatar to a small square so profile images do not bloat roster state. */
export async function downscaleAvatarImage(file: File): Promise<UploadRendering> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_UPLOAD_SIZE;
    canvas.height = AVATAR_UPLOAD_SIZE;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D is unavailable.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_UPLOAD_SIZE,
      AVATAR_UPLOAD_SIZE,
    );
    const plainUrl = canvas.toDataURL("image/jpeg", 0.85);
    const imageData = context.getImageData(0, 0, AVATAR_UPLOAD_SIZE, AVATAR_UPLOAD_SIZE);
    orderedDitherRgba(imageData.data, imageData.width, imageData.height);
    context.putImageData(imageData, 0, 0);
    return { plainUrl, ditheredUrl: canvas.toDataURL("image/png") };
  } finally {
    bitmap.close();
  }
}
