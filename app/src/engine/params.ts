// Every adjustable value in the look, plus the named grain presets.

export type Transfer = 'sRGB' | 'AdobeRGB' | 'ProPhotoRGB';

export interface Params {
  grain: {
    enabled: boolean;
    preset: string;
    amount: number;     // 0..1
    size: number;       // pixels at a 3000 px wide frame
    softness: number;   // 0 hard cells .. 1 smooth
    chroma: number;     // 0 mono .. 1 fully coloured grain
    shadows: number;    // 0 midtone weighted .. 1 shadow weighted
    roughness: number;  // 0 single octave .. 1 equal octaves
    seed: number;
  };
  halation: {
    enabled: boolean;
    intensity: number;  // 0..2
    radius: number;     // % of frame width
    threshold: number;  // linear luminance
    tint: string;       // hex
  };
  bloom: {
    enabled: boolean;
    intensity: number;
    radius: number;
    threshold: number;
  };
  damage: {
    enabled: boolean;
    dust: number;        // probability per cell 0..1
    dustSize: number;    // 0.2..3
    dustLight: boolean;  // light specks (scanned negative) or dark (positive)
    scratches: number;   // 0..1
    scratchWidth: number;// pixels
    leak: number;        // 0..2
    leakColor: string;
    leakAngle: number;   // degrees
    leakSpread: number;  // 0.1..1
    vignette: number;    // 0..1
    vignetteFeather: number;
    seed: number;
  };
}

export interface GrainPreset {
  name: string;
  blurb: string;
  values: Omit<Params['grain'], 'enabled' | 'preset' | 'seed'>;
}

export const GRAIN_PRESETS: GrainPreset[] = [
  {
    name: 'Super 8',
    blurb: 'Big, soft, coloured clumps',
    values: { amount: 0.42, size: 4.2, softness: 0.75, chroma: 0.55, shadows: 0.45, roughness: 0.35 },
  },
  {
    name: '16mm',
    blurb: 'Lively documentary texture',
    values: { amount: 0.3, size: 2.8, softness: 0.6, chroma: 0.35, shadows: 0.4, roughness: 0.5 },
  },
  {
    name: 'Classic 35mm',
    blurb: 'ISO 400 colour negative',
    values: { amount: 0.2, size: 1.8, softness: 0.5, chroma: 0.25, shadows: 0.35, roughness: 0.6 },
  },
  {
    name: 'Fine 35mm',
    blurb: 'Slow, tight-grained stock',
    values: { amount: 0.1, size: 1.1, softness: 0.45, chroma: 0.15, shadows: 0.3, roughness: 0.7 },
  },
  {
    name: 'Medium format',
    blurb: 'Barely there',
    values: { amount: 0.06, size: 0.8, softness: 0.4, chroma: 0.1, shadows: 0.25, roughness: 0.7 },
  },
  {
    name: 'Pushed B&W',
    blurb: 'Harsh, mono, high contrast',
    values: { amount: 0.38, size: 2.4, softness: 0.3, chroma: 0.0, shadows: 0.6, roughness: 0.85 },
  },
];

export function defaultParams(): Params {
  const p = GRAIN_PRESETS[2];
  return {
    grain: { enabled: true, preset: p.name, seed: 1, ...p.values },
    halation: { enabled: true, intensity: 1.0, radius: 2.4, threshold: 0.65, tint: '#ff5a2a' },
    bloom: { enabled: false, intensity: 0.25, radius: 4, threshold: 0.55 },
    damage: {
      enabled: false,
      dust: 0.25, dustSize: 1, dustLight: true,
      scratches: 0.12, scratchWidth: 1.5,
      leak: 0, leakColor: '#ff7a2e', leakAngle: 20, leakSpread: 0.5,
      vignette: 0, vignetteFeather: 0.5,
      seed: 7,
    },
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
