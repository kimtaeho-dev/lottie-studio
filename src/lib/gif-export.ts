import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { CanvasKit, ManagedSkottieAnimation } from "canvaskit-wasm/full";

// GIF delay is stored in centiseconds, so anything past ~25fps is wasted
// precision; capping it also keeps frame count (and file size) reasonable.
const MAX_OUTPUT_FPS = 25;
// Full-res exports of large canvases quantize slowly and produce huge GIFs;
// this is plenty for a Figma prototype preview.
const MAX_DIMENSION = 640;

export interface GifExportProgress {
  frame: number;
  totalFrames: number;
}

/**
 * Renders a Skottie animation frame-by-frame on an offscreen CanvasKit
 * surface and encodes the result as a GIF, then triggers a download. Frames
 * with any transparency are quantized with a single transparent palette
 * index (GIF has no partial alpha) so overlay/icon scenes stay see-through.
 */
export async function exportSceneGif(options: {
  canvasKit: CanvasKit;
  animation: ManagedSkottieAnimation;
  fps: number;
  totalFrames: number;
  filename: string;
  onProgress?: (progress: GifExportProgress) => void;
}): Promise<void> {
  const { canvasKit: ck, animation: anim, fps: sourceFps, totalFrames: sourceTotalFrames, filename, onProgress } = options;

  const [srcWidth, srcHeight] = anim.size();
  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const surface = ck.MakeSurface(width, height);
  if (!surface) throw new Error("Could not create an offscreen surface for GIF export.");

  const gif = GIFEncoder();

  try {
    const canvas = surface.getCanvas();
    const rect = ck.LTRBRect(0, 0, width, height);
    const outputFps = Math.max(1, Math.min(MAX_OUTPUT_FPS, sourceFps || MAX_OUTPUT_FPS));
    const durationSeconds = sourceTotalFrames / (sourceFps || outputFps);
    const outputFrameCount = Math.max(1, Math.round(durationSeconds * outputFps));
    const delayMs = Math.round(1000 / outputFps);

    for (let i = 0; i < outputFrameCount; i++) {
      const t = i / outputFps;
      const sourceFrame = Math.min(sourceTotalFrames - 1, Math.round(t * sourceFps));

      canvas.clear(ck.TRANSPARENT);
      anim.seekFrame(sourceFrame);
      anim.render(canvas, rect);
      surface.flush();

      const snapshot = surface.makeImageSnapshot();
      const pixels = snapshot.readPixels(0, 0, {
        width,
        height,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      }) as Uint8Array | null;
      snapshot.delete();
      if (!pixels) continue;

      // oneBitAlpha collapses each color to fully opaque or fully transparent,
      // since GIF only supports one transparent index rather than partial alpha.
      const palette = quantize(pixels, 256, { format: "rgba4444", oneBitAlpha: true });
      const index = applyPalette(pixels, palette, "rgba4444");
      const transparentIndex = palette.findIndex((color) => color[3] === 0);

      gif.writeFrame(index, width, height, {
        palette,
        delay: delayMs,
        transparent: transparentIndex >= 0,
        transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
      });

      onProgress?.({ frame: i + 1, totalFrames: outputFrameCount });
      // Yield periodically so the tab stays responsive and progress can paint.
      if (i % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    surface.delete();
  }

  gif.finish();
  const bytes = gif.bytes();
  const blob = new Blob([bytes as BlobPart], { type: "image/gif" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
