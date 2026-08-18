import { perceptualHashDistance, perceptualHashSchema } from './perceptual-hash';

/** Gallery discovery accepts 60/64 matching pHash bits (93.75% similarity). */
export const GALLERY_PERCEPTUAL_HASH_DUPLICATE_DISTANCE = 4;
const GALLERY_HASH_SEGMENT_WIDTHS = [13n, 13n, 13n, 13n, 12n] as const;

export interface HashedGalleryImage {
  key: string;
  createdAt: string;
  perceptualHash: string;
  protected?: boolean;
}

/** Returns every redundant image while retaining the oldest image in each near-identical cluster. */
export function findRedundantGalleryImageKeys(images: readonly HashedGalleryImage[]): string[] {
  const valid = images.map((image) => ({ ...image, perceptualHash: perceptualHashSchema.parse(image.perceptualHash) }));
  const parent = valid.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]!));
  const join = (left: number, right: number) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const representatives = new Map<string, number>();
  valid.forEach((image, index) => {
    const representative = representatives.get(image.perceptualHash);
    if (representative === undefined) representatives.set(image.perceptualHash, index);
    else join(representative, index);
  });

  // With five partitions, at most four changed bits must leave one complete partition equal.
  const buckets = new Map<string, number[]>();
  const compared = new Set<string>();
  for (const [hash, index] of representatives) {
    let value = BigInt(`0x${hash}`);
    GALLERY_HASH_SEGMENT_WIDTHS.forEach((width, position) => {
      const segment = value & ((1n << width) - 1n);
      value >>= width;
      const bucketKey = `${position}:${segment.toString(16)}`;
      const candidates = buckets.get(bucketKey);
      if (!candidates) {
        buckets.set(bucketKey, [index]);
        return;
      }
      for (const candidateIndex of candidates) {
        const pair = candidateIndex < index ? `${candidateIndex}:${index}` : `${index}:${candidateIndex}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        if (perceptualHashDistance(valid[candidateIndex]!.perceptualHash, hash) <= GALLERY_PERCEPTUAL_HASH_DUPLICATE_DISTANCE) {
          join(candidateIndex, index);
        }
      }
      candidates.push(index);
    });
  }

  const clusters = new Map<number, typeof valid>();
  valid.forEach((image, index) => {
    const key = root(index);
    const cluster = clusters.get(key);
    if (cluster) cluster.push(image);
    else clusters.set(key, [image]);
  });
  return [...clusters.values()].flatMap((cluster) => {
    if (cluster.length < 2) return [];
    const ordered = cluster.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.key.localeCompare(right.key));
    const unprotected = ordered.filter((image) => !image.protected);
    return (ordered.some((image) => image.protected) ? unprotected : unprotected.slice(1)).map(({ key }) => key);
  });
}
