// Ambient module declaration for raw-imported GLSL shader source (§30's
// shader files). The Turbopack side is handled by the global `*.glsl` →
// `{ type: "raw" }` rule in next.config.ts (a per-import
// `with { turbopackModuleType: "raw" }` attribute alone isn't enough for an
// extension Turbopack has no built-in handling for) — this declaration is
// purely so `tsc --noEmit` (which never runs a bundler) knows `.glsl`
// imports resolve to a plain string rather than erroring with "cannot find
// module."
declare module "*.glsl" {
  const shaderSource: string;
  export default shaderSource;
}
