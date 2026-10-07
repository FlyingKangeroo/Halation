// Bilinear resample (2:1 gives a box filter); also used for plain blits.
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 fragColor;
void main() { fragColor = vec4(texture(uSrc, vUv).rgb, 1.0); }
