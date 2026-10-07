// Extract light above a threshold, in linear light, for bloom and halation.
uniform sampler2D uSrc;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 lin = toLinear(texture(uSrc, vUv).rgb);
  float l = luma(lin);
  float k = smoothstep(uThreshold, uThreshold + max(uKnee, 1e-3), l);
  fragColor = vec4(lin * k, 1.0);
}
