import { AppError } from "@/lib/errors";
import { apiResponse, readBody } from "@/lib/server/http";
import { claimSession } from "@/lib/server/database";
import { requestOwner } from "@/lib/server/owner";
import type { StoredMessage } from "@/lib/server/database";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(request, async () => {
    const { owner } = await requestOwner(request);
    if (!owner.userId)
      throw new AppError("UNAUTHORIZED", "Sign in to save your workspace.", 401);
    if (!owner.claimSessionId) return Response.json({ saved: true });
    const bytes = await readBody(request, 2_000_000);
    let body: { chats?: unknown };
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new AppError("INVALID_INPUT", "The save request is invalid.");
    }
    if (
      !body ||
      !body.chats ||
      typeof body.chats !== "object" ||
      Array.isArray(body.chats)
    )
      throw new AppError("INVALID_INPUT", "The chat history is invalid.");
    const chats = body.chats as Record<string, StoredMessage[]>;
    const count = Object.values(chats).reduce((sum, messages) => sum + (Array.isArray(messages) ? messages.length : 1000), 0);
    if (
      count > 100 ||
      Object.keys(chats).some(
        (id) =>
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ),
      ) ||
      Object.values(chats).some(
        (messages) =>
          !Array.isArray(messages) ||
          messages.some(
            (message) =>
              !message ||
              !["user", "assistant"].includes(message.role) ||
              typeof message.content !== "string" ||
              message.content.length > 4000,
          ),
      )
    )
      throw new AppError("INVALID_INPUT", "The chat history is invalid or too large.");
    await claimSession(owner.claimSessionId, owner.userId, chats);
    return Response.json({ saved: true });
  });
}
