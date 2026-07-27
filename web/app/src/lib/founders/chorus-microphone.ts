import type { ChorusMention } from "./chorus";

const TARGET_SAMPLE_RATE = 24_000;
const MAX_RECORDING_MS = 60_000;

export function encodePcm16(samples: Float32Array, sourceSampleRate: number): string {
  const outputLength = Math.max(1, Math.round(samples.length * TARGET_SAMPLE_RATE / sourceSampleRate));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(index * sourceSampleRate / TARGET_SAMPLE_RATE));
    const sample = Math.max(-1, Math.min(1, samples[sourceIndex] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function appendSpokenTranscript(draft: string, transcript: string, mentions: ChorusMention[]): string {
  let normalized = transcript.trim();
  for (const mention of [...mentions].sort((left, right) => right.name.length - left.name.length)) {
    const escaped = mention.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    normalized = normalized.replace(new RegExp(`(?:@|\\bat\\s+)${escaped}(?=$|[\\s.,!?;:])`, "gi"), `@${mention.name}`);
  }
  if (!normalized) return draft;
  return `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${normalized}`.slice(0, 8_000);
}

export interface PcmCapture {
  stop(): Promise<string>;
  cancel(): void;
}

export async function startPcmCapture(onLevel: (level: number) => void, onLimit: (audioBase64: string) => void, onLimitError: (error: unknown) => void): Promise<PcmCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new Error("Microphone recording is not supported by this browser");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  let context: AudioContext;
  let source: MediaStreamAudioSourceNode;
  let processor: ScriptProcessorNode;
  let silence: GainNode;
  try {
    context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4_096, 1, 1);
    silence = context.createGain();
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    if (context!) void context.close();
    throw error;
  }
  silence.gain.value = 0;
  const chunks: Float32Array[] = [];
  let total = 0;
  let stopped = false;
  let stopPromise: Promise<string> | null = null;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(input);
    chunks.push(chunk); total += chunk.length;
    let peak = 0;
    for (const sample of input) peak = Math.max(peak, Math.abs(sample));
    onLevel(Math.min(1, peak * 3));
  };
  source.connect(processor); processor.connect(silence); silence.connect(context.destination);

  const cleanup = () => {
    if (stopped) return;
    stopped = true; clearTimeout(limitTimer); processor.disconnect(); source.disconnect(); silence.disconnect();
    for (const track of stream.getTracks()) track.stop();
    onLevel(0); void context.close();
  };
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = Promise.resolve().then(() => {
      cleanup();
      const samples = new Float32Array(Math.min(total, Math.floor(context.sampleRate * MAX_RECORDING_MS / 1_000)));
      let offset = 0;
      for (const chunk of chunks) {
        const remaining = samples.length - offset;
        if (remaining <= 0) break;
        samples.set(chunk.subarray(0, remaining), offset); offset += Math.min(chunk.length, remaining);
      }
      if (samples.length < context.sampleRate / 50) throw new Error("No speech was recorded");
      return encodePcm16(samples, context.sampleRate);
    });
    return stopPromise;
  };
  const limitTimer = window.setTimeout(() => { void stop().then(onLimit, onLimitError); }, MAX_RECORDING_MS);
  return { stop, cancel: cleanup };
}
