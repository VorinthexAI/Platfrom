import { perceptualHashDistance, perceptualHashSegments, PERCEPTUAL_HASH_DUPLICATE_DISTANCE, perceptualHashSchema } from './perceptual-hash';

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

  // A <=3-bit difference across four 16-bit segments must leave one segment equal.
  const buckets = new Map<string, number[]>();
  for (const [hash, index] of representatives) perceptualHashSegments(hash).forEach((segment, position) => {
    const bucket = `${position}:${segment}`;
    const indices = buckets.get(bucket);
    if (indices) indices.push(index);
    else buckets.set(bucket, [index]);
  });
  const compared = new Set<string>();
  for (const bucket of buckets.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const leftIndex = bucket[left]!;
        const rightIndex = bucket[right]!;
        const pair = leftIndex < rightIndex ? `${leftIndex}:${rightIndex}` : `${rightIndex}:${leftIndex}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        if (perceptualHashDistance(valid[leftIndex]!.perceptualHash, valid[rightIndex]!.perceptualHash) <= PERCEPTUAL_HASH_DUPLICATE_DISTANCE) join(leftIndex, rightIndex);
      }
    }
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
