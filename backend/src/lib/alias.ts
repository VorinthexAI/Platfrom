/**
 * Deterministic waitlist alias + welcome line generation.
 *
 * Aliases are "<Prefix> <Role>" pairs ("Orbit Surfer", "Nova Cartographer")
 * picked from two fixed 10000-entry lists themed around the product universe:
 * the Nexus/Core/Command/Studio/Launch surfaces, the orchestrators
 * (Atlas, Hermes, Metis, Apollo, Iris, Ledger, Orbit, Athena, Forge,
 * Mercury, Sentinel, Themis), and capabilities (Archive, Gallery, Signal,
 * Compass, Ascend) — mythic and spacefaring. Each list is 250 hand-picked
 * words plus 9750 deterministic compounds (head × tail, deduplicated), for
 * 10000 × 10000 = one hundred million distinct aliases. The pick is a pure function
 * of the seed string (usually the user key), so the same user always gets
 * the same alias.
 * Current enforced guarantee: 10000 prefixes x 10000 roles = 100000000 aliases.
 */

const BASE_ALIAS_PREFIXES: readonly string[] = [
  'Orbit', 'Nexus', 'Nova', 'Ion', 'Zenith', 'Quantum', 'Astral', 'Ember', 'Chrome', 'Obsidian',
  'Void', 'Stellar', 'Lunar', 'Solar', 'Comet', 'Nebula', 'Photon', 'Gravity', 'Halo', 'Drift',
  'Pulse', 'Vector', 'Cipher', 'Atlas', 'Aurora', 'Apex', 'Aether', 'Axiom', 'Beacon', 'Binary',
  'Blaze', 'Borealis', 'Catalyst', 'Celestial', 'Circuit', 'Cobalt', 'Cosmic', 'Crimson', 'Crystal', 'Cryo',
  'Delta', 'Dusk', 'Dynamo', 'Echo', 'Eclipse', 'Ecliptic', 'Electric', 'Elysian', 'Enigma', 'Epoch',
  'Equinox', 'Ether', 'Falcon', 'Flare', 'Flux', 'Forge', 'Fractal', 'Fusion', 'Galactic', 'Gamma',
  'Glacier', 'Gossamer', 'Granite', 'Graviton', 'Helio', 'Helix', 'Hermes', 'Horizon', 'Hyper', 'Igneous',
  'Indigo', 'Inertia', 'Infra', 'Iridium', 'Iris', 'Iron', 'Jade', 'Jet', 'Kepler', 'Kinetic',
  'Krypton', 'Lattice', 'Ledger', 'Lithium', 'Lucent', 'Lumen', 'Luminous', 'Magnetar', 'Magnetic', 'Mercury',
  'Meridian', 'Meteor', 'Metis', 'Midnight', 'Mirage', 'Momentum', 'Monolith', 'Mosaic', 'Mythic', 'Nadir',
  'Neon', 'Neutron', 'Nimbus', 'Nocturne', 'Nomad', 'Nucleus', 'Oblivion', 'Occult', 'Ochre', 'Odyssey',
  'Omega', 'Onyx', 'Opal', 'Oracle', 'Orchid', 'Orion', 'Osmium', 'Outer', 'Ozone', 'Palladium',
  'Paradox', 'Parallax', 'Particle', 'Pearl', 'Penumbra', 'Perigee', 'Phantom', 'Phase', 'Phoenix', 'Pilot',
  'Pinnacle', 'Plasma', 'Platinum', 'Polar', 'Polaris', 'Prime', 'Prism', 'Proton', 'Pulsar', 'Quasar',
  'Quartz', 'Quicksilver', 'Radiant', 'Radial', 'Rapid', 'Raven', 'Reactor', 'Relay', 'Rift', 'Rocket',
  'Rogue', 'Rune', 'Saffron', 'Sapphire', 'Satellite', 'Scarlet', 'Seismic', 'Sentinel', 'Shadow', 'Shard',
  'Sidereal', 'Signal', 'Silent', 'Silver', 'Singular', 'Sirius', 'Skyline', 'Solaris', 'Solstice', 'Sonic',
  'Spark', 'Spectra', 'Spectral', 'Sphere', 'Spiral', 'Starlit', 'Static', 'Steel', 'Storm', 'Stratos',
  'Sublime', 'Summit', 'Super', 'Surge', 'Swift', 'Sylvan', 'Synth', 'Tachyon', 'Talon', 'Tandem',
  'Tectonic', 'Tempest', 'Terra', 'Tesla', 'Themis', 'Thermal', 'Thunder', 'Tidal', 'Titan', 'Titanium',
  'Topaz', 'Torrent', 'Tundra', 'Turbo', 'Twilight', 'Ultra', 'Umbra', 'Unity', 'Uplink', 'Uranium',
  'Vanguard', 'Vantage', 'Vapor', 'Velocity', 'Verdant', 'Vertex', 'Vesper', 'Violet', 'Vivid', 'Volt',
  'Vortex', 'Voyage', 'Wander', 'Warp', 'Wavelength', 'Western', 'Whisper', 'Wild', 'Winter', 'Wraith',
  'Xenon', 'Yonder', 'Zephyr', 'Zeta', 'Zircon', 'Zodiac', 'Zonal', 'Apollo', 'Athena', 'Ascend',
  'Archive', 'Gallery', 'Compass', 'Command', 'Core', 'Studio', 'Launch', 'Lyric', 'Marble', 'Mistral',
];

const BASE_ALIAS_ROLES: readonly string[] = [
  'Surfer', 'Explorer', 'Voyager', 'Pathfinder', 'Cartographer', 'Navigator', 'Sentinel', 'Architect', 'Pioneer', 'Wanderer',
  'Harbinger', 'Custodian', 'Archivist', 'Signalist', 'Pilot', 'Captain', 'Commander', 'Scout', 'Ranger', 'Warden',
  'Keeper', 'Seeker', 'Sage', 'Oracle', 'Herald', 'Envoy', 'Emissary', 'Courier', 'Engineer', 'Artificer',
  'Alchemist', 'Astronomer', 'Stargazer', 'Skywatcher', 'Chronicler', 'Scribe', 'Curator', 'Librarian', 'Founder', 'Builder',
  'Maker', 'Smith', 'Forger', 'Shipwright', 'Starwright', 'Wayfarer', 'Trailblazer', 'Vanguardist', 'Outrider', 'Freelancer',
  'Corsair', 'Privateer', 'Buccaneer', 'Skipper', 'Helmsman', 'Quartermaster', 'Boatswain', 'Stargate', 'Gatekeeper', 'Watchman',
  'Lookout', 'Spotter', 'Tracker', 'Hunter', 'Gatherer', 'Harvester', 'Prospector', 'Surveyor', 'Assessor', 'Analyst',
  'Strategist', 'Tactician', 'Planner', 'Designer', 'Draftsman', 'Composer', 'Conductor', 'Maestro', 'Virtuoso', 'Artisan',
  'Craftsman', 'Technician', 'Mechanic', 'Operator', 'Controller', 'Dispatcher', 'Broadcaster', 'Transmitter', 'Receiver', 'Decoder',
  'Encoder', 'Cryptographer', 'Codebreaker', 'Linguist', 'Translator', 'Interpreter', 'Mediator', 'Diplomat', 'Ambassador', 'Consul',
  'Legate', 'Marshal', 'General', 'Admiral', 'Commodore', 'Lieutenant', 'Sergeant', 'Corporal', 'Cadet', 'Recruit',
  'Initiate', 'Apprentice', 'Journeyman', 'Adept', 'Master', 'Grandmaster', 'Elder', 'Ancient', 'Primarch', 'Patriarch',
  'Matriarch', 'Regent', 'Sovereign', 'Monarch', 'Baron', 'Duke', 'Count', 'Viceroy', 'Chancellor', 'Steward',
  'Bailiff', 'Sheriff', 'Constable', 'Guardian', 'Protector', 'Defender', 'Shieldbearer', 'Standardbearer', 'Bannerman', 'Torchbearer',
  'Lightkeeper', 'Beaconer', 'Lampwright', 'Lanternist', 'Flarecaster', 'Sparkwright', 'Stormcaller', 'Windrider', 'Cloudwalker', 'Skysailor',
  'Aeronaut', 'Astronaut', 'Cosmonaut', 'Spacefarer', 'Starfarer', 'Voidwalker', 'Riftrunner', 'Warpdiver', 'Jumpmaster', 'Dropship',
  'Payloader', 'Cargomaster', 'Freighter', 'Hauler', 'Runner', 'Racer', 'Sprinter', 'Dasher', 'Glider', 'Drifter',
  'Floater', 'Hoverer', 'Orbiter', 'Circler', 'Looper', 'Spinner', 'Weaver', 'Threader', 'Knitter', 'Binder',
  'Linker', 'Bridger', 'Connector', 'Networker', 'Meshwright', 'Gridkeeper', 'Nodekeeper', 'Hubmaster', 'Portkeeper', 'Dockmaster',
  'Harbormaster', 'Anchorite', 'Moorer', 'Berther', 'Launcher', 'Igniter', 'Kindler', 'Stoker', 'Fueler', 'Charger',
  'Amplifier', 'Booster', 'Elevator', 'Ascender', 'Climber', 'Summiteer', 'Peakfinder', 'Ridgewalker', 'Cliffhanger', 'Spelunker',
  'Delver', 'Miner', 'Digger', 'Excavator', 'Unearther', 'Discoverer', 'Finder', 'Locator', 'Pinpointer', 'Mapper',
  'Charter', 'Plotter', 'Grapher', 'Recorder', 'Register', 'Ledgerkeeper', 'Accountant', 'Auditor', 'Appraiser', 'Valuer',
  'Collector', 'Assembler', 'Compiler', 'Aggregator', 'Synthesizer', 'Distiller', 'Refiner', 'Polisher', 'Finisher', 'Perfecter',
  'Optimizer', 'Calibrator', 'Tuner', 'Balancer', 'Harmonizer', 'Resonator', 'Echoist', 'Soundsmith', 'Wavecrafter', 'Tidewatcher',
];

/**
 * Deterministic compound builder: crosses heads × tails, skips anything
 * already in the base list (or a self-echo like Stormstorm), and returns
 * exactly `needed` unique words. Throws at module load if the pools ever
 * shrink below the target — the 10000-entry guarantee is enforced, not
 * hoped for.
 */
function buildCompounds(
  base: readonly string[],
  heads: readonly string[],
  tails: readonly string[],
  needed: number,
): string[] {
  const seen = new Set(base.map((word) => word.toLowerCase()));
  const out: string[] = [];
  for (const head of heads) {
    for (const tail of tails) {
      if (out.length >= needed) return out;
      if (head.toLowerCase() === tail.toLowerCase()) continue;
      const word = `${head}${tail}`;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(word);
    }
  }
  if (out.length < needed) {
    throw new Error(`alias compound pool exhausted: ${out.length}/${needed}`);
  }
  return out;
}

const PREFIX_HEADS: readonly string[] = [
  'Star', 'Sky', 'Sun', 'Moon', 'Void', 'Iron', 'Storm', 'Frost', 'Ash', 'Night',
  'Dawn', 'Dusk', 'Ever', 'Deep', 'Far', 'High', 'True', 'Wild', 'Silver', 'Golden',
  'Astro', 'Cosmo', 'Hyper', 'Ultra', 'Nova', 'Nebula', 'Comet', 'Orbit', 'Aero', 'Chrono',
  'Cryo', 'Umbra', 'Nexus', 'Core', 'Command', 'Studio', 'Launch', 'Atlas', 'Hermes', 'Metis',
  'Apollo', 'Iris', 'Ledger', 'Mercury', 'Sentinel', 'Athena', 'Forge', 'Themis', 'Archive', 'Gallery',
  'Signal', 'Compass', 'Ascend', 'Aether', 'Axiom', 'Beacon', 'Binary', 'Catalyst', 'Celestial', 'Circuit',
  'Cobalt', 'Cosmic', 'Crimson', 'Crystal', 'Delta', 'Dynamo', 'Echo', 'Eclipse', 'Electric', 'Elysian',
  'Enigma', 'Epoch', 'Equinox', 'Falcon', 'Flare', 'Flux', 'Fractal', 'Fusion', 'Galactic', 'Gamma',
  'Glacier', 'Granite', 'Graviton', 'Helio', 'Helix', 'Horizon', 'Igneous', 'Indigo', 'Inertia', 'Iridium',
  'Jade', 'Kepler', 'Kinetic', 'Krypton', 'Lattice', 'Lithium', 'Lucent', 'Lumen', 'Magnetar', 'Magnetic',
  'Meridian', 'Meteor', 'Midnight', 'Mirage', 'Momentum', 'Monolith', 'Mosaic', 'Mythic', 'Nadir', 'Neon',
  'Neutron', 'Nimbus', 'Nocturne', 'Nomad', 'Nucleus', 'Oblivion', 'Odyssey', 'Omega', 'Onyx', 'Opal',
  'Oracle', 'Orion', 'Osmium', 'Paradox', 'Parallax', 'Particle', 'Pearl', 'Penumbra', 'Perigee', 'Phantom',
  'Phoenix', 'Pinnacle', 'Plasma', 'Platinum', 'Polaris', 'Prime', 'Prism', 'Proton', 'Pulsar', 'Quasar',
  'Quartz', 'Radiant', 'Radial', 'Reactor', 'Relay', 'Rift', 'Rocket', 'Rune', 'Sapphire', 'Satellite',
];

const PREFIX_TAILS: readonly string[] = [
  'fall', 'fire', 'gate', 'glow', 'wind', 'wake', 'veil', 'forge', 'light', 'spire',
  'drift', 'born', 'bound', 'crest', 'shade', 'song', 'spark', 'field', 'flare', 'helm',
  'mark', 'path', 'rise', 'reach', 'tide', 'beam', 'bloom', 'bridge', 'burst', 'call',
  'channel', 'chord', 'cipher', 'crown', 'current', 'deck', 'dome', 'drive', 'echo', 'edge',
  'engine', 'flow', 'frame', 'front', 'garden', 'grid', 'grove', 'harbor', 'hatch', 'haven',
  'horizon', 'key', 'lance', 'lantern', 'line', 'link', 'matrix', 'mirror', 'node', 'pathway',
  'phase', 'pillar', 'portal', 'pulse', 'rail', 'relay', 'rift', 'ring', 'root', 'sail',
  'seal', 'sector', 'signal', 'sphere', 'stack', 'stream', 'summit', 'trail', 'vault', 'vector',
  'vertex', 'vessel', 'vista', 'wave', 'weave', 'wing', 'yard', 'anchor', 'array', 'axis',
  'beacon', 'belt', 'bridgeway', 'camp', 'chart', 'cradle', 'dock', 'gatehouse', 'harvest', 'keel',
  'loom', 'map', 'needle', 'orbit', 'prism', 'quartz', 'yardarm',
];

const ROLE_HEADS: readonly string[] = [
  'Star', 'Void', 'Sky', 'Rift', 'Belt', 'Core', 'Dust', 'Flux', 'Nova', 'Orbit',
  'Comet', 'Nebula', 'Photon', 'Aurora', 'Ion', 'Warp', 'Beacon', 'Cipher', 'Signal', 'Vault',
  'Relic', 'Ember', 'Frost', 'Storm', 'Dawn', 'Night', 'Halo', 'Prism', 'Quasar', 'Pulse',
  'Crystal', 'Fragment', 'Nexus', 'Command', 'Studio', 'Launch', 'Atlas', 'Hermes', 'Metis', 'Apollo',
  'Iris', 'Ledger', 'Mercury', 'Sentinel', 'Athena', 'Forge', 'Themis', 'Archive', 'Gallery', 'Compass',
  'Ascend', 'Aether', 'Axiom', 'Binary', 'Circuit', 'Cosmic', 'Delta', 'Echo', 'Eclipse', 'Equinox',
  'Falcon', 'Flare', 'Fractal', 'Fusion', 'Gamma', 'Glacier', 'Graviton', 'Helix', 'Horizon', 'Kepler',
  'Kinetic', 'Lattice', 'Lumen', 'Magnetar', 'Meridian', 'Meteor', 'Midnight', 'Mirage', 'Monolith', 'Mosaic',
  'Neutron', 'Nimbus', 'Nomad', 'Nucleus', 'Odyssey', 'Omega', 'Onyx', 'Oracle', 'Orion', 'Parallax',
  'Particle', 'Phoenix', 'Plasma', 'Polaris', 'Proton', 'Pulsar', 'Quartz', 'Radiant', 'Reactor', 'Relay',
  'Rocket', 'Rune', 'Satellite', 'Shadow', 'Shard', 'Silver', 'Solstice', 'Spectral', 'Spiral', 'Static',
  'Steel', 'Summit', 'Surge', 'Tachyon', 'Talon', 'Tempest', 'Thunder', 'Titan', 'Uplink',
];

const ROLE_TAILS: readonly string[] = [
  'smith', 'wright', 'warden', 'keeper', 'seeker', 'walker', 'rider', 'singer', 'caller', 'bringer',
  'weaver', 'watcher', 'chaser', 'breaker', 'shaper', 'bearer', 'finder', 'reader', 'guard', 'scribe',
  'herald', 'knight', 'marshal', 'pilot', 'scout', 'architect', 'archivist', 'artisan', 'assembler', 'auditor',
  'builder', 'calibrator', 'captain', 'cartographer', 'chronicler', 'commander', 'composer', 'conductor', 'connector', 'courier',
  'curator', 'decoder', 'defender', 'delver', 'designer', 'discoverer', 'dispatcher', 'distiller', 'engineer', 'envoy',
  'explorer', 'forger', 'founder', 'gatherer', 'guardian', 'harvester', 'igniter', 'interpreter', 'launcher', 'librarian',
  'locator', 'maker', 'mapper', 'navigator', 'operator', 'optimizer', 'pathfinder', 'pioneer', 'planner', 'plotter',
  'prospector', 'protector', 'ranger', 'recorder', 'refiner', 'runner', 'sage', 'sentinel', 'strategist', 'surveyor',
  'synthesizer', 'tactician', 'technician', 'tracker', 'translator', 'tuner', 'voyager', 'wanderer', 'wayfarer', 'analyst',
  'appraiser', 'balancer', 'beaconer', 'bridger', 'controller', 'diplomat', 'harbinger', 'mediator', 'oracle', 'polisher',
  'resonator', 'stargazer', 'steward', 'trailblazer', 'transmitter', 'vanguardist', 'virtuoso', 'wavecrafter', 'windrider',
];

export const ALIAS_PREFIXES: readonly string[] = [
  ...BASE_ALIAS_PREFIXES,
  ...buildCompounds(BASE_ALIAS_PREFIXES, PREFIX_HEADS, PREFIX_TAILS, 9750),
];

export const ALIAS_ROLES: readonly string[] = [
  ...BASE_ALIAS_ROLES,
  ...buildCompounds(BASE_ALIAS_ROLES, ROLE_HEADS, ROLE_TAILS, 9750),
];

/**
 * 50 distinct welcome lines shown after email verification. `{alias}` is
 * interpolated server-side via {@link pickWelcomeLine}.
 */
export const WELCOME_LINES: readonly string[] = [
  'Welcome, {alias}. You have joined a very exclusive club.',
  'The Nexus has recorded your arrival, {alias}.',
  'Signal received, {alias}. The constellation grows brighter.',
  'Your coordinates are locked in, {alias}. Stand by for launch.',
  'The Core acknowledges you, {alias}. Few make it this far.',
  '{alias}, your seat on the first voyage is confirmed.',
  'A new light appears on the star map. Welcome, {alias}.',
  'The Archive will remember this day, {alias}.',
  'Atlas has marked your position, {alias}. Hold steady.',
  'Clearance granted, {alias}. The Command deck awaits.',
  'You crossed the threshold, {alias}. There is no ordinary from here.',
  'The orbit is set, {alias}. Gravity will do the rest.',
  'Hermes carried the news fast — {alias} has arrived.',
  '{alias}, the Forge is already shaping something for you.',
  'One more explorer among the stars. Welcome aboard, {alias}.',
  'Your beacon is lit, {alias}. Others will navigate by it.',
  'Athena approves of this decision, {alias}.',
  'The Gallery has reserved a frame for you, {alias}.',
  'Docking complete, {alias}. Make yourself at home.',
  'History will note that {alias} was here early.',
  'The Compass points to you now, {alias}.',
  '{alias}, the countdown just got one name louder.',
  'Mercury delivered your credentials, {alias}. All systems green.',
  'A rare signature detected: {alias}. Welcome to the inner ring.',
  'The Sentinels stand a little taller today, {alias}.',
  '{alias}, you are officially ahead of the curve.',
  'The Launch window widens for you, {alias}.',
  'Iris has seen your arrival, {alias}, and it looks bright.',
  'Your fragment of the future is secured, {alias}.',
  'Themis has weighed your entry, {alias}. The verdict: welcome.',
  'The Studio lights just flickered on for you, {alias}.',
  'Transmission confirmed, {alias}. You are on the manifest.',
  '{alias}, the frontier just gained a familiar name.',
  'Metis whispers that you chose well, {alias}.',
  'Welcome to the quiet before the launch, {alias}.',
  'Your name now travels with the fleet, {alias}.',
  'The Ledger balances in your favor, {alias}.',
  '{alias}, consider this your boarding pass to what comes next.',
  'Stars align on schedule. So did you, {alias}.',
  'The airlock seals behind you, {alias}. Welcome inside.',
  'Apollo tuned the instruments for your arrival, {alias}.',
  'You are early, {alias}. That is exactly the point.',
  'A new orbit begins today, {alias}.',
  'The Signal tower logged you first, {alias}.',
  'Every expedition needs a {alias}. Now we have ours.',
  'Ascend protocol initiated, {alias}. Enjoy the climb.',
  'The map was missing a marker until you arrived, {alias}.',
  'Welcome to the launch roster, {alias}. Ink still drying.',
  '{alias}, the universe keeps a short list. You are on it.',
  'All stations report ready, {alias}. Glad you made it.',
];

function hashSeed(seed: string): number {
  // FNV-1a 32-bit: tiny, dependency-free, and stable across runtimes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically derives a "<Prefix> <Role>" alias from a seed (usually the user key). */
export function generateAlias(seedString: string): string {
  const prefix = ALIAS_PREFIXES[hashSeed(`prefix:${seedString}`) % ALIAS_PREFIXES.length];
  const role = ALIAS_ROLES[hashSeed(`role:${seedString}`) % ALIAS_ROLES.length];
  return `${prefix} ${role}`;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'explorer';
}

export const ALIAS_SLUG_PREFIX_SPACE = 26 ** 4;

function fourLettersFromNumber(value: number): string {
  let hash = value;
  let out = '';
  for (let index = 0; index < 4; index += 1) {
    out += String.fromCharCode(97 + (hash % 26));
    hash = Math.floor(hash / 26);
  }
  return out;
}

/** Builds "abcd-orbit-surfer" style public user slugs. Pass a larger attempt on collision. */
export function generateAliasSlug(alias: string, seedString: string, attempt = 0): string {
  const offset = hashSeed(`alias_slug:${seedString}`) % ALIAS_SLUG_PREFIX_SPACE;
  const prefixIndex = (offset + (attempt * 17)) % ALIAS_SLUG_PREFIX_SPACE;
  return `${fourLettersFromNumber(prefixIndex)}-${slugPart(alias)}`;
}

/** Deterministically picks a welcome line for a seed and interpolates `{alias}`. */
export function pickWelcomeLine(seedString: string, alias: string): string {
  const line = WELCOME_LINES[hashSeed(`welcome:${seedString}`) % WELCOME_LINES.length] ?? WELCOME_LINES[0]!;
  return line.replaceAll('{alias}', alias);
}
