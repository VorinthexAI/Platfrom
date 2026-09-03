export function fitContainedMediaSize(source: { width: number; height: number }, viewport: { width: number; height: number }) {
  if (source.width <= 0 || source.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return { width: Math.max(0, viewport.width), height: Math.max(0, viewport.height) };
  const scale = Math.min(viewport.width / source.width, viewport.height / source.height);
  return { width: source.width * scale, height: source.height * scale };
}
