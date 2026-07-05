// neural-map.md §30.3 — edge line material fragment shader.
// Rendered with THREE.AdditiveBlending, depthWrite: false — additive
// blending produces the "glowing connective tissue" look cheaply, and
// disabling depth-write prevents overlapping edges from fighting each
// other's depth-sort in a way that would look like flickering z-fighting
// at scale.
precision mediump float;
varying float vEdgeWeight; // 0..1, normalized relationship weight

void main() {
  vec3 color = mix(vec3(0.35, 0.42, 0.55), vec3(0.49, 0.61, 1.0), vEdgeWeight);
  float alpha = mix(0.15, 0.55, vEdgeWeight);
  gl_FragColor = vec4(color, alpha);
}
