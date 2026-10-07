// Shared helpers prepended to every fragment shader.
precision highp float;
precision highp int;

// Transfer function of the hand-off colour space.
// 0 = sRGB piecewise, 1 = pure gamma (uGammaValue).
uniform int uTransfer;
uniform float uGammaValue;

vec3 toLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  if (uTransfer == 0) {
    vec3 lo = c / 12.92;
    vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
    return mix(lo, hi, step(0.04045, c));
  }
  return pow(c, vec3(uGammaValue));
}

vec3 toEncoded(vec3 c) {
  c = max(c, 0.0);
  if (uTransfer == 0) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(0.0031308, c));
  }
  return pow(c, vec3(1.0 / uGammaValue));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Hash and value noise (Dave Hoskins style, no texture lookups).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise. soft = 0 gives hard cells, soft = 1 gives smooth (quintic) blending.
float vnoise(vec2 p, float soft) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 smooth5 = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 u = mix(step(0.5, f), smooth5, soft);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
