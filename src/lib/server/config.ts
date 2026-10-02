import "server-only";
import { AppError } from "../errors";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new AppError(
      "NOT_CONFIGURED",
      `Server setup is incomplete. Add ${name} to .env.local.`,
      503,
    );
  return value;
}
export function databaseConfig() {
  return {
    url: required("SUPABASE_URL"),
    key: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
export function modelConfig() {
  return {
    apiKey: required("OPENAI_API_KEY"),
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    answerModel: process.env.OPENAI_ANSWER_MODEL?.trim() || "gpt-6-luna",
  };
}
export function assertDemoAccess(request: Request) {
  const publicUrl = new URL(request.url);
  // Next.js can construct an internal localhost URL. Host preserves the address
  // used by the browser; browsers cannot override this header in fetch requests.
  const hostHeader = request.headers.get("host");
  if (hostHeader) publicUrl.host = hostHeader;
  const host = publicUrl.hostname;
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(host);
  if (process.env.VERCEL || !local) {
    if (process.env.DEMO_ACCESS_MODE !== "protected") {
      throw new AppError(
        "DEMO_RESTRICTED",
        "Demo access is disabled. Configure hosting access protection before enabling this deployment.",
        403,
      );
    }
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== publicUrl.origin)
      throw new AppError(
        "INVALID_ORIGIN",
        "Cross-origin requests are not allowed.",
        403,
      );
  }
}
