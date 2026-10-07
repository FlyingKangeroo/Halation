// Final look: bloom, halation, light leak, vignette, grain, dust and scratches.
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform sampler2D uHal;

uniform vec2 uWinOffset;   // uv window of the source being rendered
uniform vec2 uWinScale;
uniform float uFlipY;      // 1 when drawing to the screen
uniform float uBypass;     // 1 shows the untouched source
uniform vec2 uImageSize;   // full-resolution size in pixels
uniform float uAspect;     // width / height

uniform float uBloomIntensity;
uniform float uHalIntensity;
uniform vec3 uHalTint;

uniform float uGrainAmount;
uniform float uGrainSize;      // grain pitch in pixels at a 3000 px wide frame
uniform float uGrainSoftness;
uniform float uGrainChroma;
uniform float uGrainShadows;
uniform float uGrainRoughness;
uniform float uGrainSeed;

uniform float uDustAmount;
uniform float uDustSize;
uniform float uDustLight;
uniform float uScratchAmount;
uniform float uScratchWidth;
uniform float uLeakIntensity;
uniform vec3 uLeakColor;
uniform float uLeakAngle;
uniform float uLeakSpread;
uniform float uVignette;
uniform float uVignetteFeather;
uniform float uDamageSeed;

in vec2 vUv;
out vec4 fragColor;

vec3 filmGrain(vec2 uv) {
  float cells = 3000.0 / max(uGrainSize, 0.2);
  vec2 p = uv * vec2(cells, cells / uAspect);
  vec2 s = vec2(uGrainSeed * 17.0, uGrainSeed * 31.0);
  float w = 1.0;
  float wsum = 0.0;
  vec3 g = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = exp2(float(k));
    vec2 q = p * fk + s + float(k) * 71.7;
    vec3 n = vec3(
      vnoise(q, uGrainSoftness),
      vnoise(q + 101.3, uGrainSoftness),
      vnoise(q + 217.7, uGrainSoftness)) * 2.0 - 1.0;
    float mono = vnoise(q + 55.5, uGrainSoftness) * 2.0 - 1.0;
    g += mix(vec3(mono), n, uGrainChroma) * w;
    wsum += w;
    w *= uGrainRoughness;
  }
  return g / wsum;
}

float dust(vec2 uv) {
  float cells = 24.0;
  vec2 p = uv * vec2(cells, cells / uAspect);
  vec2 ip = floor(p);
  // Pixel footprint in cell units, taken from the continuous coordinate so
  // derivatives stay valid across cell borders and inside branches.
  float pixel = fwidth(p.x);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = ip + vec2(float(i), float(j));
      float present = hash12(c * 1.7 + uDamageSeed + 9.1);
      if (present > uDustAmount) continue;
      vec2 center = c + hash22(c + uDamageSeed);
      float radius = uDustSize * (0.12 + 0.88 * hash12(c + 3.3 + uDamageSeed)) * 0.07;
      vec2 d = p - center;
      float ang = atan(d.y, d.x);
      float irregular = 0.7 + 0.6 * vnoise(vec2(ang * 1.5 + c.x * 7.0, c.y * 5.0 + uDamageSeed), 1.0);
      float r = max(radius * irregular, 1e-4);
      float dist = length(d) / r;
      float aa = pixel / r;
      float blob = 1.0 - smoothstep(0.85 - aa, 1.0 + aa, dist);
      blob *= min(1.0, r / pixel); // specks smaller than a pixel fade instead of popping
      m += blob * (0.5 + 0.5 * hash12(c + 5.0 + uDamageSeed));
    }
  }
  return clamp(m, 0.0, 1.0);
}

float scratches(vec2 uv) {
  float cols = 80.0;
  float ic = floor(uv.x * cols);
  float widthUv = uScratchWidth / uImageSize.x;
  float aa = fwidth(uv.x);
  float m = 0.0;
  for (int i = -1; i <= 1; i++) {
    float c = ic + float(i);
    float present = hash12(vec2(c, 7.0) + uDamageSeed);
    if (present > uScratchAmount) continue;
    vec2 h = hash22(vec2(c, 13.0) + uDamageSeed);
    float x0 = (c + h.x) / cols;
    float y0 = h.y * 1.2 - 0.1;
    float len = 0.1 + 0.9 * hash12(vec2(c, 29.0) + uDamageSeed);
    float wobble = (vnoise(vec2(uv.y * 40.0, c * 3.1 + uDamageSeed), 1.0) - 0.5) * 0.0015;
    float dx = abs(uv.x - x0 - wobble);
    float line = 1.0 - smoothstep(widthUv * 0.5, widthUv * 0.5 + aa, dx);
    line *= min(1.0, widthUv / max(aa, 1e-7));
    float along = smoothstep(y0, y0 + 0.02, uv.y) * (1.0 - smoothstep(y0 + len - 0.02, y0 + len, uv.y));
    float flicker = 0.35 + 0.65 * vnoise(vec2(uv.y * 120.0, c * 5.3 + uDamageSeed), 1.0);
    m += line * along * flicker * (0.4 + 0.6 * hash12(vec2(c, 41.0) + uDamageSeed));
  }
  return clamp(m, 0.0, 1.0);
}

vec3 lightLeak(vec2 uv) {
  float a = radians(uLeakAngle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
  float t = dot(q, dir);
  float ext = 0.5 * (uAspect * abs(dir.x) + abs(dir.y));
  float d = (ext - t) / max(ext * uLeakSpread, 1e-3);
  float across = dot(q, vec2(-dir.y, dir.x));
  float streak = 0.6 + 0.8 * vnoise(vec2(across * 4.0 + uDamageSeed, 0.37), 1.0);
  float f = exp(-max(d, 0.0) * 1.6) * streak;
  return uLeakColor * uLeakIntensity * f;
}

float vignette(vec2 uv) {
  vec2 q = (uv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float r = length(q) / length(vec2(uAspect, 1.0));
  return 1.0 - uVignette * smoothstep(1.0 - uVignetteFeather * 1.2, 1.05, r);
}

void main() {
  vec2 v = vUv;
  if (uFlipY > 0.5) v.y = 1.0 - v.y;
  vec2 uv = uWinOffset + v * uWinScale;

  vec3 src = texture(uSrc, uv).rgb;
  if (uBypass > 0.5) {
    fragColor = vec4(src, 1.0);
    return;
  }

  vec3 lin = toLinear(src);
  lin += texture(uBloom, uv).rgb * uBloomIntensity;
  lin += texture(uHal, uv).rgb * uHalTint * uHalIntensity;
  if (uLeakIntensity > 0.0) lin += lightLeak(uv);
  if (uVignette > 0.0) lin *= vignette(uv);

  vec3 enc = toEncoded(lin);

  if (uGrainAmount > 0.0) {
    float l = clamp(luma(enc), 0.0, 1.0);
    float mid = 4.0 * l * (1.0 - l);
    float w = max(mix(mid, 1.0 - l, uGrainShadows), 0.06);
    enc += filmGrain(uv) * uGrainAmount * w;
  }

  float mask = 0.0;
  if (uDustAmount > 0.0) mask += dust(uv);
  if (uScratchAmount > 0.0) mask += scratches(uv);
  mask = clamp(mask, 0.0, 1.0);
  vec3 damageColor = uDustLight > 0.5 ? vec3(0.96) : vec3(0.04);
  enc = mix(enc, damageColor, mask * 0.92);

  fragColor = vec4(clamp(enc, 0.0, 1.0), 1.0);
}
