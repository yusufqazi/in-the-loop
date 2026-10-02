import { AppError } from "@/lib/errors";
import { MAX_FILE_BYTES } from "@/lib/transcript";
import { listMeetings } from "@/lib/server/database";
import { apiResponse, readBody } from "@/lib/server/http";
import { ingestTranscript } from "@/lib/server/rag";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  return apiResponse(request, async () =>
    Response.json({ meetings: await listMeetings() }),
  );
}
export async function POST(request: Request) {
  return apiResponse(request, async (metrics) => {
    const type = request.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data"))
      throw new AppError(
        "INVALID_INPUT",
        "Upload a .txt file using multipart/form-data.",
      );
    const bytes = await readBody(request, MAX_FILE_BYTES + 8192);
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { "content-type": type },
      }).formData();
    } catch {
      throw new AppError("INVALID_INPUT", "The upload could not be read.");
    }
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      form.getAll("file").length !== 1 ||
      !/\.txt$/i.test(file.name)
    )
      throw new AppError("INVALID_FILE", "Select one .txt transcript.");
    if (!file.size || file.size > MAX_FILE_BYTES)
      throw new AppError(
        "INVALID_FILE",
        "Transcript must be nonempty and no larger than 100 KiB.",
        file.size > MAX_FILE_BYTES ? 413 : 400,
      );
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
    } catch {
      throw new AppError(
        "INVALID_ENCODING",
        "Save the transcript as UTF-8 text before uploading.",
      );
    }
    const meeting = await ingestTranscript(text, file.name, metrics);
    return Response.json({ meeting }, { status: 201 });
  });
}
