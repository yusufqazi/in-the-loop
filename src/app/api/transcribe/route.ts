import { AppError } from "@/lib/errors";
import { MAX_AUDIO_BYTES, hasAudioHeader, validateAudioFile } from "@/lib/audio";
import { apiResponse, readBody } from "@/lib/server/http";
import { attachSessionCookie, requestOwner } from "@/lib/server/owner";
import { transcribeAudio } from "@/lib/server/transcription";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let setCookie: string | undefined;
  const response = await apiResponse(request, async (metrics) => {
    const context = await requestOwner(request);
    setCookie = context.setCookie;
    const type = request.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data"))
      throw new AppError("INVALID_INPUT", "Upload an audio file using multipart/form-data.");
    const bytes = await readBody(request, MAX_AUDIO_BYTES + 8192);
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": type } }).formData();
    } catch {
      throw new AppError("INVALID_INPUT", "The audio upload could not be read.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1)
      throw new AppError("INVALID_AUDIO", "Select one audio recording.");
    validateAudioFile(file);
    if (!hasAudioHeader(new Uint8Array(await file.slice(0, 64).arrayBuffer()), file.name))
      throw new AppError("INVALID_AUDIO", "The file does not contain a recognized audio recording.");
    const transcript = await transcribeAudio(file, metrics);
    return Response.json(transcript);
  });
  return attachSessionCookie(response, setCookie);
}
