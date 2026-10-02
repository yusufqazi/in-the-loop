import { AppError } from "@/lib/errors";
import { deleteMeeting, getMeetingTranscript, touchSession } from "@/lib/server/database";
import { apiResponse } from "@/lib/server/http";
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
