import { describe, expect, test } from 'bun:test';
import { mp3DurationMs } from './mp3-duration';

function frame({ bitrateIndex = 9, sampleRateIndex = 0, versionBits = 3 }: { bitrateIndex?: number; sampleRateIndex?: number; versionBits?: number } = {}) {
  const header = (0x7ff << 21) | (versionBits << 19) | (1 << 17) | (1 << 16) | (bitrateIndex << 12) | (sampleRateIndex << 10);
  const sampleRate = versionBits === 3 ? [44_100, 48_000, 32_000][sampleRateIndex]! : [22_050, 24_000, 16_000][sampleRateIndex]!;
  const bitrate = (versionBits === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]! * 1_000;
  const length = Math.floor((versionBits === 3 ? 144 : 72) * bitrate / sampleRate);
  const bytes = new Uint8Array(length);
  bytes[0] = header >>> 24; bytes[1] = header >>> 16; bytes[2] = header >>> 8; bytes[3] = header;
  return bytes;
}

describe('MP3 duration', () => {
  test('sums complete MPEG-1 Layer III frames', () => {
    const frames = Array.from({ length: 100 }, () => frame());
    expect(mp3DurationMs(Buffer.concat(frames))).toBe(2_612);
  });

  test('supports MPEG-2 frames and skips ID3 metadata', () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
    expect(mp3DurationMs(Buffer.concat([id3, frame({ versionBits: 2 }), frame({ versionBits: 2 })]))).toBe(52);
  });

  test('rejects malformed and truncated MP3 data', () => {
    expect(() => mp3DurationMs(new Uint8Array([1, 2, 3]))).toThrow('no complete');
    expect(() => mp3DurationMs(frame().slice(0, 20))).toThrow('no complete');
  });
});
