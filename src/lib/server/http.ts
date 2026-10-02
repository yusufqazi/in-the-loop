import "server-only";
import { AppError } from "../errors";
import { assertDemoAccess } from "./config";

export type Metrics = Record<string, string | number | boolean>;
export function logEvent(event: string, metrics: Metrics) {
  console.info(
    JSON.stringify({ event, timestamp: new Date().toISOString(), ...metrics }),
  );
}
export async function apiResponse(
  request: Request,
  action: (metrics: Metrics) => Promise<Response>,
) {
  const start = performance.now();
  const metrics: Metrics = {
    requestId: crypto.randomUUID(),
    route: new URL(request.url).pathname,
    method: request.method,
  };
  let response: Response;
  try {
    assertDemoAccess(request);
    response = await action(metrics);
  } catch (error) {
    const known = error instanceof AppError;
    metrics.errorCode = known ? error.code : "INTERNAL_ERROR";
    // Provider exceptions can contain request data: log codes, never raw messages.
    response = Response.json(
      {
        error: {
          code: metrics.errorCode,
          message: known
            ? error.message
            : "An unexpected server error occurred. Please try again.",
          requestId: metrics.requestId,
        },
      },
      { status: known ? error.status : 500 },
    );
  }
  metrics.status = response.status;
  metrics.latencyMs = Math.round(performance.now() - start);
  logEvent("api_request", metrics);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-ID", String(metrics.requestId));
  return response;
}

export async function readBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new AppError("TOO_LARGE", "Request exceeds the size limit.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new AppError("TOO_LARGE", "Request exceeds the size limit.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
