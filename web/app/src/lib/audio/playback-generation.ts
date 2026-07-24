export function createPlaybackGeneration() {
  let current = 0;

  return {
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(generation: number) {
      return generation === current;
    },
  };
}
