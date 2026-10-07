// Thin WebGL2 helpers: programs with cached uniform locations, float render
// targets and a fullscreen-triangle draw.

import commonSrc from './shaders/common.glsl?raw';
import vertSrc from './shaders/fullscreen.vert?raw';

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

export class Program {
  readonly handle: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, fragBody: string) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, '#version 300 es\n' + commonSrc + '\n' + fragBody);
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.handle = prog;
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.handle, name));
    return this.uniforms.get(name) ?? null;
  }

  f(name: string, v: number): this { this.gl.uniform1f(this.loc(name), v); return this; }
  i(name: string, v: number): this { this.gl.uniform1i(this.loc(name), v); return this; }
  f2(name: string, x: number, y: number): this { this.gl.uniform2f(this.loc(name), x, y); return this; }
  f3(name: string, x: number, y: number, z: number): this { this.gl.uniform3f(this.loc(name), x, y, z); return this; }

  tex(name: string, unit: number, texture: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this window.');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This GPU does not support floating point render targets (EXT_color_buffer_float).');
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  return gl;
}

function setSampling(gl: WebGL2RenderingContext, linear: boolean): void {
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// Half-float RGB source texture (sampled only, never rendered into).
export function createSourceTexture(gl: WebGL2RenderingContext, width: number, height: number, halfRgb: Uint16Array): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, width, height, 0, gl.RGB, gl.HALF_FLOAT, halfRgb);
  setSampling(gl, true);
  return tex;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error('Could not allocate render target');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
  setSampling(gl, true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: ' + status);
  return { tex, fbo, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

export function drawTo(gl: WebGL2RenderingContext, target: Target | null, x = 0, y = 0, w?: number, h?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  const width = w ?? (target ? target.width : gl.drawingBufferWidth);
  const height = h ?? (target ? target.height : gl.drawingBufferHeight);
  gl.viewport(x, y, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Float32 -> IEEE half, used to build the 16-bit integer -> half lookup table.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
export function floatToHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 0x1f) return sign | 0x7c00;
  mant = mant + 0x1000;
  if (mant & 0x800000) { mant = 0; exp += 1; if (exp >= 0x1f) return sign | 0x7c00; }
  return sign | (exp << 10) | (mant >> 13);
}

let halfLut: Uint16Array | null = null;
export function uint16ToHalfLut(): Uint16Array {
  if (!halfLut) {
    halfLut = new Uint16Array(65536);
    for (let i = 0; i < 65536; i++) halfLut[i] = floatToHalf(i / 65535);
  }
  return halfLut;
}
