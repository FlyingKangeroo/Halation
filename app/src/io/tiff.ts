// 16-bit RGB TIFF read (via utif) and write (uncompressed, little-endian).

import * as UTIF from 'utif';

export interface DecodedTiff {
  width: number;
  height: number;
  rgb16: Uint16Array;
  icc?: Uint8Array;
}

function tag<T>(ifd: UTIF.IFD, id: number): T | undefined {
  return ifd['t' + id] as T | undefined;
}

export function decodeTiff(bytes: Uint8Array): DecodedTiff {
  const ifds = UTIF.decode(bytes);
  if (!ifds.length) throw new Error('TIFF contains no images');
  const ifd = ifds[0];
  UTIF.decodeImage(bytes, ifd);
  const bps = tag<number[]>(ifd, 258)?.[0] ?? 8;
  const spp = tag<number[]>(ifd, 277)?.[0] ?? 1;
  const planar = tag<number[]>(ifd, 284)?.[0] ?? 1;
  const photometric = tag<number[]>(ifd, 262)?.[0] ?? 2;
  if (planar !== 1) throw new Error('Planar (non-interleaved) TIFFs are not supported');
  if (bps !== 8 && bps !== 16) throw new Error(`Unsupported bit depth: ${bps}`);
  if (spp !== 1 && spp !== 3 && spp !== 4) throw new Error(`Unsupported sample count: ${spp}`);

  const { width, height, data } = ifd;
  const n = width * height;
  const rgb16 = new Uint16Array(n * 3);

  if (bps === 16) {
    // utif rewrites 16-bit samples to little-endian whatever the file's byte order.
    const src = new Uint16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
    const platformLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
    const swap = !platformLE;
    const rd = swap ? (i: number) => ((src[i] & 0xff) << 8) | (src[i] >> 8) : (i: number) => src[i];
    for (let i = 0, o = 0, s = 0; i < n; i++, s += spp) {
      if (spp === 1) { const v = rd(s); rgb16[o++] = v; rgb16[o++] = v; rgb16[o++] = v; }
      else { rgb16[o++] = rd(s); rgb16[o++] = rd(s + 1); rgb16[o++] = rd(s + 2); }
    }
  } else {
    for (let i = 0, o = 0, s = 0; i < n; i++, s += spp) {
      if (spp === 1) { const v = data[s] * 257; rgb16[o++] = v; rgb16[o++] = v; rgb16[o++] = v; }
      else { rgb16[o++] = data[s] * 257; rgb16[o++] = data[s + 1] * 257; rgb16[o++] = data[s + 2] * 257; }
    }
  }
  if (photometric === 0) for (let i = 0; i < rgb16.length; i++) rgb16[i] = 65535 - rgb16[i];

  const iccRaw = tag<Uint8Array | number[]>(ifd, 34675);
  const icc = iccRaw ? (iccRaw instanceof Uint8Array ? iccRaw : Uint8Array.from(iccRaw)) : undefined;
  return { width, height, rgb16, icc };
}

const TYPE_SHORT = 3, TYPE_LONG = 4, TYPE_RATIONAL = 5, TYPE_ASCII = 2, TYPE_UNDEFINED = 7;

interface Entry { tag: number; type: number; count: number; value: Uint8Array }

function u16(v: number): Uint8Array { const b = new Uint8Array(2); b[0] = v & 255; b[1] = (v >> 8) & 255; return b; }
function u32(v: number): Uint8Array { const b = new Uint8Array(4); b[0] = v & 255; b[1] = (v >> 8) & 255; b[2] = (v >> 16) & 255; b[3] = (v >>> 24) & 255; return b; }
function u32s(vals: number[]): Uint8Array { const b = new Uint8Array(vals.length * 4); vals.forEach((v, i) => b.set(u32(v), i * 4)); return b; }

export function encodeTiff16(width: number, height: number, rgb16: Uint16Array, icc?: Uint8Array, software = 'Halation'): Uint8Array {
  if (rgb16.length !== width * height * 3) throw new Error('Pixel buffer size does not match dimensions');
  const bytesPerRow = width * 6;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor((4 << 20) / bytesPerRow)));
  const stripCount = Math.ceil(height / rowsPerStrip);
  const stripBytes: number[] = [];
  for (let s = 0; s < stripCount; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    stripBytes.push(rows * bytesPerRow);
  }

  const softwareBytes = new TextEncoder().encode(software + '\0');
  const entries: Entry[] = [
    { tag: 256, type: TYPE_LONG, count: 1, value: u32(width) },
    { tag: 257, type: TYPE_LONG, count: 1, value: u32(height) },
    { tag: 258, type: TYPE_SHORT, count: 3, value: concat([u16(16), u16(16), u16(16)]) },
    { tag: 259, type: TYPE_SHORT, count: 1, value: u16(1) },
    { tag: 262, type: TYPE_SHORT, count: 1, value: u16(2) },
    { tag: 273, type: TYPE_LONG, count: stripCount, value: new Uint8Array(stripCount * 4) }, // patched below
    { tag: 277, type: TYPE_SHORT, count: 1, value: u16(3) },
    { tag: 278, type: TYPE_LONG, count: 1, value: u32(rowsPerStrip) },
    { tag: 279, type: TYPE_LONG, count: stripCount, value: u32s(stripBytes) },
    { tag: 282, type: TYPE_RATIONAL, count: 1, value: concat([u32(300), u32(1)]) },
    { tag: 283, type: TYPE_RATIONAL, count: 1, value: concat([u32(300), u32(1)]) },
    { tag: 284, type: TYPE_SHORT, count: 1, value: u16(1) },
    { tag: 296, type: TYPE_SHORT, count: 1, value: u16(2) },
    { tag: 305, type: TYPE_ASCII, count: softwareBytes.length, value: softwareBytes },
  ];
  if (icc && icc.length) entries.push({ tag: 34675, type: TYPE_UNDEFINED, count: icc.length, value: icc });
  entries.sort((a, b) => a.tag - b.tag);

  // Layout: header (8) | IFD | out-of-line values | pixel strips.
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataOffset = 8 + ifdSize;
  const valueOffsets = new Map<Entry, number>();
  for (const e of entries) {
    if (e.value.length > 4) {
      valueOffsets.set(e, dataOffset);
      dataOffset += e.value.length + (e.value.length & 1);
    }
  }
  const pixelOffset = dataOffset;
  const stripOffsets: number[] = [];
  let off = pixelOffset;
  for (const b of stripBytes) { stripOffsets.push(off); off += b; }
  const stripsEntry = entries.find((e) => e.tag === 273)!;
  stripsEntry.value = u32s(stripOffsets);
  const total = off;

  const out = new Uint8Array(total);
  out.set([0x49, 0x49]); out.set(u16(42), 2); out.set(u32(8), 4);
  let p = 8;
  out.set(u16(entries.length), p); p += 2;
  for (const e of entries) {
    out.set(u16(e.tag), p); out.set(u16(e.type), p + 2); out.set(u32(e.count), p + 4);
    if (e.value.length > 4) out.set(u32(valueOffsets.get(e)!), p + 8);
    else out.set(e.value, p + 8);
    p += 12;
  }
  out.set(u32(0), p);
  for (const e of entries) if (e.value.length > 4) out.set(e.value, valueOffsets.get(e)!);

  // Pixels: write little-endian 16-bit samples.
  const platformLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (platformLE) {
    out.set(new Uint8Array(rgb16.buffer, rgb16.byteOffset, rgb16.byteLength), pixelOffset);
  } else {
    for (let i = 0, q = pixelOffset; i < rgb16.length; i++, q += 2) { out[q] = rgb16[i] & 255; out[q + 1] = rgb16[i] >> 8; }
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
