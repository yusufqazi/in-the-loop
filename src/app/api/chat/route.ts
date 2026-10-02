import { AppError } from "@/lib/errors";
import type { ChatTurn } from "@/lib/types";
import { apiResponse, readBody } from "@/lib/server/http";
import { answerQuestion } from "@/lib/server/rag";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return apiResponse(request, async (metrics) => {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AppError("INVALID_INPUT", "Send a JSON question.");
    const bytes = await readBody(request, 20000);
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AppError(
        "INVALID_INPUT",
        "The request must contain valid JSON.",
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.meetingId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.meetingId,
      )
    )
      throw new AppError("INVALID_INPUT", "Select a valid meeting.");
    if (
      typeof body.question !== "string" ||
      !body.question.trim() ||
      body.question.length > 2000
    )
      throw new AppError(
        "INVALID_INPUT",
        "Question must contain 1–2000 characters.",
      );
    const history: ChatTurn[] = body.history ?? [];
    if (
      !Array.isArray(history) ||
      history.length > 6 ||
      history.some(
        (t) =>
          !t ||
          !["user", "assistant"].includes(t.role) ||
          typeof t.content !== "string" ||
          t.content.length > 2000,
      )
    )
      throw new AppError(
        "INVALID_INPUT",
        "Conversation history is invalid or too long.",
      );
    return Response.json(
      await answerQuestion(
        body.meetingId,
        body.question.trim(),
        history,
        metrics,
      ),
    );
  });
}
