import { AppError } from "./errors";
import { MAX_FILE_BYTES } from "./transcript";

export type DetectedSpeaker = { id: string; label: string };
export type AudioTranscript = { text: string; speakers: DetectedSpeaker[] };

function timestamp(seconds: unknown): string | null {
  if (seconds === undefined || seconds === null) return null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
    throw new AppError("INVALID_TRANSCRIPTION", "Transcription returned invalid timestamps. Please retry.", 502);
  // The existing transcript parser uses whole-second MM:SS / HH:MM:SS labels.
  const total = Math.floor(seconds);
  const part = (value: number) => String(value).padStart(2, "0");
  return total >= 3600
    ? `${part(Math.floor(total / 3600))}:${part(Math.floor(total / 60) % 60)}:${part(total % 60)}`
    : `${part(Math.floor(total / 60))}:${part(total % 60)}`;
}

export function formatDiarizedTranscript(segments: unknown): AudioTranscript {
  if (!Array.isArray(segments))
    throw new AppError("INVALID_TRANSCRIPTION", "Transcription did not return speaker segments. Please retry.", 502);
  const speakers = new Map<string, DetectedSpeaker>();
  const passages: string[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment.text !== "string")
      throw new AppError("INVALID_TRANSCRIPTION", "Transcription returned an unreadable segment. Please retry.", 502);
    const text = segment.text.trim();
    if (!text) continue;
    const speakerId = typeof segment.speaker === "string" ? segment.speaker.trim() : "";
    let speaker = speakers.get(speakerId);
    if (speakerId && !speaker) {
      const number = speakers.size + 1;
      speaker = { id: `speaker-${number}`, label: `Speaker ${number}` };
      speakers.set(speakerId, speaker);
    }
    const start = timestamp(segment.start);
    const heading = `${start ? `[${start}] ` : ""}${speaker ? `${speaker.label}:` : ""}`.trim();
    passages.push(heading ? `${heading}\n${text}` : `[Speaker not provided] ${text}`);
  }
  return { text: passages.join("\n\n"), speakers: [...speakers.values()] };
}

export function renameTranscriptSpeaker(
  text: string,
  speakers: DetectedSpeaker[],
  id: string,
  proposedName: string,
): AudioTranscript {
  const speaker = speakers.find((item) => item.id === id);
  if (!speaker) throw new Error("This speaker is no longer available.");
  const name = proposedName.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'’()\-]{0,79}$/u.test(name))
    throw new Error("Use a name of 1–80 characters without colons or line breaks.");
  if (speakers.some((item) => item.id !== id && item.label.toLocaleLowerCase() === name.toLocaleLowerCase()))
    throw new Error("Another speaker already uses this name. Choose a different name.");
  const escaped = speaker.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headings = new RegExp(`^([ \\t]*(?:\\[\\d{1,3}:\\d{2}(?::\\d{2})?\\][ \\t]*)?)${escaped}([ \\t]*:)`, "gm");
  const updated = text.replace(headings, (_match, prefix, suffix) => `${prefix}${name}${suffix}`);
  if (new TextEncoder().encode(updated).length > MAX_FILE_BYTES)
    throw new Error("This name would make the transcript exceed 100 KiB. Shorten the transcript or name.");
  return {
    text: updated,
    speakers: speakers.map((item) => item.id === id ? { ...item, label: name } : item),
  };
}
