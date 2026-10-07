// Separable Gaussian blur. uDir is (1/w, 0) or (0, 1/h).
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform float uSigma;
uniform int uRadius;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float twoSigma2 = 2.0 * uSigma * uSigma;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = -32; i <= 32; i++) {
    if (i < -uRadius || i > uRadius) continue;
    float fi = float(i);
    float w = exp(-fi * fi / twoSigma2);
    acc += texture(uSrc, vUv + uDir * fi).rgb * w;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}
