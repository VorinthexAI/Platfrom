import { mulberry32 } from "@/lib/three/procedural";

/**
 * The leaderboard's living copy. Nothing here is static: every update
 * re-rolls a line, so the board always talks back.
 *
 * - Standing lines: 3 tiers (climbing / steady / falling), 100 unique
 *   lines each — 10 leads × 10 urgings per tier.
 * - Galaxy-pulse lines: 50 unique variations (10 leads × 5 tails) around
 *   the live active-explorer count.
 */

export type StandingTier = "win" | "draw" | "lose";

const STANDING_LEADS: Record<StandingTier, string[]> = {
  win: [
    "You are climbing.",
    "Up you go.",
    "The board just moved under you.",
    "Gaining ground, explorer.",
    "Your name is rising.",
    "That last haul pushed you up.",
    "Momentum is yours.",
    "The ranks parted for you.",
    "You are on the ascent.",
    "Higher than a moment ago.",
  ],
  draw: [
    "You are holding steady.",
    "Your place holds for now.",
    "The board settled around you.",
    "No movement this beat.",
    "You are pinned in place.",
    "Steady orbit, explorer.",
    "The ranks held their breath.",
    "Locked in, neither up nor down.",
    "Your spot survived the update.",
    "Stable, but stability is temporary out here.",
  ],
  lose: [
    "You are falling.",
    "Someone just passed you.",
    "The board moved against you.",
    "Ground lost, explorer.",
    "Your name slipped a rung.",
    "That update stung.",
    "Rivals are outcollecting you.",
    "The ranks closed over you.",
    "You are on the descent.",
    "Lower than a moment ago.",
  ],
};

const STANDING_URGINGS: Record<StandingTier, string[]> = {
  win: [
    "Keep exploring the galaxy and collect fragments to lock in your place.",
    "Crack another asteroid while the streak is hot.",
    "Do not stop now, the next crystal keeps you climbing.",
    "Ride it: every collect right now compounds.",
    "One more vault and the rank above is yours.",
    "The board loves a collector on a run, so feed it.",
    "Stack fragments while your rivals sleep.",
    "Push on; the top rows are watching you approach.",
    "Collect fast, climb faster.",
    "Your momentum is fuel, so spend it on more rocks.",
  ],
  draw: [
    "Collect more fragments to keep it that way.",
    "Steady only lasts as long as your next collect.",
    "A single crystal would tip you upward.",
    "Hold the line, then break it upward with a new haul.",
    "Rivals are collecting right now; match them.",
    "One good vault turns steady into climbing.",
    "Keep exploring so the board keeps your name warm.",
    "Defend your place the only way that works: collect more.",
    "Do not let this become the high point.",
    "The next asteroid decides which way you move.",
  ],
  lose: [
    "Collect fragments now to take your place back.",
    "One vault can undo this, go find it.",
    "The fastest way back up is the next asteroid.",
    "Do not watch your name sink; outcollect them.",
    "Retake your rank one crystal at a time.",
    "Every fragment you leave behind helps a rival.",
    "Turn it around before the gap widens.",
    "The board forgets quickly, so remind it who you are.",
    "Strike back with a big find.",
    "Falling is temporary for explorers who keep digging.",
  ],
};

/** One of the tier's 100 unique standing lines (10 leads × 10 urgings). */
export function standingLine(tier: StandingTier, seed: number): string {
  const random = mulberry32(seed ^ 0x57a2d);
  const lead = STANDING_LEADS[tier][Math.floor(random() * 10)]!;
  const urging = STANDING_URGINGS[tier][Math.floor(random() * 10)]!;
  return `${lead} ${urging}`;
}

const PULSE_LEADS = [
  "{count} active explorers are collecting fragments all day",
  "{count} explorers are cracking asteroids right now",
  "{count} rivals are out in the belt as you read this",
  "{count} collectors are working the galaxy this very minute",
  "{count} explorers are filling their vaults right now",
  "{count} names on this board are still out there digging",
  "{count} active ships are sweeping the belt for crystals",
  "{count} explorers collected their way onto this board today",
  "{count} fragment hunters are live in the galaxy",
  "{count} explorers are racing you to the next vault",
];

const PULSE_TAILS = [
  "so do not lose out.",
  "and every minute you wait, they gain.",
  "because the board never sleeps.",
  "and your rank is only safe if you are one of them.",
  "so get back out there.",
];

/** One of 50 unique galaxy-pulse lines, seeded per update. */
export function galaxyPulseLine(count: number, seed: number): string {
  const random = mulberry32(seed ^ 0x9a1a);
  const lead = PULSE_LEADS[Math.floor(random() * PULSE_LEADS.length)]!;
  const tail = PULSE_TAILS[Math.floor(random() * PULSE_TAILS.length)]!;
  return `${lead.replace("{count}", String(Math.max(count, 1)))} ${tail}`;
}
