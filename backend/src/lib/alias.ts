/**
 * Deterministic waitlist alias + welcome line generation.
 *
 * Aliases are "<Prefix> <Role>" pairs ("Orbit Surfer", "Nova Cartographer")
 * picked from two fixed 250-entry lists themed around the product universe:
 * the Nexus/Core/Command/Studio/Launch surfaces, the orchestrators
 * (Atlas, Hermes, Metis, Apollo, Iris, Ledger, Orbit, Athena, Forge,
 * Mercury, Sentinel, Themis), and capabilities (Archive, Gallery, Signal,
 * Compass, Ascend) — mythic and spacefaring. The pick is a pure function of
 * the seed string (usually the user key), so the same user always gets the
 * same alias.
 */

export const ALIAS_PREFIXES: readonly string[] = [
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

export const ALIAS_ROLES: readonly string[] = [
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

/** Deterministically picks a welcome line for a seed and interpolates `{alias}`. */
export function pickWelcomeLine(seedString: string, alias: string): string {
  const line = WELCOME_LINES[hashSeed(`welcome:${seedString}`) % WELCOME_LINES.length] ?? WELCOME_LINES[0]!;
  return line.replaceAll('{alias}', alias);
}
