import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio } from "@/lib/server/transcription";
import { MAX_FILE_BYTES } from "@/lib/transcript";
import type { Metrics } from "@/lib/server/http";

const mocks = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => {
  class APIError extends Error {
    constructor(public status: number) { super("private provider response"); }
  }
  class Client {
    static APIError = APIError;
    constructor(options: unknown) { mocks.options(options); }
    audio = { transcriptions: { create: mocks.create } };
  }
  return { default: Client };
});
import OpenAI from "openai";

const file = new File(["synthetic recording"], "synthetic.wav", { type: "audio/wav" });
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "");
  mocks.create.mockReset();
  mocks.options.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("audio transcription provider boundary", () => {
  it("uses the configured model, avoids retries and returns reviewable text with private metrics", async () => {
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "configured-transcription-model");
    mocks.create.mockResolvedValue({ text: "  We agreed to launch Friday.  ", usage: { type: "tokens", input_tokens: 42, output_tokens: 8 } });
    const metrics: Metrics = {};
    expect(await transcribeAudio(file, metrics)).toEqual({ text: "We agreed to launch Friday.", speakers: [] });
    expect(mocks.create).toHaveBeenCalledWith({ file, model: "configured-transcription-model", response_format: "json" });
    expect(mocks.options).toHaveBeenCalledWith({ apiKey: "test-only-key", timeout: 45_000, maxRetries: 0 });
    expect(metrics).toMatchObject({ transcriptionModel: "configured-transcription-model", audioBytes: file.size, transcriptionInputTokens: 42, transcriptionOutputTokens: 8, transcriptionLatencyMs: expect.any(Number) });
    expect(JSON.stringify(metrics)).not.toContain("Friday");
    expect(JSON.stringify(metrics)).not.toContain("test-only-key");
    expect(JSON.stringify(metrics)).not.toContain(file.name);
  });
  it("defaults to diarization with automatic audio chunking and captures duration when provided", async () => {
    mocks.create.mockResolvedValue({ text: "Hello. Hi.", segments: [
      { speaker: "A", start: 0, end: 2, text: "Hello." },
      { speaker: "B", start: 3, end: 5, text: "Hi." },
    ], usage: { type: "duration", seconds: 5 } });
    const metrics: Metrics = {};
    expect(await transcribeAudio(file, metrics)).toEqual({
      text: "[00:00] Speaker 1:\nHello.\n\n[00:03] Speaker 2:\nHi.",
      speakers: [{ id: "speaker-1", label: "Speaker 1" }, { id: "speaker-2", label: "Speaker 2" }],
    });
    expect(mocks.create).toHaveBeenCalledWith({ file, model: "gpt-4o-transcribe-diarize", response_format: "diarized_json", chunking_strategy: "auto" });
    expect(metrics).toMatchObject({ transcriptionModel: "gpt-4o-transcribe-diarize", transcriptionAudioSeconds: 5, detectedSpeakers: 2 });
  });
  it("rejects empty speech and oversized UTF-8 output without inventing or truncating text", async () => {
    mocks.create.mockResolvedValue({ text: "  \n ", segments: [] });
    await expect(transcribeAudio(file, {})).rejects.toMatchObject({ code: "NO_SPEECH", status: 422 });
    mocks.create.mockResolvedValue({ text: "", segments: [{ text: "é".repeat(MAX_FILE_BYTES / 2 + 1), speaker: "A", start: 0 }] });
    await expect(transcribeAudio(file, {})).rejects.toMatchObject({ code: "TRANSCRIPT_TOO_LARGE", status: 413 });
  });
  it("fails explicitly when the diarization provider omits segments", async () => {
    mocks.create.mockResolvedValue({ text: "Plain text without speaker evidence." });
    await expect(transcribeAudio(file, {})).rejects.toMatchObject({ code: "INVALID_TRANSCRIPTION", status: 502 });
  });
  it.each([[429, "MODEL_UNAVAILABLE", 503], [400, "INVALID_AUDIO", 400], [500, "TRANSCRIPTION_FAILED", 502]])("maps provider status %s to a safe error", async (providerStatus, code, status) => {
    const failure = new OpenAI.APIError(providerStatus as number, undefined, undefined, undefined);
    mocks.create.mockRejectedValue(failure);
    const metrics: Metrics = {};
    await expect(transcribeAudio(file, metrics)).rejects.toMatchObject({ code, status });
    expect(metrics.transcriptionLatencyMs).toEqual(expect.any(Number));
    await expect(transcribeAudio(file, {})).rejects.not.toThrow("private provider response");
  });
  it("handles timeouts and missing configuration without leaking exceptions", async () => {
    mocks.create.mockRejectedValue(new Error("private timeout with key"));
    await expect(transcribeAudio(file, {})).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED", status: 502 });
    vi.stubEnv("OPENAI_API_KEY", "");
    mocks.create.mockClear();
    await expect(transcribeAudio(file, {})).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
