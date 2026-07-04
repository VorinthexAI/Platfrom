// neural-map.md §30.1 — node point/billboard glow vertex shader.
precision highp float;

attribute vec3 instanceColor;
attribute float instanceIntensity;

varying vec3 vInstanceColor;
varying float vInstanceIntensity;
varying vec2 vUv;

void main() {
  vInstanceColor = instanceColor;
  vInstanceIntensity = instanceIntensity;
  vUv = uv;

  // Billboard: strip rotation from the instance matrix's upper-left 3x3 so the
  // quad always faces the camera regardless of instance "orientation" (nodes
  // have no meaningful orientation of their own — only position and scale).
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy * vec2(instanceMatrix[0][0], instanceMatrix[1][1]);
  gl_Position = projectionMatrix * mvPosition;
}
