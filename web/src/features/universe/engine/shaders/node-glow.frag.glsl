// neural-map.md §30.1 — node point/billboard glow fragment shader.
precision highp float;

varying vec3 vInstanceColor;
varying float vInstanceIntensity; // 0..1, drives the §8.6 "new node" fade-in pulse
varying vec2 vUv;

void main() {
  // Radial falloff from billboard center — soft glow, not a hard-edged disc.
  vec2 centered = vUv - vec2(0.5);
  float dist = length(centered) * 2.0; // 0 at center, 1 at edge
  float falloff = smoothstep(1.0, 0.0, dist);
  falloff = pow(falloff, 1.6); // slightly punchier core than a linear falloff

  float alpha = falloff * vInstanceIntensity;
  vec3 color = vInstanceColor * (0.6 + 0.4 * falloff); // brighten toward center

  if (alpha < 0.01) discard; // cheap early-out for fully-transparent fragments,
                              // meaningful at thousands of overlapping instances

  gl_FragColor = vec4(color, alpha);
}
