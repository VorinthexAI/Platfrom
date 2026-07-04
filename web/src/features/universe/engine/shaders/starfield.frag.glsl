// neural-map.md §30.2 — decorative starfield fragment shader (R0, §8.2).
// Deliberately flatter, dimmer, and non-interactive-looking relative to
// node-glow.frag.glsl, per §8.2's "real vs decorative" requirement: real
// clusters/nodes are brighter, slightly larger, and interactive; this
// decorative background layer is dim, small, and inert — never clickable,
// never labeled. Do not "fix" this into being per-instance-colorable or
// pickable — that would break the illusion's honesty (§8.2).
precision mediump float; // lower precision is fine — this is background dressing

varying float vTwinkle;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float dist = length(centered) * 2.0;
  float falloff = smoothstep(1.0, 0.0, dist);
  float alpha = falloff * 0.35 * vTwinkle; // capped well below node-glow's max alpha
  gl_FragColor = vec4(vec3(0.29, 0.35, 0.60), alpha); // fixed dim color, never
                                                       // per-instance-colorable —
                                                       // reinforces it's not real data
}
