import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function concatPath(path: string) {
  return path.replaceAll("'", "'\\''").replaceAll('\\', '/');
}

type FfmpegRunner = (args: string[], signal?: AbortSignal) => Promise<void>;

const runFfmpeg: FfmpegRunner = (args, signal) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args, { windowsHide: true });
  let error = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { if (error.length < 16_384) error += String(chunk).slice(0, 16_384 - error.length); });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Audio merge failed${error.trim() ? `: ${error.trim()}` : ` with exit code ${code}`}.`)));
  signal?.addEventListener('abort', () => child.kill(), { once: true });
});

/** Re-encodes independently generated MP3 segments into one seekable MP3 asset. */
export async function mergeMp3Chunks(chunks: Uint8Array[], signal?: AbortSignal, runner: FfmpegRunner = runFfmpeg, maximumBytes = 100 * 1024 * 1024): Promise<Uint8Array> {
  if (chunks.length === 0) throw new Error('At least one MP3 chunk is required.');
  const directory = await mkdtemp(join(tmpdir(), 'vorinthex-audio-'));
  try {
    const paths = await Promise.all(chunks.map(async (chunk, index) => {
      const path = join(directory, `${String(index).padStart(4, '0')}.mp3`);
      await writeFile(path, chunk);
      return path;
    }));
    const manifest = join(directory, 'inputs.txt');
    const output = join(directory, 'narration.mp3');
    await writeFile(manifest, paths.map((path) => `file '${concatPath(path)}'`).join('\n'));
    await runner(['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', manifest, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', '-fs', String(maximumBytes + 1), '-y', output], signal);
    if ((await stat(output)).size > maximumBytes) throw new Error(`Merged audio exceeds the ${maximumBytes}-byte limit.`);
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
