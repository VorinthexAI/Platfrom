const MPEG1_LAYER3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const MPEG2_LAYER3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;

function synchsafe(bytes: Uint8Array, offset: number) {
  return ((bytes[offset]! & 0x7f) << 21) | ((bytes[offset + 1]! & 0x7f) << 14) | ((bytes[offset + 2]! & 0x7f) << 7) | (bytes[offset + 3]! & 0x7f);
}

/** Calculates duration from MPEG Layer III frame headers without trusting VBR metadata. */
export function mp3DurationMs(bytes: Uint8Array) {
  let offset = bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 ? 10 + synchsafe(bytes, 6) : 0;
  let durationSeconds = 0;
  let frames = 0;
  while (offset + 4 <= bytes.length) {
    const header = ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    if (((header & 0xffe00000) >>> 0) !== 0xffe00000) { offset += 1; continue; }
    const versionBits = (header >>> 19) & 0x3;
    const layerBits = (header >>> 17) & 0x3;
    const bitrateIndex = (header >>> 12) & 0xf;
    const sampleRateIndex = (header >>> 10) & 0x3;
    if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) { offset += 1; continue; }
    const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
    const baseSampleRate = [44_100, 48_000, 32_000][sampleRateIndex]!;
    const sampleRate = version === 1 ? baseSampleRate : version === 2 ? baseSampleRate / 2 : baseSampleRate / 4;
    const bitrate = (version === 1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex]! * 1_000;
    const padding = (header >>> 9) & 0x1;
    const frameLength = Math.floor((version === 1 ? 144 : 72) * bitrate / sampleRate) + padding;
    if (frameLength < 4 || offset + frameLength > bytes.length) { offset += 1; continue; }
    durationSeconds += (version === 1 ? 1_152 : 576) / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  if (frames === 0) throw new Error('MP3 audio contains no complete MPEG Layer III frames.');
  return Math.max(1, Math.round(durationSeconds * 1_000));
}
