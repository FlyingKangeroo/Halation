// Decode whatever lands in the editor into 16-bit interleaved RGB.

import { decodeTiff } from './tiff';

export interface LoadedImage {
  name: string;
  width: number;
  height: number;
  rgb16: Uint16Array;
  icc?: Uint8Array;
  bitDepth: 8 | 16;
}

export function isTiff(name: string, bytes: Uint8Array): boolean {
  if (/\.tiff?$/i.test(name)) return true;
  return bytes.length > 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 42) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 42));
}

export async function decodeImageBytes(name: string, bytes: Uint8Array): Promise<LoadedImage> {
  if (isTiff(name, bytes)) {
    const t = decodeTiff(bytes);
    return { name, width: t.width, height: t.height, rgb16: t.rgb16, icc: t.icc, bitDepth: 16 };
  }
  // Anything the browser can decode (JPEG, PNG, WebP, HEIC on Safari...).
  const blob = new Blob([bytes as BlobPart]);
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const n = canvas.width * canvas.height;
  const rgb16 = new Uint16Array(n * 3);
  for (let i = 0, s = 0, o = 0; i < n; i++, s += 4) {
    rgb16[o++] = data[s] * 257;
    rgb16[o++] = data[s + 1] * 257;
    rgb16[o++] = data[s + 2] * 257;
  }
  return { name, width: canvas.width, height: canvas.height, rgb16, bitDepth: 8 };
}
