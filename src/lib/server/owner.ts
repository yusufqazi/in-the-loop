import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AppError } from "../errors";
import { supabasePublicConfig } from "./config";

const COOKIE = "itl_session";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Owner = {
  userId: string | null;
  sessionId: string | null;
  claimSessionId?: string | null;
};

export async function requestOwner(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  const candidate = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  if (token) {
    const { url, anonKey } = supabasePublicConfig();
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user)
      throw new AppError(
        "UNAUTHORIZED",
        "Your sign-in has expired. Please sign in again.",
        401,
      );
    return {
      owner: {
        userId: data.user.id,
        sessionId: null,
        claimSessionId: candidate && UUID.test(candidate) ? candidate : null,
      } as Owner,
      setCookie: undefined,
    };
  }

  const sessionId = candidate && UUID.test(candidate) ? candidate : crypto.randomUUID();
  return {
    owner: { userId: null, sessionId } as Owner,
    setCookie:
      candidate === sessionId
        ? undefined
        : `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
}

export function attachSessionCookie(response: Response, setCookie?: string) {
  if (setCookie) response.headers.append("Set-Cookie", setCookie);
  return response;
}
