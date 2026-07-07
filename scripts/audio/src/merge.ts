import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

export async function mergeVideoAudio(input: {
  videoPath: string;
  audioPath: string;
  outputPath?: string;
}): Promise<string> {
  const outputPath = input.outputPath ?? defaultOutputPath(input.videoPath);
  await run(ffmpegStatic || "ffmpeg", [
    "-y",
    "-i", input.videoPath,
    "-i", input.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-shortest",
    outputPath
  ]);
  return outputPath;
}

function defaultOutputPath(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}-with-audio.mp4`);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: command === "ffmpeg" && process.platform === "win32" });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ffmpeg is not installed or not available in PATH. Install ffmpeg, then rerun audio:merge."));
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed with exit code ${code}.`));
    });
  });
}
