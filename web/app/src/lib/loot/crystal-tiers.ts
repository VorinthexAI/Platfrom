import { mulberry32 } from "@/lib/three/procedural";

/**
 * The ten crystal tiers found inside asteroids, spanning 10 fragments to
 * a million. Every asteroid holds exactly one crystal; the tier roll is
 * weighted so the big finds are genuinely findable (roughly 1 dive in 7
 * lands 10k+), and each tier carries 50 unique drawer openers — 10 leads
 * crossed with 5 closers, so no two reads feel canned.
 */

export interface CrystalTier {
  /** 0-based tier index; 9 is the million-class find. */
  index: number;
  name: string;
  min: number;
  max: number;
  /** Roll weight (relative). */
  weight: number;
  leads: string[];
  closers: string[];
}

const T = (
  index: number,
  name: string,
  min: number,
  max: number,
  weight: number,
  leads: string[],
  closers: string[],
): CrystalTier => ({ index, name, min, max, weight, leads, closers });

export const CRYSTAL_TIERS: CrystalTier[] = [
  T(0, "Dust Chip", 10, 24, 16, [
    "Ah. Well. You made it here, at least.",
    "The vault creaks open… to a whisper.",
    "Ops — this one's barely a pebble.",
    "Not every rock hides a legend.",
    "A faint shimmer in the dust. Very faint.",
    "The scanners weren't wrong, just… optimistic.",
    "Someone got here first, probably. This is what's left.",
    "A modest little glint for a modest little rock.",
    "The belt keeps its small change here.",
    "Even the tiniest spark counts out here.",
  ], [
    "Pocket it anyway — every fragment counts.",
    "Small finds still stack on the leaderboard.",
    "Take it; the next rock might be the one.",
    "A start is a start, explorer.",
    "Collect it and keep your streak alive.",
  ]),
  T(1, "Faint Shard", 25, 59, 15, [
    "A soft glow under the dust — something small survived here.",
    "You've made it here, and the rock left you a little something.",
    "Not a jackpot. Not nothing either.",
    "A shard hums quietly in the middle of the chamber.",
    "The vault holds a sliver of light.",
    "Somebody mined this rock hard, but they missed a piece.",
    "A pocket-sized find for a patient explorer.",
    "The dust parts around a faint crystal.",
    "It's small, but it's yours if you want it.",
    "A gentle find — the belt is warming up to you.",
  ], [
    "Collect it and keep hopping rocks.",
    "Stack it — climbers take every step.",
    "Take the shard; bigger veins are out there.",
    "Add it to your haul and push on.",
    "It all counts when the leaderboard settles.",
  ]),
  T(2, "Common Vein", 60, 149, 14, [
    "Now we're talking — a real vein runs through this one.",
    "You've made it here, and the rock pays honest wages.",
    "A solid little crystal, grown in the dark.",
    "The chamber glitters more than most.",
    "Decent haul for an unmarked rock.",
    "This asteroid kept a proper secret.",
    "The scanners perk up — a true find.",
    "A worker's crystal: no drama, real value.",
    "Steady light from a steady rock.",
    "The belt rewards the persistent.",
  ], [
    "Collect it before the dust settles back.",
    "Take it and let the ledger sing.",
    "That's leaderboard fuel — grab it.",
    "Yours for the tapping, explorer.",
    "Bank it and chase the next one.",
  ]),
  T(3, "Bright Cluster", 150, 399, 12, [
    "Oh, nice — a bright cluster, fully grown.",
    "You've made it here, and this rock was worth the detour.",
    "The chamber walls catch real light off this one.",
    "A cluster like this doesn't grow overnight.",
    "Your best find of the hour, easily.",
    "The vault opens on something genuinely pretty.",
    "This rock was hiding actual treasure.",
    "A crystal with presence — look at it turn.",
    "The belt tipped its hand this time.",
    "Scanners don't usually get this excited.",
  ], [
    "Collect it — finds like this move rankings.",
    "Tap it and watch your balance jump.",
    "That's a proper step up the leaderboard.",
    "Take it; the galaxy is watching.",
    "Secure it and keep the run going.",
  ]),
  T(4, "Radiant Core", 400, 999, 11, [
    "A radiant core — this rock had a heart after all.",
    "Whoa. The whole chamber hums around this one.",
    "You've made it to something genuinely rare.",
    "The light off this crystal reaches every wall.",
    "Most explorers never crack a rock like this.",
    "The vault was guarding a real prize.",
    "This is the kind of find that starts rumors.",
    "A core crystal, intact and glowing.",
    "The belt just paid you a compliment.",
    "Your scanners are not exaggerating.",
  ], [
    "Collect it — this one changes your standing.",
    "Take it before the rock reconsiders.",
    "That's hundreds of fragments in one tap.",
    "Bank it and enjoy the climb.",
    "Yours. The leaderboard will notice.",
  ]),
  T(5, "Lucky Strike", 1_000, 2_999, 10, [
    "Wow — you are lucky. This is a big one.",
    "A thousand-class crystal. In an unmarked rock.",
    "The chamber can barely hold the light.",
    "Strike! The kind explorers brag about.",
    "You've hit a genuine lucky vein.",
    "This rock was saving itself for you.",
    "Four figures of pure fragment.",
    "The vault opens on a small fortune.",
    "Some dives just pay off. This is one.",
    "The belt is being generous today.",
  ], [
    "Collect it and climb — hard.",
    "Tap it; that's a leaderboard leap.",
    "Take your strike and ride the streak.",
    "Secure it before you wake up.",
    "One tap. Thousands of fragments.",
  ]),
  T(6, "Vault Breaker", 3_000, 9_999, 8, [
    "Vault breaker. The rock never stood a chance.",
    "This is what the deep belt whispers about.",
    "A crystal this size bends the room around it.",
    "You've made it to a five-alarm find.",
    "The scanners flat-lined, then screamed.",
    "Explorers chart whole routes hoping for this.",
    "The chamber glows like a small sun.",
    "A hoard-class crystal, and it's just sitting there.",
    "Somewhere, a rival explorer just shivered.",
    "The belt's poker face finally cracked.",
  ], [
    "Collect it — that's a ranking rewritten.",
    "Take it and let the toast say the rest.",
    "Thousands upon thousands. One tap.",
    "Bank it; legends need receipts.",
    "Yours, if your hands are steady.",
  ]),
  T(7, "Titan Heart", 10_000, 49_999, 6, [
    "A titan heart. Ten thousand class. Breathe.",
    "The crystal fills half the chamber and all of your screen.",
    "This is not a find; it's an event.",
    "You've made it to the kind of rock stories start with.",
    "The glow reaches into your bones.",
    "Most explorers go a lifetime without this.",
    "The vault didn't hide this — it worshiped it.",
    "Even the dust here seems rich.",
    "Your name is about to travel the galaxy.",
    "The belt kept its best behind this wall.",
  ], [
    "Collect it and watch the galaxy react.",
    "One tap and the leaderboard shakes.",
    "Take it — history favors the bold.",
    "Secure the heart. Then breathe again.",
    "That's a rank-defining haul.",
  ]),
  T(8, "Galaxy Jewel", 50_000, 249_999, 5, [
    "A galaxy jewel. Six figures of light.",
    "The chamber is more crystal than rock now.",
    "You've found what fleets have searched for.",
    "This is the glow other explorers see in dreams.",
    "The scanners refuse to print the number.",
    "A jewel this size has gravity of its own.",
    "The belt just handed you a crown.",
    "Every wall reflects your fortune back at you.",
    "Finds like this rewrite the top ten.",
    "You may want to sit down for the number.",
  ], [
    "Collect it — the toast will cause panic.",
    "Take it and ascend the board.",
    "One tap: six figures, forever yours.",
    "Secure the jewel. Then go brag.",
    "The leaderboard is about to bend.",
  ]),
  T(9, "Million Vault", 250_000, 1_000_000, 3, [
    "THE MILLION VAULT. It's real. It's here. It's yours to collect.",
    "The crystal fills the entire chamber — you're standing inside the prize.",
    "This is the find the whole galaxy whispers about.",
    "Numbers this size have their own weather.",
    "You've made it to the belt's crown treasure.",
    "The room is light. The light is fragments.",
    "Every explorer alive will see this toast.",
    "The vault of vaults, cracked by you.",
    "Scanners across the galaxy just spiked.",
    "There are legends, and then there is this.",
  ], [
    "COLLECT IT. Then never stop telling the story.",
    "One tap and the top of the board is yours.",
    "Take it — the galaxy deserves the shockwave.",
    "Secure the vault and take your throne.",
    "Tap. Collect. Reign.",
  ]),
];

export function tierForValue(value: number): CrystalTier {
  return (
    CRYSTAL_TIERS.find((tier) => value <= tier.max) ??
    CRYSTAL_TIERS[CRYSTAL_TIERS.length - 1]!
  );
}

/** Weighted tier roll + a value inside the tier, all from one seed. */
export function rollCrystalValue(seed: number): { tier: CrystalTier; value: number } {
  const random = mulberry32(seed ^ 0x71e125);
  const totalWeight = CRYSTAL_TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let pick = random() * totalWeight;
  let tier = CRYSTAL_TIERS[0]!;
  for (const candidate of CRYSTAL_TIERS) {
    pick -= candidate.weight;
    if (pick <= 0) {
      tier = candidate;
      break;
    }
  }
  const span = tier.max - tier.min;
  const raw = tier.min + random() * span;
  // Round to a tier-appropriate step so values read cleanly.
  const step = tier.max >= 100_000 ? 1000 : tier.max >= 1000 ? 50 : tier.max >= 100 ? 5 : 1;
  const value = Math.min(tier.max, Math.max(tier.min, Math.round(raw / step) * step));
  return { tier, value };
}

/** One of the tier's 50 unique openers (10 leads × 5 closers), seeded. */
export function crystalOpener(tier: CrystalTier, seed: number): string {
  const random = mulberry32(seed ^ 0x09e4e5);
  const lead = tier.leads[Math.floor(random() * tier.leads.length)]!;
  const closer = tier.closers[Math.floor(random() * tier.closers.length)]!;
  return `${lead} ${closer}`;
}
