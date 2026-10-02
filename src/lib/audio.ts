import { AppError } from "./errors";

// Leave room for multipart headers below Vercel's 4.5 MB request limit.
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 300;
export const AUDIO_ACCEPT = ".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,.ogg,.flac";

export function validateAudioFile(file: File) {
  if (!/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|ogg|flac)$/i.test(file.name))
    throw new AppError("INVALID_AUDIO", "Choose an MP3, MP4, M4A, WAV, WebM, OGG, or FLAC audio file.");
  if (!file.size || file.size > MAX_AUDIO_BYTES)
    throw new AppError(
      "INVALID_AUDIO",
      "Audio must be nonempty and no larger than 4 MiB. Use a shorter or compressed clip.",
      file.size > MAX_AUDIO_BYTES ? 413 : 400,
    );
  const mime = file.type.split(";")[0].toLowerCase();
  if (mime && !mime.startsWith("audio/") && !["video/mp4", "video/webm", "application/octet-stream"].includes(mime))
    throw new AppError("INVALID_AUDIO", "The selected file is not an audio recording.");
}

// A quick container check rejects renamed text before a paid model request.
// The transcription provider still validates and decodes the actual audio.
export function hasAudioHeader(bytes: Uint8Array, filename: string): boolean {
  const ascii = (offset: number, value: string) =>
    value.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  const extension = filename.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "wav": return ascii(0, "RIFF") && ascii(8, "WAVE");
    case "webm": return [0x1a, 0x45, 0xdf, 0xa3].every((value, index) => bytes[index] === value);
    case "ogg": return ascii(0, "OggS");
    case "flac": return ascii(0, "fLaC");
    case "mp4":
    case "m4a": return ascii(4, "ftyp");
    case "mp3":
    case "mpeg":
    case "mpga": return ascii(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default: return false;
  }
}
