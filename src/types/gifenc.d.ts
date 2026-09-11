// gifenc ships no type declarations of its own. Only the subset used by
// src/lib/gif-export.ts is typed here — see node_modules/gifenc/README.md
// for the full API.
declare module "gifenc" {
  export type GifencPalette = number[][];
  export type GifencFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface QuantizeOptions {
    format?: GifencFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifencPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifencPalette,
    format?: GifencFormat,
  ): Uint8Array;

  export interface WriteFrameOptions {
    palette?: GifencPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, options?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
}
