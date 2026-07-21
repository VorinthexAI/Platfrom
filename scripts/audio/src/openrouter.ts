import type { AudioConfig, GenerateSoundtrackInput, GenerateSpeechInput } from "./types";

export class OpenRouterAudioClient {
  constructor(private readonly config: AudioConfig) {}

  async generateSoundtrack(input: GenerateSoundtrackInput): Promise<Uint8Array> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers({ json: true }),
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        modalities: ["text", "audio"],
        audio: { format: input.format },
        stream: true
      })
    });

    if (!response.ok) await throwOpenRouterError(response);
    if (!response.body) throw new Error("OpenRouter did not return an audio stream.");

    const chunks = await readStreamingAudioChunks(response.body);
    if (!chunks.length) {
      throw new Error("OpenRouter returned no audio chunks. Try a dedicated audio model or switch to --mode tts.");
    }
    return concatChunks(chunks);
  }

  async generateSpeech(input: GenerateSpeechInput): Promise<Uint8Array> {
    const response = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: this.headers({ json: true }),
      body: JSON.stringify({
        model: input.model,
        input: input.input,
        voice: input.voice,
        response_format: input.format,
        speed: input.speed ?? 1
      })
    });

    if (!response.ok) await throwOpenRouterError(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  private headers(options: { json?: boolean } = {}): HeadersInit {
    if (!this.config.openRouterApiKey) {
      throw new Error("Missing OPENROUTER_API_KEY. Put it in scripts/audio/.env or scripts/video/.env.");
    }
    return {
      Authorization: `Bearer ${this.config.openRouterApiKey}`,
      "HTTP-Referer": "https://vorinthex.ai",
      "X-Title": "Vorinthex Audio Asset Engine",
      ...(options.json ? { "Content-Type": "application/json" } : {})
    };
  }
}

async function throwOpenRouterError(response: Response): Promise<never> {
  const body = await response.text().catch(() => "");
  throw new Error(`${response.status} ${body || response.statusText}`);
}

async function readStreamingAudioChunks(body: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { audio?: { data?: string } } }>;
      };
      const audioData = parsed.choices?.[0]?.delta?.audio?.data;
      if (audioData) chunks.push(Uint8Array.from(Buffer.from(audioData, "base64")));
    }
  }

  return chunks;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
