import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTiff, encodeTiff16 } from '../src/io/tiff';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

// The fixtures all come from the same synthetic "lamp" image: a red ramp
// along x, a green ramp along y, and bright spots. Check a few known pixels.
function expectLampPixels(width: number, height: number, rgb16: Uint16Array) {
  const px = (x: number, y: number) => {
    const i = (y * width + x) * 3;
    return [rgb16[i] / 65535, rgb16[i + 1] / 65535, rgb16[i + 2] / 65535];
  };
  const [rL] = px(1, Math.floor(height / 2));
  const [rR] = px(width - 2, Math.floor(height / 2));
  expect(rR).toBeGreaterThan(rL + 0.4); // red ramp left to right
  const [, gT] = px(Math.floor(width / 2), 1);
  const [, gB] = px(Math.floor(width / 2), height - 2);
  expect(gB).toBeGreaterThan(gT + 0.4); // green ramp top to bottom
  const lamp = px(Math.round(width * 0.25), Math.round(height * 0.28)); // first lamp
  expect(Math.min(...lamp)).toBeGreaterThan(0.95);
}

describe('decodeTiff', () => {
  it('reads 16-bit little-endian uncompressed', () => {
    const t = decodeTiff(fixture('lamp16.tif'));
    expect([t.width, t.height]).toEqual([160, 107]);
    expectLampPixels(t.width, t.height, t.rgb16);
  });
  it('reads 16-bit big-endian uncompressed', () => {
    const t = decodeTiff(fixture('lamp16-be.tif'));
    expectLampPixels(t.width, t.height, t.rgb16);
  });
  it('reads 16-bit ZIP and LZW with predictor', () => {
    for (const f of ['lamp16-zip.tif', 'lamp16-lzw.tif']) {
      const t = decodeTiff(fixture(f));
      expect([t.width, t.height]).toEqual([640, 427]);
      expectLampPixels(t.width, t.height, t.rgb16);
    }
  });
  it('reads 8-bit deflate and scales to 16-bit', () => {
    const t = decodeTiff(fixture('lamp8-zip.tif'));
    expectLampPixels(t.width, t.height, t.rgb16);
    expect(t.rgb16.some((v) => v === 65535)).toBe(true);
  });
});

describe('encodeTiff16', () => {
  it('round-trips pixels and the ICC profile', () => {
    const w = 37, h = 11;
    const rgb = new Uint16Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7919) & 0xffff;
    const icc = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const bytes = encodeTiff16(w, h, rgb, icc, 'Halation test');
    expect(bytes[0]).toBe(0x49);
    const back = decodeTiff(bytes);
    expect([back.width, back.height]).toEqual([w, h]);
    expect(Array.from(back.rgb16)).toEqual(Array.from(rgb));
    expect(Array.from(back.icc ?? [])).toEqual(Array.from(icc));
  });
  it('splits large images into several strips', () => {
    const w = 2048, h = 1200; // 12 MB of pixels, so a 4 MB strip limit gives multiple strips
    const rgb = new Uint16Array(w * h * 3).fill(1234);
    const bytes = encodeTiff16(w, h, rgb);
    const back = decodeTiff(bytes);
    expect(back.rgb16[0]).toBe(1234);
    expect(back.rgb16[back.rgb16.length - 1]).toBe(1234);
  });
});
