// Render pipeline. One full-resolution source texture, a half-res chain for
// previews and glow extraction, and a single composite pass that renders
// either to the screen (any zoom window) or to strips for export.

import { createContext, createSourceTexture, createTarget, deleteTarget, drawTo, Program, Target, uint16ToHalfLut } from './gl';
import { hexToRgb, Params, Transfer } from './params';
import copyFrag from './shaders/copy.frag?raw';
import brightFrag from './shaders/bright.frag?raw';
import blurFrag from './shaders/blur.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';

export interface SourceImage {
  width: number;
  height: number;
  rgb16: Uint16Array; // interleaved RGB, 16-bit, row 0 at the top
}

export interface ViewRect {
  // Image rectangle in device pixels within the canvas (may extend past the canvas).
  x: number; y: number; width: number; height: number;
}

interface Level { tex: WebGLTexture; width: number; height: number; target?: Target }

const MAX_BLUR_SIGMA_PX = 10;
const EXPORT_STRIP_ROWS = 256;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  private copy: Program;
  private bright: Program;
  private blur: Program;
  private composite: Program;
  private levels: Level[] = [];
  private scratch = new Map<string, Target[]>();
  private bloomTex: Target | null = null;
  private halTex: Target | null = null;
  private glowKey = '';
  private imageWidth = 0;
  private imageHeight = 0;
  private transfer: Transfer = 'sRGB';

  constructor(public readonly canvas: HTMLCanvasElement) {
    this.gl = createContext(canvas);
    this.maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    this.copy = new Program(this.gl, copyFrag);
    this.bright = new Program(this.gl, brightFrag);
    this.blur = new Program(this.gl, blurFrag);
    this.composite = new Program(this.gl, compositeFrag);
  }

  get hasImage(): boolean { return this.levels.length > 0; }
  get width(): number { return this.imageWidth; }
  get height(): number { return this.imageHeight; }

  setTransfer(t: Transfer): void {
    this.transfer = t;
    this.glowKey = '';
  }

  setImage(img: SourceImage): void {
    const gl = this.gl;
    this.disposeImage();
    if (img.width > this.maxTextureSize || img.height > this.maxTextureSize) {
      throw new Error(`Image is larger than this GPU's maximum texture size (${this.maxTextureSize} px).`);
    }
    const lut = uint16ToHalfLut();
    const half = new Uint16Array(img.rgb16.length);
    for (let i = 0; i < half.length; i++) half[i] = lut[img.rgb16[i]];
    const tex = createSourceTexture(gl, img.width, img.height, half);
    this.imageWidth = img.width;
    this.imageHeight = img.height;
    this.levels = [{ tex, width: img.width, height: img.height }];

    // Half-resolution chain down to roughly 64 px wide.
    let w = img.width, h = img.height;
    let src: WebGLTexture = tex;
    while (Math.max(w, h) > 64) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      const target = createTarget(gl, w, h);
      this.copy.use().tex('uSrc', 0, src);
      drawTo(gl, target);
      this.levels.push({ tex: target.tex, width: w, height: h, target });
      src = target.tex;
    }
    this.glowKey = '';
  }

  disposeImage(): void {
    for (const l of this.levels) if (l.target) deleteTarget(this.gl, l.target); else this.gl.deleteTexture(l.tex);
    this.levels = [];
    this.glowKey = '';
  }

  private scratchTargets(width: number, height: number, count: number): Target[] {
    const key = `${width}x${height}`;
    let list = this.scratch.get(key);
    if (!list) { list = []; this.scratch.set(key, list); }
    while (list.length < count) list.push(createTarget(this.gl, width, height));
    return list;
  }

  private levelForSigma(sigmaUv: number): Level {
    // Walk down the chain until the blur sigma fits in a small kernel.
    for (let i = 1; i < this.levels.length; i++) {
      const l = this.levels[i];
      if (sigmaUv * l.width <= MAX_BLUR_SIGMA_PX || l.width <= 128) return l;
    }
    return this.levels[this.levels.length - 1];
  }

  // Bright-pass + separable Gaussian into a dedicated target.
  private renderGlow(radiusPct: number, threshold: number, out: Target | null): Target {
    const gl = this.gl;
    const sigmaUv = Math.max(radiusPct, 0.05) / 100;
    const level = this.levelForSigma(sigmaUv);
    const sigma = Math.max(0.5, sigmaUv * level.width);
    const radius = Math.min(32, Math.ceil(sigma * 2.5));
    const [a, b] = this.scratchTargets(level.width, level.height, 2);
    if (out && (out.width !== level.width || out.height !== level.height)) { deleteTarget(gl, out); out = null; }
    if (!out) out = createTarget(gl, level.width, level.height);

    this.bright.use().tex('uSrc', 0, level.tex).f('uThreshold', threshold).f('uKnee', 0.25);
    this.setTransferUniforms(this.bright);
    drawTo(gl, a);

    this.blur.use().tex('uSrc', 0, a.tex).f2('uDir', 1 / level.width, 0).f('uSigma', sigma).i('uRadius', radius);
    drawTo(gl, b);
    this.blur.use().tex('uSrc', 0, b.tex).f2('uDir', 0, 1 / level.height).f('uSigma', sigma).i('uRadius', radius);
    drawTo(gl, out);
    return out;
  }

  private ensureGlow(p: Params): void {
    const key = JSON.stringify([p.bloom.enabled, p.bloom.radius, p.bloom.threshold, p.halation.enabled, p.halation.radius, p.halation.threshold, this.transfer]);
    if (key === this.glowKey) return;
    this.glowKey = key;
    this.bloomTex = this.renderGlow(p.bloom.radius, p.bloom.threshold, this.bloomTex);
    this.halTex = this.renderGlow(p.halation.radius, p.halation.threshold, this.halTex);
  }

  private setTransferUniforms(prog: Program): void {
    if (this.transfer === 'sRGB') prog.i('uTransfer', 0).f('uGammaValue', 2.2);
    else if (this.transfer === 'AdobeRGB') prog.i('uTransfer', 1).f('uGammaValue', 2.2);
    else prog.i('uTransfer', 1).f('uGammaValue', 1.8);
  }

  private setLookUniforms(p: Params, src: WebGLTexture, bypass: boolean): void {
    const c = this.composite.use();
    this.setTransferUniforms(c);
    c.tex('uSrc', 0, src).tex('uBloom', 1, this.bloomTex!.tex).tex('uHal', 2, this.halTex!.tex);
    c.f('uBypass', bypass ? 1 : 0);
    c.f2('uImageSize', this.imageWidth, this.imageHeight).f('uAspect', this.imageWidth / this.imageHeight);

    c.f('uBloomIntensity', p.bloom.enabled ? p.bloom.intensity : 0);
    c.f('uHalIntensity', p.halation.enabled ? p.halation.intensity : 0);
    const tint = hexToRgb(p.halation.tint);
    c.f3('uHalTint', tint[0], tint[1], tint[2]);

    const g = p.grain;
    c.f('uGrainAmount', g.enabled ? g.amount : 0).f('uGrainSize', g.size).f('uGrainSoftness', g.softness)
      .f('uGrainChroma', g.chroma).f('uGrainShadows', g.shadows).f('uGrainRoughness', g.roughness).f('uGrainSeed', g.seed);

    const d = p.damage;
    const on = d.enabled;
    const leak = hexToRgb(d.leakColor);
    c.f('uDustAmount', on ? d.dust : 0).f('uDustSize', d.dustSize).f('uDustLight', d.dustLight ? 1 : 0)
      .f('uScratchAmount', on ? d.scratches : 0).f('uScratchWidth', d.scratchWidth)
      .f('uLeakIntensity', on ? d.leak : 0).f3('uLeakColor', leak[0], leak[1], leak[2]).f('uLeakAngle', d.leakAngle).f('uLeakSpread', d.leakSpread)
      .f('uVignette', on ? d.vignette : 0).f('uVignetteFeather', d.vignetteFeather).f('uDamageSeed', d.seed);
  }

  // Draw the image to the canvas. `view` is the image rectangle in device pixels.
  renderPreview(p: Params, view: ViewRect, bypass = false): void {
    const gl = this.gl;
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.hasImage) return;
    this.ensureGlow(p);

    // Pick the chain level closest to (and not smaller than) the drawn size.
    let level = this.levels[0];
    for (const l of this.levels) if (l.width >= view.width && l.height >= view.height) level = l;

    // Visible part of the image rectangle.
    const x0 = Math.max(0, view.x), y0 = Math.max(0, view.y);
    const x1 = Math.min(cw, view.x + view.width), y1 = Math.min(ch, view.y + view.height);
    if (x1 <= x0 || y1 <= y0) return;

    this.setLookUniforms(p, level.tex, bypass);
    this.composite
      .f2('uWinOffset', (x0 - view.x) / view.width, (y0 - view.y) / view.height)
      .f2('uWinScale', (x1 - x0) / view.width, (y1 - y0) / view.height)
      .f('uFlipY', 1);
    drawTo(gl, null, Math.round(x0), Math.round(ch - y1), Math.round(x1 - x0), Math.round(y1 - y0));
  }

  // Render the full-resolution result in strips. Returns interleaved RGB16.
  exportImage(p: Params, onProgress?: (fraction: number) => void): Uint16Array {
    const gl = this.gl;
    if (!this.hasImage) throw new Error('No image loaded');
    this.ensureGlow(p);
    const W = this.imageWidth, H = this.imageHeight;
    const rows = Math.min(EXPORT_STRIP_ROWS, H);
    const [strip] = this.scratchTargets(W, rows, 1);
    const out = new Uint16Array(W * H * 3);
    const floats = new Float32Array(W * rows * 4);

    this.setLookUniforms(p, this.levels[0].tex, false);
    this.composite.f('uFlipY', 0);

    for (let y = 0; y < H; y += rows) {
      const n = Math.min(rows, H - y);
      this.composite.use().f2('uWinOffset', 0, y / H).f2('uWinScale', 1, n / H);
      drawTo(gl, strip, 0, 0, W, n);
      gl.readPixels(0, 0, W, n, gl.RGBA, gl.FLOAT, floats);
      let o = y * W * 3;
      for (let i = 0, k = 0; i < W * n; i++, k += 4) {
        out[o++] = Math.round(Math.min(1, Math.max(0, floats[k])) * 65535);
        out[o++] = Math.round(Math.min(1, Math.max(0, floats[k + 1])) * 65535);
        out[o++] = Math.round(Math.min(1, Math.max(0, floats[k + 2])) * 65535);
      }
      onProgress?.((y + n) / H);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}
