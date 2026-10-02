import { AppError } from "@/lib/errors";
import { deleteMeeting, getMeetingTranscript, renameMeeting, touchSession } from "@/lib/server/database";
import { apiResponse, readBody } from "@/lib/server/http";
import { attachSessionCookie, requestOwner } from "@/lib/server/owner";

export const runtime = "nodejs";
type Context = { params: Promise<{ meetingId: string }> };

async function meetingIdFrom(context: Context) {
  const { meetingId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId))
    throw new AppError("INVALID_INPUT", "Select a valid meeting.");
  return meetingId;
}

export async function GET(request: Request, context: Context) {
  let setCookie: string | undefined;
  const response = await apiResponse(request, async () => {
    const id = await meetingIdFrom(context);
    const ownership = await requestOwner(request);
    setCookie = ownership.setCookie;
    const transcript = await getMeetingTranscript(id, ownership.owner);
    await touchSession(ownership.owner);
    return Response.json({ transcript });
  });
  return attachSessionCookie(response, setCookie);
}

export async function DELETE(request: Request, context: Context) {
  let setCookie: string | undefined;
  const response = await apiResponse(request, async () => {
    const id = await meetingIdFrom(context);
    const ownership = await requestOwner(request);
    setCookie = ownership.setCookie;
    await deleteMeeting(id, ownership.owner);
    return Response.json({ deleted: true });
  });
  return attachSessionCookie(response, setCookie);
}

export async function PATCH(request: Request, context: Context) {
  let setCookie: string | undefined;
  const response = await apiResponse(request, async () => {
    const id = await meetingIdFrom(context);
    const ownership = await requestOwner(request);
    setCookie = ownership.setCookie;
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      throw new AppError("INVALID_INPUT", "Send a meeting title as JSON.");
    const bytes = await readBody(request, 4096);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError("INVALID_INPUT", "The meeting title request could not be read.");
    }
    const title = body && typeof body === "object" && "title" in body ? body.title : undefined;
    if (typeof title !== "string" || !title.trim() || title.trim().length > 120 || /[\u0000-\u001f\u007f]/u.test(title))
      throw new AppError("INVALID_INPUT", "Enter a meeting title of 1–120 characters on one line.");
    const meeting = await renameMeeting(id, title.trim(), ownership.owner);
    await touchSession(ownership.owner);
    return Response.json({ meeting });
  });
  return attachSessionCookie(response, setCookie);
}
