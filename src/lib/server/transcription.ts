import "server-only";
import OpenAI from "openai";
import { AppError } from "../errors";
import { MAX_FILE_BYTES } from "../transcript";
import { transcriptionConfig } from "./config";
import type { Metrics } from "./http";
import { formatDiarizedTranscript, type AudioTranscript } from "../audio-transcript";

export async function transcribeAudio(file: File, metrics: Metrics): Promise<AudioTranscript> {
  const config = transcriptionConfig();
  const client = new OpenAI({ apiKey: config.apiKey, timeout: 45_000, maxRetries: 0 });
  metrics.transcriptionModel = config.model;
  metrics.audioBytes = file.size;
  const start = performance.now();
  try {
    const diarize = config.model.includes("diarize");
    const response = await client.audio.transcriptions.create({
      file,
      model: config.model,
      response_format: diarize ? "diarized_json" : "json",
      ...(diarize ? { chunking_strategy: "auto" as const } : {}),
    });
    if (response.usage?.type === "tokens") {
      metrics.transcriptionInputTokens = response.usage.input_tokens;
      metrics.transcriptionOutputTokens = response.usage.output_tokens;
    } else if (response.usage?.type === "duration") {
      metrics.transcriptionAudioSeconds = response.usage.seconds;
    }
    const result = diarize
      ? formatDiarizedTranscript("segments" in response ? response.segments : undefined)
      : { text: response.text.trim(), speakers: [] };
    if (!result.text)
      throw new AppError("NO_SPEECH", "No speech was detected. Try a recording with clearer speech.", 422);
    if (new TextEncoder().encode(result.text).length > MAX_FILE_BYTES)
      throw new AppError("TRANSCRIPT_TOO_LARGE", "The transcript exceeds 100 KiB. Transcribe a shorter clip.", 413);
    metrics.detectedSpeakers = result.speakers.length;
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof OpenAI.APIError && error.status === 429)
      throw new AppError("MODEL_UNAVAILABLE", "Transcription is temporarily unavailable. Check API quota or try again later.", 503);
    if (error instanceof OpenAI.APIError && error.status === 400)
      throw new AppError("INVALID_AUDIO", "The audio could not be transcribed. Try a playable recording in a supported format.", 400);
    throw new AppError("TRANSCRIPTION_FAILED", "Audio transcription failed. Please retry or paste your transcript instead.", 502);
  } finally {
    metrics.transcriptionLatencyMs = Math.round(performance.now() - start);
  }
}
