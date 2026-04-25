/**
 * Client-side image compression using Canvas.
 * Runs entirely in the browser before uploading — keeps storage small
 * and uploads fast even on slow connections.
 */

export type ImagePreset = "avatar" | "logo" | "cover" | "story";

type PresetConfig = {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  /** If true, crop to a center square (used for avatars) */
  squareCrop?: boolean;
};

const PRESETS: Record<ImagePreset, PresetConfig> = {
  avatar: { maxWidth: 600, maxHeight: 600, quality: 0.85, squareCrop: true },
  logo:   { maxWidth: 800, maxHeight: 800, quality: 0.9 },
  cover:  { maxWidth: 1920, maxHeight: 1080, quality: 0.85 },
  story:  { maxWidth: 1080, maxHeight: 1920, quality: 0.85 },
};

/**
 * Compress an image file to fit a preset.
 * Returns a new File (always JPEG) much smaller than the input.
 */
export async function compressImage(file: File, preset: ImagePreset): Promise<File> {
  // If it's not an image, return as-is (let server reject)
  if (!file.type.startsWith("image/")) return file;

  const cfg = PRESETS[preset];
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);

  // Calculate target dimensions
  let { width, height } = computeTargetSize(img.width, img.height, cfg);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return file; // fallback — shouldn't happen

  if (cfg.squareCrop) {
    // Center-crop to square, then resize to maxWidth
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    const target = Math.min(side, cfg.maxWidth);
    canvas.width = target;
    canvas.height = target;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  } else {
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", cfg.quality)
  );

  if (!blob) return file;

  // Replace extension with .jpg
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

function computeTargetSize(
  srcW: number,
  srcH: number,
  cfg: PresetConfig
): { width: number; height: number } {
  const ratio = srcW / srcH;
  let w = srcW;
  let h = srcH;

  if (w > cfg.maxWidth) {
    w = cfg.maxWidth;
    h = w / ratio;
  }
  if (h > cfg.maxHeight) {
    h = cfg.maxHeight;
    w = h * ratio;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
